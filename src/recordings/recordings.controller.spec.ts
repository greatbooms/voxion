import { Readable } from 'node:stream';
import { unlink } from 'node:fs/promises';
import { ConflictException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, RecordingStatus } from '@prisma/client';
import request from 'supertest';
import { AppConfigService } from '../config/app-config.service';
import { TRANSCRIPTION_QUEUE } from '../jobs/jobs.constants';
import { TranscriptionQueue } from '../jobs/transcription.queue';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';

jest.mock('node:fs/promises', () => ({
  ...jest.requireActual('node:fs/promises'),
  unlink: jest.fn(),
}));

const mockedUnlink = unlink as jest.MockedFunction<typeof unlink>;

const recordingId = '00000000-0000-4000-8000-000000000001';
const chunkId = '00000000-0000-4000-8000-000000000002';
const jobRunId = '00000000-0000-4000-8000-000000000003';
const bullJobId = jobRunId;
const recordedAt = new Date('2026-07-02T03:04:05.000Z');
const createdAt = new Date('2026-07-03T01:02:03.000Z');

const makeFile = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File => ({
  fieldname: 'file',
  originalname: 'meeting.m4a',
  encoding: '7bit',
  mimetype: 'audio/m4a',
  size: 5,
  stream: Readable.from([]),
  destination: '',
  filename: '',
  path: '',
  buffer: Buffer.from('audio'),
  ...overrides,
});

const makeRecordingWithChunk = () => ({
  id: recordingId,
  status: 'COMPLETED',
  title: 'Team sync',
  originalFilename: 'meeting.m4a',
  mimeType: 'audio/m4a',
  originalPath: '/tmp/originals/meeting.m4a',
  originalBytes: 9007199254740993n,
  normalizedPath: '/tmp/normalized/meeting.wav',
  durationSeconds: new Prisma.Decimal('123.456'),
  language: 'en',
  model: 'gpt-4o-transcribe',
  chunkCount: 1,
  transcriptPath: '/tmp/transcript.txt',
  transcriptText: 'hello',
  notionPageId: null,
  notionUrl: null,
  errorCode: null,
  errorMessage: null,
  recordedAt,
  createdAt,
  updatedAt: createdAt,
  completedAt: createdAt,
  chunks: [
    {
      id: chunkId,
      recordingId,
      index: 0,
      status: 'COMPLETED',
      path: '/tmp/chunks/0.m4a',
      bytes: 9007199254740994n,
      startSeconds: new Prisma.Decimal('0.000'),
      endSeconds: new Prisma.Decimal('123.456'),
      transcriptPath: null,
      text: 'hello',
      errorCode: null,
      errorMessage: null,
      createdAt,
      updatedAt: createdAt,
    },
  ],
});

const mappedRecordingWithChunk = {
  id: recordingId,
  status: 'COMPLETED',
  title: 'Team sync',
  originalFilename: 'meeting.m4a',
  mimeType: 'audio/m4a',
  originalPath: '/tmp/originals/meeting.m4a',
  originalBytes: '9007199254740993',
  normalizedPath: '/tmp/normalized/meeting.wav',
  durationSeconds: '123.456',
  language: 'en',
  model: 'gpt-4o-transcribe',
  chunkCount: 1,
  transcriptPath: '/tmp/transcript.txt',
  transcriptText: 'hello',
  notionPageId: null,
  notionUrl: null,
  errorCode: null,
  errorMessage: null,
  recordedAt: recordedAt.toISOString(),
  createdAt: createdAt.toISOString(),
  updatedAt: createdAt.toISOString(),
  completedAt: createdAt.toISOString(),
  chunks: [
    {
      id: chunkId,
      recordingId,
      index: 0,
      status: 'COMPLETED',
      path: '/tmp/chunks/0.m4a',
      bytes: '9007199254740994',
      startSeconds: '0',
      endSeconds: '123.456',
      transcriptPath: null,
      text: 'hello',
      errorCode: null,
      errorMessage: null,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    },
  ],
};

