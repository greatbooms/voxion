import { PROCESS_RECORDING_JOB } from './jobs.constants';
import { TranscriptionProcessor } from './transcription.processor';

describe('TranscriptionProcessor', () => {
  it('processes known recording jobs', async () => {
    const processor = new TranscriptionProcessor();

    await expect(
      processor.process({
        name: PROCESS_RECORDING_JOB,
        data: { recordingId: 'recording-1' },
      } as any),
    ).resolves.toBeUndefined();
  });

  it('rejects unknown jobs instead of completing them', async () => {
    const processor = new TranscriptionProcessor();

    await expect(
      processor.process({
        name: 'unknown-job',
        data: { recordingId: 'recording-1' },
      } as any),
    ).rejects.toThrow('Unknown transcription job: unknown-job');
  });
});
