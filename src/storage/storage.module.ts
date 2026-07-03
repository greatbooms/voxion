import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { StorageService } from './storage.service';

@Module({
  imports: [AppConfigModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