const mappedTranscript = {
  id: recordingId,
  text: 'hello',
  notionPageId: 'notion-page-id',
  notionUrl: 'https://notion.so/notion-page-id',
};

describe('RecordingsController', () => {
  let moduleRef: TestingModule;
  let controller: RecordingsController;
  let config: {
    maxUploadBytes: number;
    defaultTranscriptionLanguage: string;
    openaiTranscriptionModel: string;
  };
  let prisma: {
    $transaction: jest.Mock;
    recording: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
    jobRun: {
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let storage: { saveOriginalUpload: jest.Mock };
  let transcriptionQueue: { enqueue: jest.Mock };

  beforeEach(async () => {
    mockedUnlink.mockResolvedValue(undefined);
    config = {
      maxUploadBytes: 1024,
      defaultTranscriptionLanguage: 'ko',
      openaiTranscriptionModel: 'gpt-4o-transcribe',
    };
    prisma = {
      $transaction: jest.fn(),
      recording: {
        create: jest.fn().mockResolvedValue({
          id: recordingId,
          status: 'UPLOADED',
        }),
        update: jest.fn().mockResolvedValue({
          id: recordingId,
          status: 'QUEUED',
        }),
        findUnique: jest.fn(),
      },
      jobRun: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: data.id ?? jobRunId,
            bullJobId: data.bullJobId,
          }),
        ),
        update: jest.fn().mockResolvedValue({
          id: jobRunId,
          status: 'FAILED',
        }),
      },
    };
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof prisma) => unknown) => callback(prisma),
    );
    storage = {
      saveOriginalUpload: jest.fn().mockResolvedValue({
        path: `/tmp/originals/${recordingId}/meeting.m4a`,
      }),
    };
    transcriptionQueue = {
      enqueue: jest.fn().mockResolvedValue(bullJobId),
    };

    moduleRef = await Test.createTestingModule({
      controllers: [RecordingsController],
      providers: [
        RecordingsService,
        { provide: AppConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: TranscriptionQueue, useValue: transcriptionQueue },
      ],
    }).compile();
    controller = moduleRef.get(RecordingsController);
  });

  afterEach(async () => {
    await moduleRef?.close();
    mockedUnlink.mockReset();
  });

  it('uploads an audio file and queues the recording', async () => {
    const recordedAt = '2026-07-02T03:04:05.000Z';
    const result = await controller.create(
      {
        title: 'Team sync',
        language: 'en',
        recordedAt,
      },
      makeFile(),
    );

    const createdJobRun = prisma.jobRun.create.mock.calls[0][0].data;

    expect(result).toEqual({
      recordingId,
      jobId: createdJobRun.id,
      status: 'QUEUED',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.recording.create).toHaveBeenCalledWith({
      data: {
        status: 'UPLOADED',
        title: 'Team sync',
        originalFilename: 'meeting.m4a',
        mimeType: 'audio/m4a',
        originalPath: '',
        originalBytes: BigInt(5),
        language: 'en',
        model: 'gpt-4o-transcribe',
        recordedAt: new Date(recordedAt),
      },
    });
    expect(storage.saveOriginalUpload).toHaveBeenCalledWith({
      recordingId,
      originalFilename: 'meeting.m4a',
      buffer: Buffer.from('audio'),
    });
    expect(prisma.recording.update).toHaveBeenCalledWith({
      where: { id: recordingId },
      data: {
        originalPath: `/tmp/originals/${recordingId}/meeting.m4a`,
        status: 'QUEUED',
      },
    });
    expect(prisma.jobRun.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        recordingId,
        queueName: TRANSCRIPTION_QUEUE,
        bullJobId: createdJobRun.id,
        status: 'QUEUED',
      },
    });
    expect(createdJobRun.bullJobId).toBe(createdJobRun.id);
    expect(transcriptionQueue.enqueue).toHaveBeenCalledWith({
      recordingId,
      jobId: createdJobRun.id,
    });
    expect(
      prisma.jobRun.create.mock.invocationCallOrder[0],
    ).toBeLessThan(transcriptionQueue.enqueue.mock.invocationCallOrder[0]);
  });

  it('defaults missing recordedAt to the current date', async () => {
    jest.useFakeTimers().setSystemTime(recordedAt);

    try {
      await controller.create({ title: 'No date' }, makeFile());
    } finally {
      jest.useRealTimers();
    }

    expect(prisma.recording.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordedAt,
        }),
      }),
    );
  });

  it('accepts recordedAt with a timezone offset', async () => {
    const recordedAt = '2026-03-01T09:30:00+09:00';

    await controller.create({ recordedAt }, makeFile());

    expect(prisma.recording.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordedAt: new Date(recordedAt),
        }),
      }),
    );
  });

  it.each([
    ['empty string', ''],
    ['non-date string', 'not-a-date'],
    ['locale-ish string', 'March 1, 2026'],
    ['rollover date', '2026-02-30T00:00:00.000Z'],
    ['datetime without timezone', '2026-03-01T00:00:00.000'],
    ['multipart duplicate array', ['2026-03-01T00:00:00.000Z']],
    ['object value', { value: '2026-03-01T00:00:00.000Z' }],
  ])(
    'rejects invalid recordedAt %s',
    async (_label, invalidRecordedAt) => {
      await expect(
        controller.create({ recordedAt: invalidRecordedAt } as any, makeFile()),
      ).rejects.toThrow('recordedAt must be a strict ISO-8601 datetime with timezone.');

      expect(prisma.recording.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['empty string', ''],
    ['blank string', '   '],
    ['long name', 'english'],
    ['underscore tag', 'en_US'],
    ['array value', ['en']],
    ['object value', { tag: 'en' }],
  ])(
    'rejects invalid language %s',
    async (_label, invalidLanguage) => {
      await expect(
        controller.create({ language: invalidLanguage } as any, makeFile()),
      ).rejects.toThrow('language must be a valid language tag.');

      expect(prisma.recording.create).not.toHaveBeenCalled();
    },
  );

  it.each(['ko', 'en', 'ko-KR'])(
    'accepts language tag %p',
    async (language) => {
      await controller.create({ language }, makeFile());

      expect(prisma.recording.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ language }),
        }),
      );
    },
  );

  it('marks the recording failed when storage save fails after row creation', async () => {
    storage.saveOriginalUpload.mockRejectedValue(new Error('disk full'));

    await expect(controller.create({}, makeFile())).rejects.toThrow(
      'disk full',
    );

    expect(prisma.recording.create).toHaveBeenCalled();
    expect(transcriptionQueue.enqueue).not.toHaveBeenCalled();
    expect(prisma.jobRun.create).not.toHaveBeenCalled();
    expect(prisma.recording.update).toHaveBeenCalledWith({
      where: { id: recordingId },
      data: {
        status: 'FAILED',
        errorCode: 'STORAGE_SAVE_FAILED',
        errorMessage: 'disk full',
      },
    });
  });

  it('marks the recording failed when enqueue fails after queueing', async () => {
    transcriptionQueue.enqueue.mockRejectedValue(new Error('redis unavailable'));

    await expect(controller.create({}, makeFile())).rejects.toThrow(
      'redis unavailable',
    );

    expect(prisma.recording.update).toHaveBeenNthCalledWith(1, {
      where: { id: recordingId },
      data: {
        originalPath: `/tmp/originals/${recordingId}/meeting.m4a`,
        status: 'QUEUED',
      },
    });
    const createdJobRun = prisma.jobRun.create.mock.calls[0][0].data;

    expect(transcriptionQueue.enqueue).toHaveBeenCalledWith({
      recordingId,
      jobId: createdJobRun.id,
    });
    expect(prisma.recording.update).toHaveBeenNthCalledWith(2, {
      where: { id: recordingId },
      data: {
        status: 'FAILED',
        errorCode: 'ENQUEUE_RECORDING_FAILED',
        errorMessage: 'redis unavailable',
      },
    });
    expect(prisma.jobRun.update).toHaveBeenCalledWith({
      where: { id: createdJobRun.id },
      data: {
        status: 'FAILED',
        lastError: 'redis unavailable',
      },
    });
  });

  it('marks the recording failed and does not enqueue when job run creation fails', async () => {
    prisma.jobRun.create.mockRejectedValue(new Error('job run write failed'));

    await expect(controller.create({}, makeFile())).rejects.toThrow(
      'job run write failed',
    );

    expect(transcriptionQueue.enqueue).not.toHaveBeenCalled();
    expect(prisma.recording.update).toHaveBeenNthCalledWith(2, {
      where: { id: recordingId },
      data: {
        status: 'FAILED',
        errorCode: 'CREATE_JOB_RUN_FAILED',
        errorMessage: 'job run write failed',
      },
    });
  });

  it('removes the saved file and marks failed when queue update fails', async () => {
    const savedPath = `/tmp/originals/${recordingId}/meeting.m4a`;
    const updateError = new Error('database unavailable');
    storage.saveOriginalUpload.mockResolvedValue({ path: savedPath });
    prisma.recording.update
      .mockRejectedValueOnce(updateError)
      .mockResolvedValueOnce({
        id: recordingId,
        status: 'FAILED',
      });

    await expect(controller.create({}, makeFile())).rejects.toThrow(
      updateError,
    );

    expect(storage.saveOriginalUpload).toHaveBeenCalled();
    expect(mockedUnlink).toHaveBeenCalledWith(savedPath);
    expect(transcriptionQueue.enqueue).not.toHaveBeenCalled();
    expect(prisma.jobRun.create).not.toHaveBeenCalled();
    expect(prisma.recording.update).toHaveBeenNthCalledWith(1, {
      where: { id: recordingId },
      data: {
        originalPath: savedPath,
        status: 'QUEUED',
      },
    });
    expect(prisma.recording.update).toHaveBeenNthCalledWith(2, {
      where: { id: recordingId },
      data: {
        status: 'FAILED',
        errorCode: 'FINALIZE_RECORDING_FAILED',
        errorMessage: 'database unavailable',
      },
    });
  });

  it('rejects uploads without a file', async () => {
    await expect(controller.create({ title: 'No file' })).rejects.toThrow(
      'Audio file is required.',
    );

    expect(prisma.recording.create).not.toHaveBeenCalled();
  });

  it('rejects uploads over the configured size limit', async () => {
    config.maxUploadBytes = 4;

    await expect(controller.create({}, makeFile())).rejects.toThrow(
      'Audio file exceeds max upload size.',
    );

    expect(prisma.recording.create).not.toHaveBeenCalled();
  });

  it('rejects unsupported MIME types', async () => {
    await expect(
      controller.create(
        {},
        makeFile({ originalname: 'meeting.txt', mimetype: 'text/plain' }),
      ),
    ).rejects.toThrow('Unsupported media type: text/plain');

    expect(prisma.recording.create).not.toHaveBeenCalled();
  });

  it('finds and maps a recording with chunks ordered by index', async () => {
    const recording = makeRecordingWithChunk();
    prisma.recording.findUnique.mockResolvedValue(recording);

    const result = await controller.findOne(recordingId);

    expect(result).toEqual(mappedRecordingWithChunk);
    expect(() => JSON.stringify(result)).not.toThrow();

    expect(prisma.recording.findUnique).toHaveBeenCalledWith({
      where: { id: recordingId },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });
  });

  it('rejects invalid recording ids before querying Prisma', async () => {
    await expect(controller.findOne('not-a-uuid')).rejects.toThrow(
      'Recording id must be a valid UUID.',
    );

    expect(prisma.recording.findUnique).not.toHaveBeenCalled();
  });

  it('returns not found when a recording does not exist', async () => {
    prisma.recording.findUnique.mockResolvedValue(null);

    await expect(controller.findOne(recordingId)).rejects.toThrow(
      'Recording not found.',
    );
  });

  it('returns transcript details for a completed recording', async () => {
    prisma.recording.findUnique.mockResolvedValue({
      ...makeRecordingWithChunk(),
      notionPageId: mappedTranscript.notionPageId,
      notionUrl: mappedTranscript.notionUrl,
    });

    const result = await controller.transcript(recordingId);

    expect(result).toEqual(mappedTranscript);
    expect(prisma.recording.findUnique).toHaveBeenCalledWith({
      where: { id: recordingId },
    });
  });

  it('returns conflict when a transcript is not ready', async () => {
    prisma.recording.findUnique.mockResolvedValue({
      ...makeRecordingWithChunk(),
      status: RecordingStatus.TRANSCRIBING,
    });

    try {
      await controller.transcript(recordingId);
      throw new Error('Expected transcript to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        status: RecordingStatus.TRANSCRIBING,
        message: 'Transcript is not ready.',
      });
    }
  });

  it('rejects invalid transcript ids before querying Prisma', async () => {
    await expect(controller.transcript('not-a-uuid')).rejects.toThrow(
      'Recording id must be a valid UUID.',
    );

    expect(prisma.recording.findUnique).not.toHaveBeenCalled();
  });

  it('returns not found when transcript recording does not exist', async () => {
    prisma.recording.findUnique.mockResolvedValue(null);

    await expect(controller.transcript(recordingId)).rejects.toThrow(
      'Recording not found.',
    );
  });
});

