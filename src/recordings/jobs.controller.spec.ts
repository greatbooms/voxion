import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TranscriptionQueue } from '../jobs/transcription.queue';
import { JobsController } from './jobs.controller';
import { RecordingsService } from './recordings.service';

const jobRunId = '00000000-0000-4000-8000-000000000003';
const recordingId = '00000000-0000-4000-8000-000000000001';
const createdAt = new Date('2026-07-03T01:02:03.000Z');

const makeJobRun = () => ({
  id: jobRunId,
  recordingId,
  queueName: 'transcription',
  bullJobId: jobRunId,
  status: 'ACTIVE',
  attemptsMade: 1,
  lastError: null,
  createdAt,
  updatedAt: createdAt,
});

describe('JobsController', () => {
  let moduleRef: TestingModule;
  let controller: JobsController;
  let prisma: { jobRun: { findUnique: jest.Mock } };
  let transcriptionQueue: { getJobState: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jobRun: { findUnique: jest.fn() },
    };
    transcriptionQueue = {
      getJobState: jest.fn().mockResolvedValue({
        state: 'active',
        progress: 0,
        attemptsMade: 1,
        failedReason: null,
      }),
    };

    moduleRef = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        RecordingsService,
        { provide: AppConfigService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
        { provide: TranscriptionQueue, useValue: transcriptionQueue },
      ],
    }).compile();
    controller = moduleRef.get(JobsController);
  });

  afterEach(async () => {
    await moduleRef?.close();
  });

  it('returns the job run with live queue state', async () => {
    prisma.jobRun.findUnique.mockResolvedValue(makeJobRun());

    const result = await controller.findOne(jobRunId);

    expect(prisma.jobRun.findUnique).toHaveBeenCalledWith({
      where: { id: jobRunId },
    });
    expect(transcriptionQueue.getJobState).toHaveBeenCalledWith(jobRunId);
    expect(result).toEqual({
      id: jobRunId,
      recordingId,
      queueName: 'transcription',
      bullJobId: jobRunId,
      status: 'ACTIVE',
      attemptsMade: 1,
      lastError: null,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      queue: {
        state: 'active',
        progress: 0,
        attemptsMade: 1,
        failedReason: null,
      },
    });
  });

  it('returns the job run without queue state when Redis is unreachable', async () => {
    prisma.jobRun.findUnique.mockResolvedValue(makeJobRun());
    transcriptionQueue.getJobState.mockRejectedValue(
      new Error('redis unavailable'),
    );

    const result = await controller.findOne(jobRunId);

    expect(result.queue).toBeNull();
    expect(result.status).toBe('ACTIVE');
  });

  it('rejects invalid job ids before querying Prisma', async () => {
    await expect(controller.findOne('not-a-uuid')).rejects.toThrow(
      'Job id must be a valid UUID.',
    );

    expect(prisma.jobRun.findUnique).not.toHaveBeenCalled();
  });

  it('returns not found when the job run does not exist', async () => {
    prisma.jobRun.findUnique.mockResolvedValue(null);

    await expect(controller.findOne(jobRunId)).rejects.toThrow(
      'Job not found.',
    );
  });
});

describe('JobsController HTTP routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('routes GET /jobs/:id', async () => {
    const prisma = {
      jobRun: { findUnique: jest.fn().mockResolvedValue(makeJobRun()) },
    };
    const transcriptionQueue = {
      getJobState: jest.fn().mockResolvedValue(null),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        RecordingsService,
        { provide: AppConfigService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
        { provide: TranscriptionQueue, useValue: transcriptionQueue },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .get(`/jobs/${jobRunId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: jobRunId,
      recordingId,
      status: 'ACTIVE',
      queue: null,
    });
  });
});
