import { writeFile } from 'node:fs/promises';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Job } from 'bullmq';
import { AudioModule } from '../audio/audio.module';
import { NotionModule } from '../notion/notion.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { TranscriptionModule } from '../transcription/transcription.module';
import { PROCESS_RECORDING_JOB } from './jobs.constants';
import { JobsModule, JobsWorkerModule } from './jobs.module';
import { TranscriptionProcessor } from './transcription.processor';

jest.mock('node:fs/promises', () => ({
  writeFile: jest.fn(),
}));

const mockedWriteFile = jest.mocked(writeFile);

describe('TranscriptionProcessor', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('rejects unknown jobs instead of completing them', async () => {
    const { processor } = createHarness();

    await expect(
      processor.process({
        name: 'unknown-job',
        data: { recordingId: 'recording-1' },
      } as Job<any>),
    ).rejects.toThrow('Unknown transcription job: unknown-job');
  });

  it('processes a recording through transcription, merge, notion upload, and job completion', async () => {
    const { processor, prisma, audio, storage, openai, merge, notion } =
      createHarness();
    const recording = createRecording();
    const chunks = [
      {
        index: 0,
        startSeconds: 0,
        endSeconds: 60.5,
        path: '/storage/chunks/000000.mp3',
        bytes: 1024,
      },
      {
        index: 1,
        startSeconds: 60.5,
        endSeconds: 121.25,
        path: '/storage/chunks/000001.mp3',
        bytes: 2048,
      },
    ];

    prisma.recording.findUnique.mockResolvedValue(recording);
    audio.probeDurationSeconds.mockResolvedValue(121.25);
    storage.normalizedPath.mockReturnValue('/storage/normalized/recording.mp3');
    audio.createDurationChunks.mockResolvedValue(chunks);
    storage.chunkTranscriptPath.mockImplementation(
      (_recordingId: string, index: number) =>
        `/storage/transcripts/chunks/${index}.json`,
    );
    openai.transcribe
      .mockResolvedValueOnce({ text: ' Hello chunk one ', raw: { one: true } })
      .mockResolvedValueOnce({ text: 'Hello chunk two', raw: { two: true } });
    merge.merge.mockReturnValue({
      text: 'Hello chunk one\n\nHello chunk two',
      chunks: [
        { ...chunks[0], text: ' Hello chunk one ' },
        { ...chunks[1], text: 'Hello chunk two' },
      ],
    });
    storage.finalTranscriptPath.mockReturnValue('/storage/transcripts/final.json');
    notion.createRecordingPageMetadata.mockResolvedValue({
      pageId: 'notion-page-id',
      url: 'https://notion.test/page',
    });

    await expect(
      processor.process(
        createJob({
          id: 'job-run-1',
          attemptsMade: 2,
          data: { recordingId: recording.id },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(prisma.jobRun.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        OR: [
          { queueName: 'transcription', bullJobId: 'job-run-1' },
          { id: 'job-run-1' },
        ],
      },
      data: { status: 'ACTIVE', attemptsMade: 2, lastError: null },
    });
    expect(recordingStatuses(prisma)).toEqual([
      'PROBING',
      'CHUNKING',
      'TRANSCRIBING',
      'MERGING',
      'UPLOADING_TO_NOTION',
      'COMPLETED',
    ]);
    expect(audio.probeDurationSeconds).toHaveBeenCalledWith(recording.originalPath);
    expect(prisma.recording.update).toHaveBeenCalledWith({
      where: { id: recording.id },
      data: {
        status: 'CHUNKING',
        durationSeconds: 121.25,
        normalizedPath: '/storage/normalized/recording.mp3',
      },
    });
    expect(audio.normalizeToMp3).toHaveBeenCalledWith(
      recording.originalPath,
      '/storage/normalized/recording.mp3',
    );
    expect(prisma.recordingChunk.upsert).toHaveBeenNthCalledWith(1, {
      where: { recordingId_index: { recordingId: recording.id, index: 0 } },
      create: {
        recordingId: recording.id,
        index: 0,
        status: 'PENDING',
        path: chunks[0].path,
        bytes: BigInt(chunks[0].bytes),
        startSeconds: chunks[0].startSeconds,
        endSeconds: chunks[0].endSeconds,
      },
      update: {
        path: chunks[0].path,
        bytes: BigInt(chunks[0].bytes),
        startSeconds: chunks[0].startSeconds,
        endSeconds: chunks[0].endSeconds,
      },
    });
    expect(prisma.recording.update).toHaveBeenCalledWith({
      where: { id: recording.id },
      data: { status: 'TRANSCRIBING', chunkCount: chunks.length },
    });
    expect(openai.transcribe).toHaveBeenNthCalledWith(1, {
      path: chunks[0].path,
      language: recording.language,
    });
    expect(mockedWriteFile).toHaveBeenNthCalledWith(
      1,
      '/storage/transcripts/chunks/0.json',
      JSON.stringify({ one: true }, null, 2),
    );
    expect(prisma.recordingChunk.update).toHaveBeenCalledWith({
      where: { recordingId_index: { recordingId: recording.id, index: 0 } },
      data: {
        status: 'COMPLETED',
        transcriptPath: '/storage/transcripts/chunks/0.json',
        text: ' Hello chunk one ',
      },
    });
    expect(merge.merge).toHaveBeenCalledWith([
      { ...chunks[0], text: ' Hello chunk one ' },
      { ...chunks[1], text: 'Hello chunk two' },
    ]);
    expect(mockedWriteFile).toHaveBeenNthCalledWith(
      3,
      '/storage/transcripts/final.json',
      JSON.stringify(
        {
          text: 'Hello chunk one\n\nHello chunk two',
          chunks: [
            { ...chunks[0], text: ' Hello chunk one ' },
            { ...chunks[1], text: 'Hello chunk two' },
          ],
        },
        null,
        2,
      ),
    );
    expect(notion.createRecordingPageMetadata).toHaveBeenCalledWith({
      title: recording.title,
      status: 'Completed',
      language: recording.language,
      model: recording.model,
      durationSeconds: 121.25,
      originalFilename: recording.originalFilename,
      fileSizeMb: Number(recording.originalBytes) / 1024 / 1024,
      chunkCount: chunks.length,
      recordedAt: recording.recordedAt,
    });
    expect(notion.appendTranscriptToPage).toHaveBeenCalledWith({
      pageId: 'notion-page-id',
      transcript: 'Hello chunk one\n\nHello chunk two',
    });
    const createOrder =
      notion.createRecordingPageMetadata.mock.invocationCallOrder[0];
    const persistOrder = prisma.recording.update.mock.calls.findIndex(
      ([input]) => input.data.notionPageId === 'notion-page-id',
    );
    const appendOrder = notion.appendTranscriptToPage.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(
      prisma.recording.update.mock.invocationCallOrder[persistOrder],
    );
    expect(
      prisma.recording.update.mock.invocationCallOrder[persistOrder],
    ).toBeLessThan(appendOrder);
    expect(prisma.recording.update).toHaveBeenLastCalledWith({
      where: { id: recording.id },
      data: {
        status: 'COMPLETED',
        completedAt: expect.any(Date),
      },
    });
    expect(prisma.jobRun.updateMany).toHaveBeenLastCalledWith({
      where: {
        OR: [
          { queueName: 'transcription', bullJobId: 'job-run-1' },
          { id: 'job-run-1' },
        ],
      },
      data: { status: 'COMPLETED', attemptsMade: 2, lastError: null },
    });
  });

  it('marks recording and job run failed when transcription fails', async () => {
    const { processor, prisma, audio, storage, openai } = createHarness();
    const recording = createRecording({ title: null });
    const failure = new Error('OpenAI unavailable');

    prisma.recording.findUnique.mockResolvedValue(recording);
    audio.probeDurationSeconds.mockResolvedValue(20);
    storage.normalizedPath.mockReturnValue('/storage/normalized/recording.mp3');
    audio.createDurationChunks.mockResolvedValue([
      {
        index: 0,
        startSeconds: 0,
        endSeconds: 20,
        path: '/storage/chunks/000000.mp3',
        bytes: 512,
      },
    ]);
    openai.transcribe.mockRejectedValue(failure);

    await expect(
      processor.process(
        createJob({
          id: 'job-run-1',
          attemptsMade: 3,
          data: { recordingId: recording.id },
        }),
      ),
    ).rejects.toThrow('OpenAI unavailable');

    expect(prisma.recording.update).toHaveBeenLastCalledWith({
      where: { id: recording.id },
      data: {
        status: 'FAILED',
        errorCode: 'PROCESSING_FAILED',
        errorMessage: 'OpenAI unavailable',
      },
    });
    expect(prisma.jobRun.updateMany).toHaveBeenLastCalledWith({
      where: {
        OR: [
          { queueName: 'transcription', bullJobId: 'job-run-1' },
          { id: 'job-run-1' },
        ],
      },
      data: {
        status: 'FAILED',
        attemptsMade: 3,
        lastError: 'OpenAI unavailable',
      },
    });
    expect(prisma.recordingChunk.update).toHaveBeenCalledWith({
      where: { recordingId_index: { recordingId: recording.id, index: 0 } },
      data: {
        status: 'FAILED',
        errorCode: 'TRANSCRIPTION_FAILED',
        errorMessage: 'OpenAI unavailable',
      },
    });
  });

  it('reuses already completed chunks on retry and transcribes remaining chunks', async () => {
    const { processor, prisma, audio, storage, openai, merge, notion } =
      createHarness();
    const recording = createRecording();
    const chunks = [
      {
        index: 0,
        startSeconds: 0,
        endSeconds: 30,
        path: '/storage/chunks/000000.mp3',
        bytes: 1000,
      },
      {
        index: 1,
        startSeconds: 30,
        endSeconds: 60,
        path: '/storage/chunks/000001.mp3',
        bytes: 2000,
      },
    ];

    prisma.recording.findUnique.mockResolvedValue(recording);
    audio.probeDurationSeconds.mockResolvedValue(60);
    storage.normalizedPath.mockReturnValue('/storage/normalized/recording.mp3');
    audio.createDurationChunks.mockResolvedValue(chunks);
    prisma.recordingChunk.upsert
      .mockResolvedValueOnce({
        recordingId: recording.id,
        index: 0,
        status: 'COMPLETED',
        path: '/storage/chunks/000000.mp3',
        bytes: 1000n,
        startSeconds: 0,
        endSeconds: 30,
        transcriptPath: '/storage/transcripts/chunks/0.json',
        text: 'Stored completed text',
      })
      .mockResolvedValueOnce({
        recordingId: recording.id,
        index: 1,
        status: 'PENDING',
        path: '/storage/chunks/000001.mp3',
        bytes: 2000n,
        startSeconds: 30,
        endSeconds: 60,
        transcriptPath: null,
        text: null,
      });
    storage.chunkTranscriptPath.mockReturnValue('/storage/transcripts/chunks/1.json');
    openai.transcribe.mockResolvedValue({
      text: 'Fresh retry text',
      raw: { fresh: true },
    });
    merge.merge.mockReturnValue({
      text: 'Stored completed text\n\nFresh retry text',
      chunks: [
        { ...chunks[0], text: 'Stored completed text' },
        { ...chunks[1], text: 'Fresh retry text' },
      ],
    });
    storage.finalTranscriptPath.mockReturnValue('/storage/transcripts/final.json');
    notion.createRecordingPageMetadata.mockResolvedValue({
      pageId: 'notion-page-id',
      url: 'https://notion.test/page',
    });

    await expect(
      processor.process(createJob({ data: { recordingId: recording.id } })),
    ).resolves.toBeUndefined();

    expect(openai.transcribe).toHaveBeenCalledTimes(1);
    expect(openai.transcribe).toHaveBeenCalledWith({
      path: chunks[1].path,
      language: recording.language,
    });
    expect(merge.merge).toHaveBeenCalledWith([
      { ...chunks[0], text: 'Stored completed text' },
      { ...chunks[1], text: 'Fresh retry text' },
    ]);
    expect(storage.chunkTranscriptPath).toHaveBeenCalledTimes(1);
    expect(storage.chunkTranscriptPath).toHaveBeenCalledWith(recording.id, 1);
  });

  it('reuses existing Notion page on retry instead of creating another page', async () => {
    const { processor, prisma, audio, storage, openai, merge, notion } =
      createHarness();
    const recording = createRecording({
      notionPageId: 'existing-page-id',
      notionUrl: 'https://notion.test/existing-page',
    });
    const chunks = [
      {
        index: 0,
        startSeconds: 0,
        endSeconds: 20,
        path: '/storage/chunks/000000.mp3',
        bytes: 1000,
      },
    ];

    prisma.recording.findUnique.mockResolvedValue(recording);
    audio.probeDurationSeconds.mockResolvedValue(20);
    storage.normalizedPath.mockReturnValue('/storage/normalized/recording.mp3');
    audio.createDurationChunks.mockResolvedValue(chunks);
    openai.transcribe.mockResolvedValue({
      text: 'Retry transcript',
      raw: { retry: true },
    });
    merge.merge.mockReturnValue({
      text: 'Retry transcript',
      chunks: [{ ...chunks[0], text: 'Retry transcript' }],
    });
    storage.chunkTranscriptPath.mockReturnValue('/storage/transcripts/chunks/0.json');
    storage.finalTranscriptPath.mockReturnValue('/storage/transcripts/final.json');

    await expect(
      processor.process(createJob({ data: { recordingId: recording.id } })),
    ).resolves.toBeUndefined();

    expect(notion.createRecordingPageMetadata).not.toHaveBeenCalled();
    expect(notion.appendTranscriptToPage).toHaveBeenCalledWith({
      pageId: 'existing-page-id',
      transcript: 'Retry transcript',
    });
    expect(
      prisma.recording.update.mock.calls.some(
        ([input]) => input.data.notionPageId === 'existing-page-id',
      ),
    ).toBe(false);
  });

  it('logs a warning when no job run row is updated', async () => {
    const { processor, prisma } = createHarness();
    const warn = jest.spyOn((processor as any).logger, 'warn');

    prisma.jobRun.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.recording.findUnique.mockResolvedValue(null);

    await expect(
      processor.process(createJob({ data: { recordingId: 'missing-recording' } })),
    ).rejects.toThrow('Recording not found: missing-recording');

    expect(warn).toHaveBeenCalledWith(
      'Job run update affected 0 rows for recording missing-recording',
    );
  });
});

describe('JobsModule', () => {
  it('does not import worker-only dependency modules', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      JobsModule,
    ) as unknown[];

    expect(imports).not.toEqual(expect.arrayContaining([AudioModule]));
    expect(imports).not.toEqual(expect.arrayContaining([NotionModule]));
    expect(imports).not.toEqual(expect.arrayContaining([PrismaModule]));
    expect(imports).not.toEqual(expect.arrayContaining([StorageModule]));
    expect(imports).not.toEqual(expect.arrayContaining([TranscriptionModule]));
  });
});