describe('RecordingsController HTTP routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('accepts multipart uploads through the controller interceptor', async () => {
    const recordings = {
      create: jest
        .fn()
        .mockResolvedValue({ recordingId, jobId: bullJobId, status: 'QUEUED' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [RecordingsController],
      providers: [
        { provide: RecordingsService, useValue: recordings },
        { provide: AppConfigService, useValue: { maxUploadBytes: 1024 } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post('/recordings')
      .field('title', 'HTTP upload')
      .field('language', 'en')
      .attach('file', Buffer.from('audio'), {
        filename: 'meeting.m4a',
        contentType: 'audio/m4a',
      })
      .expect(201)
      .expect({ recordingId, jobId: bullJobId, status: 'QUEUED' });

    expect(recordings.create).toHaveBeenCalledWith(
      { title: 'HTTP upload', language: 'en' },
      expect.objectContaining({
        fieldname: 'file',
        originalname: 'meeting.m4a',
        mimetype: 'audio/m4a',
        size: 5,
        buffer: Buffer.from('audio'),
      }),
    );
  });

  it('rejects multipart uploads over the configured controller limit', async () => {
    const recordings = {
      create: jest
        .fn()
        .mockResolvedValue({ recordingId, jobId: bullJobId, status: 'QUEUED' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [RecordingsController],
      providers: [
        { provide: RecordingsService, useValue: recordings },
        { provide: AppConfigService, useValue: { maxUploadBytes: 4 } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post('/recordings')
      .attach('file', Buffer.from('audio'), {
        filename: 'meeting.m4a',
        contentType: 'audio/m4a',
      })
      .expect(413);

    expect(recordings.create).not.toHaveBeenCalled();
  });

  it('serializes GET responses with BigInt and Decimal fields', async () => {
    const prisma = {
      recording: {
        findUnique: jest.fn().mockResolvedValue(makeRecordingWithChunk()),
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [RecordingsController],
      providers: [
        RecordingsService,
        { provide: AppConfigService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
        { provide: TranscriptionQueue, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .get(`/recordings/${recordingId}`)
      .expect(200)
      .expect(mappedRecordingWithChunk);
  });

  it('routes transcript reads to GET /recordings/:id/transcript', async () => {
    const recordings = {
      transcript: jest.fn().mockResolvedValue(mappedTranscript),
      findOne: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [RecordingsController],
      providers: [
        { provide: RecordingsService, useValue: recordings },
        { provide: AppConfigService, useValue: { maxUploadBytes: 1024 } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .get(`/recordings/${recordingId}/transcript`)
      .expect(200)
      .expect(mappedTranscript);

    expect(recordings.transcript).toHaveBeenCalledWith(recordingId);
    expect(recordings.findOne).not.toHaveBeenCalled();
  });
});
