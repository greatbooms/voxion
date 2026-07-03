import { PROCESS_RECORDING_JOB, TRANSCRIPTION_QUEUE } from './jobs.constants';
import {
  createProducerBullOptions,
  createWorkerBullOptions,
  WORKER_BULL_EXTRA_OPTIONS,
} from './jobs.module';
import { TranscriptionQueue } from './transcription.queue';

describe('TranscriptionQueue', () => {
  it('enqueues process-recording jobs with the durable job run id', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-run-1' });
    const queue = new TranscriptionQueue({ add } as any);

    await expect(
      queue.enqueue({ recordingId: 'recording-1', jobId: 'job-run-1' }),
    ).resolves.toBe('job-run-1');

    expect(add).toHaveBeenCalledWith(
      PROCESS_RECORDING_JOB,
      { recordingId: 'recording-1' },
      {
        jobId: 'job-run-1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );
    expect(TRANSCRIPTION_QUEUE).toBe('transcription');
  });

  it('keeps producer retry options but disables request retries for workers', () => {
    const config = {
      redis: {
        host: 'redis',
        port: 6380,
        password: 'secret',
        db: 2,
        ttl: 300,
        keyPrefix: 'test:',
        maxRetriesPerRequest: 5,
        connectTimeout: 1234,
        lazyConnect: false,
      },
    };

    expect(createProducerBullOptions(config as any)).toEqual({
      prefix: 'test:',
      connection: {
        host: 'redis',
        port: 6380,
        password: 'secret',
        db: 2,
        maxRetriesPerRequest: 5,
        connectTimeout: 1234,
        lazyConnect: false,
      },
    });
    expect(createWorkerBullOptions(config as any)).toEqual({
      prefix: 'test:',
      connection: {
        host: 'redis',
        port: 6380,
        password: 'secret',
        db: 2,
        maxRetriesPerRequest: null,
        connectTimeout: 1234,
        lazyConnect: false,
      },
    });
    expect(WORKER_BULL_EXTRA_OPTIONS).toEqual({ manualRegistration: true });
  });
});
