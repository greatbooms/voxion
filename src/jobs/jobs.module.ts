import { BullModule } from '@nestjs/bullmq';
import type { BullRootModuleOptions } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { TRANSCRIPTION_QUEUE } from './jobs.constants';
import { TranscriptionProcessor } from './transcription.processor';
import { TranscriptionQueue } from './transcription.queue';

type RedisConfig = AppConfigService['redis'];

type RedisConnectionOptions = {
  host: string;
  port: number;
  password: string | undefined;
  db: number;
  maxRetriesPerRequest: number | null;
  connectTimeout: number;
  lazyConnect: boolean;
};

export const WORKER_BULL_EXTRA_OPTIONS = { manualRegistration: true };

const createRedisConnectionOptions = (
  redis: RedisConfig,
  maxRetriesPerRequest: number | null,
): RedisConnectionOptions => ({
  host: redis.host,
  port: redis.port,
  password: redis.password,
  db: redis.db,
  maxRetriesPerRequest,
  connectTimeout: redis.connectTimeout,
  lazyConnect: redis.lazyConnect,
});

export const createProducerBullOptions = (
  config: AppConfigService,
): BullRootModuleOptions => {
  const redis = config.redis;

  return {
    prefix: redis.keyPrefix,
    connection: createRedisConnectionOptions(
      redis,
      redis.maxRetriesPerRequest,
    ),
  };
};

export const createWorkerBullOptions = (
  config: AppConfigService,
): BullRootModuleOptions => {
  const redis = config.redis;

  return {
    prefix: redis.keyPrefix,
    connection: createRedisConnectionOptions(redis, null),
  };
};

@Module({
  imports: [
    AppConfigModule,
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: createProducerBullOptions,
    }),
    BullModule.registerQueue({
      name: TRANSCRIPTION_QUEUE,
    }),
  ],
  providers: [TranscriptionQueue],
  exports: [TranscriptionQueue],
})
export class JobsModule {}

@Module({
  imports: [
    AppConfigModule,
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      extraOptions: WORKER_BULL_EXTRA_OPTIONS,
      useFactory: createWorkerBullOptions,
    }),
    BullModule.registerQueue({
      name: TRANSCRIPTION_QUEUE,
    }),
  ],
  providers: [TranscriptionProcessor],
})
export class JobsWorkerModule {}
