import { PROCESS_RECORDING_JOB, TRANSCRIPTION_QUEUE } from './jobs.constants';
import { TranscriptionQueue } from './transcription.queue';

describe('TranscriptionQueue', () => {
  it('enqueues process-recording jobs with retry and retention options', async () => {
    const add = jest.fn().mockResolvedValue({ id: 42 });
    const queue = new TranscriptionQueue({ add } as any);

    await expect(queue.enqueue('recording-1')).resolves.toBe('42');

    expect(add).toHaveBeenCalledWith(
      PROCESS_RECORDING_JOB,
      { recordingId: 'recording-1' },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );
    expect(TRANSCRIPTION_QUEUE).toBe('transcription');
  });
});
