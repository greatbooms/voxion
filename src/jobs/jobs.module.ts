import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { TRANSCRIPTION_QUEUE } from './jobs.constants';
import { TranscriptionProcessor } from './transcription.processor';
import { TranscriptionQueue } from './transcription.queue';

@Module({
  imports: [
    AppConfigModule,
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      extraOptions: { manualRegistration: true },
      useFactory: (config: AppConfigService) => {
        const redis = config.redis;

        return {
          prefix: redis.keyPrefix,
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
            db: redis.db,
            maxRetriesPerRequest: redis.maxRetriesPerRequest,
            connectTimeout: redis.connectTimeout,
            lazyConnect: redis.lazyConnect,
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: TRANSCRIPTION_QUEUE,
    }),
  ],
  providers: [TranscriptionQueue, TranscriptionProcessor],
  exports: [TranscriptionQueue],
})
export class JobsModule {}
