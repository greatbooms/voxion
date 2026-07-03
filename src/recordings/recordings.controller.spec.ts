import { Readable } from 'node:stream';
import { unlink } from 'node:fs/promises';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppConfigService } from '../config/app-config.service';
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
  };
  let storage: { saveOriginalUpload: jest.Mock };

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
    };
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof prisma) => unknown) => callback(prisma),
    );
    storage = {
      saveOriginalUpload: jest.fn().mockResolvedValue({
        path: `/tmp/originals/${recordingId}/meeting.m4a`,
      }),
    };

    moduleRef = await Test.createTestingModule({
      controllers: [RecordingsController],
      providers: [
        RecordingsService,
        { provide: AppConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
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

    expect(result).toEqual({ recordingId, status: 'QUEUED' });

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
    expect(prisma.recording.update).toHaveBeenCalledWith({
      where: { id: recordingId },
      data: {
        status: 'FAILED',
        errorCode: 'STORAGE_SAVE_FAILED',
        errorMessage: 'disk full',
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
});

describe('RecordingsController HTTP routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('accepts multipart uploads through the controller interceptor', async () => {
    const recordings = {
      create: jest.fn().mockResolvedValue({ recordingId, status: 'QUEUED' }),
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
      .expect({ recordingId, status: 'QUEUED' });

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
      create: jest.fn().mockResolvedValue({ recordingId, status: 'QUEUED' }),
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
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .get(`/recordings/${recordingId}`)
      .expect(200)
      .expect(mappedRecordingWithChunk);
  });
});