describe('JobsWorkerModule', () => {
  it('imports the modules required by TranscriptionProcessor dependencies', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      JobsWorkerModule,
    ) as unknown[];

    expect(imports).toEqual(
      expect.arrayContaining([
        AudioModule,
        NotionModule,
        PrismaModule,
        StorageModule,
        TranscriptionModule,
      ]),
    );
  });
});

function createHarness() {
  const prisma = {
    recording: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    recordingChunk: {
      upsert: jest.fn(({ create }) => Promise.resolve(create)),
      update: jest.fn(),
    },
    jobRun: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const audio = {
    probeDurationSeconds: jest.fn(),
    normalizeToMp3: jest.fn(),
    createDurationChunks: jest.fn(),
  };
  const storage = {
    normalizedPath: jest.fn(),
    chunkTranscriptPath: jest.fn(),
    finalTranscriptPath: jest.fn(),
    ensureParent: jest.fn(),
  };
  const openai = {
    transcribe: jest.fn(),
  };
  const merge = {
    merge: jest.fn(),
  };
  const notion = {
    createRecordingPage: jest.fn(),
    createRecordingPageMetadata: jest.fn(),
    appendTranscriptToPage: jest.fn(),
  };
  const processor = new (TranscriptionProcessor as any)(
    prisma as any,
    audio as any,
    storage as any,
    openai as any,
    merge as any,
    notion as any,
  );

  return { processor, prisma, audio, storage, openai, merge, notion };
}

type RecordingFixture = {
  id: string;
  title: string | null;
  originalFilename: string;
  originalPath: string;
  originalBytes: bigint;
  language: string;
  model: string;
  recordedAt: Date;
  notionPageId: string | null;
  notionUrl: string | null;
};

function createRecording(overrides: Partial<RecordingFixture> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Team Sync',
    originalFilename: 'team-sync.wav',
    originalPath: '/storage/original.wav',
    originalBytes: 5_242_880n,
    language: 'en',
    model: 'whisper-1',
    recordedAt: new Date('2026-07-02T12:00:00.000Z'),
    notionPageId: null,
    notionUrl: null,
    ...overrides,
  };
}

function createJob(
  overrides: Partial<Job<any>> & { data?: { recordingId: string } } = {},
): Job<any> {
  return {
    id: 'job-run-1',
    name: PROCESS_RECORDING_JOB,
    attemptsMade: 1,
    data: { recordingId: '11111111-1111-4111-8111-111111111111' },
    ...overrides,
  } as Job<any>;
}

function recordingStatuses(prisma: ReturnType<typeof createHarness>['prisma']) {
  return prisma.recording.update.mock.calls
    .map(([input]) => input.data.status)
    .filter(Boolean);
}
