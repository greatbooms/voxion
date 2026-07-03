import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TRANSCRIPTION_QUEUE } from '../src/jobs/jobs.constants';
import { PrismaService } from '../src/prisma/prisma.service';

const prismaMock = {
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
};

describe('App', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(getQueueToken(TRANSCRIPTION_QUEUE))
      .useValue({ add: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 for unknown routes', async () => {
    await request(app.getHttpServer()).get('/missing').expect(404);
  });
});
