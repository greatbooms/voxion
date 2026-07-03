import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { StorageModule } from '../storage/storage.module';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';

@Module({
  imports: [AppConfigModule, StorageModule],
  controllers: [RecordingsController],
  providers: [RecordingsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
