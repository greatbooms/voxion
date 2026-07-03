import { Readable } from 'node:stream';
import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';

const recordingId = '00000000-0000-4000-8000-000000000001';

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
      findUniqueOrThrow: jest.Mock;
    };
  };
  let storage: { saveOriginalUpload: jest.Mock };

  beforeEach(async () => {
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
        findUniqueOrThrow: jest.fn(),
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
    await moduleRef.close();
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
    ).rejects.toThrow('Unsupported audio type: text/plain');

    expect(prisma.recording.create).not.toHaveBeenCalled();
  });

  it('finds a recording with chunks ordered by index', async () => {
    const recording = { id: recordingId, chunks: [] };
    prisma.recording.findUniqueOrThrow.mockResolvedValue(recording);

    await expect(controller.findOne(recordingId)).resolves.toBe(recording);

    expect(prisma.recording.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: recordingId },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });
  });
});
