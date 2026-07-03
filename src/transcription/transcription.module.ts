import { Module } from '@nestjs/common';
import { TranscriptMergeService } from './transcript-merge.service';

@Module({
  providers: [TranscriptMergeService],
  exports: [TranscriptMergeService],
})
export class TranscriptionModule {}
