import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { NotionService } from './notion.service';

@Module({
  imports: [AppConfigModule],
  providers: [NotionService],
  exports: [NotionService],
})
export class NotionModule {}
