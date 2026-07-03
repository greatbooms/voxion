import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { JobsModule } from '../jobs/jobs.module';
import { StorageModule } from '../storage/storage.module';
import { RecordingUploadInterceptor } from './recording-upload.interceptor';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';

@Module({
  imports: [AppConfigModule, StorageModule, JobsModule],
  controllers: [RecordingsController],
  providers: [RecordingsService, RecordingUploadInterceptor],
  exports: [RecordingsService],
})
export class RecordingsModule {}
