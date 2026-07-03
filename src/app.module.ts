import { Module } from '@nestjs/common';
import { AudioModule } from './audio/audio.module';
import { AppConfigModule } from './config/app-config.module';
import { JobsModule } from './jobs/jobs.module';
import { NotionModule } from './notion/notion.module';
import { PrismaModule } from './prisma/prisma.module';
import { RecordingsModule } from './recordings/recordings.module';
import { TranscriptionModule } from './transcription/transcription.module';

@Module({
  imports: [
    AppConfigModule,
    AudioModule,
    JobsModule,
    NotionModule,
    PrismaModule,
    RecordingsModule,
    TranscriptionModule,
  ],
})
export class AppModule {}
