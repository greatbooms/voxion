import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PROCESS_RECORDING_JOB, TRANSCRIPTION_QUEUE } from './jobs.constants';

export type ProcessRecordingJobData = {
  recordingId: string;
};

export type EnqueueProcessRecordingInput = ProcessRecordingJobData & {
  jobId: string;
};

@Injectable()
export class TranscriptionQueue {
  constructor(
    @InjectQueue(TRANSCRIPTION_QUEUE)
    private readonly queue: Queue<ProcessRecordingJobData>,
  ) {}

  async enqueue(input: EnqueueProcessRecordingInput): Promise<string> {
    const job = await this.queue.add(
      PROCESS_RECORDING_JOB,
      { recordingId: input.recordingId },
      {
        jobId: input.jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );

    return String(job.id ?? input.jobId);
  }
}
