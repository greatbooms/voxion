import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { StorageModule } from '../storage/storage.module';
import { AudioService } from './audio.service';

@Module({
  imports: [AppConfigModule, StorageModule],
  providers: [AudioService],
  exports: [AudioService],
})
export class AudioModule {}
