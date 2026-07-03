import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { OpenaiTranscriptionService } from './openai-transcription.service';
import { TranscriptMergeService } from './transcript-merge.service';

@Module({
  imports: [AppConfigModule],
  providers: [OpenaiTranscriptionService, TranscriptMergeService],
  exports: [OpenaiTranscriptionService, TranscriptMergeService],
})
export class TranscriptionModule {}
