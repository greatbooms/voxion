import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PROCESS_RECORDING_JOB, TRANSCRIPTION_QUEUE } from './jobs.constants';
import { ProcessRecordingJobData } from './transcription.queue';

@Injectable()
@Processor(TRANSCRIPTION_QUEUE, { concurrency: 1 })
export class TranscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptionProcessor.name);

  async process(job: Job<ProcessRecordingJobData>): Promise<void> {
    if (job.name !== PROCESS_RECORDING_JOB) {
      this.logger.warn(`Ignoring unknown job ${job.name}`);
      return;
    }

    this.logger.log(`Processing recording ${job.data.recordingId}`);
  }
}
