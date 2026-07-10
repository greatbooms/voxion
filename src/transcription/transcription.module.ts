import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { OpenaiTranscriptionService } from './openai-transcription.service';
import { TranscriptMergeService } from './transcript-merge.service';
import { TranscriptPostProcessorService } from './transcript-post-processor.service';
import { TranscriptTimelineService } from './transcript-timeline.service';

@Module({
  imports: [AppConfigModule],
  providers: [
    OpenaiTranscriptionService,
    TranscriptMergeService,
    TranscriptPostProcessorService,
    TranscriptTimelineService,
  ],
  exports: [
    OpenaiTranscriptionService,
    TranscriptMergeService,
    TranscriptPostProcessorService,
    TranscriptTimelineService,
  ],
})
export class TranscriptionModule {}
