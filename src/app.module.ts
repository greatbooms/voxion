import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AudioModule } from './audio/audio.module';
import { AppConfigModule } from './config/app-config.module';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/jobs.module';
import { NotionModule } from './notion/notion.module';
import { PrismaModule } from './prisma/prisma.module';
import { RecordingsModule } from './recordings/recordings.module';
import { TranscriptionModule } from './transcription/transcription.module';
import { WebModule } from './web/web.module';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    AudioModule,
    JobsModule,
    NotionModule,
    PrismaModule,
    RecordingsModule,
    TranscriptionModule,
    WebModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
