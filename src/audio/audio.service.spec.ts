import { Test } from '@nestjs/testing';
import { stat } from 'node:fs/promises';
import { AppConfigService } from '../config/app-config.service';
import { StorageService } from '../storage/storage.service';
import { AudioModule } from './audio.module';
import { AudioService } from './audio.service';
import { runCommand } from './ffmpeg-runner';

jest.mock('./ffmpeg-runner', () => ({
  runCommand: jest.fn(),
}));

jest.mock('node:fs/promises', () => ({
  stat: jest.fn(),
}));

const mockedRunCommand = jest.mocked(runCommand);
const mockedStat = jest.mocked(stat);

describe('AudioService', () => {
  const config = { chunkTargetBytes: 1_000 };
  const storage = {
    ensureParent: jest.fn(),
    chunkPath: jest.fn((recordingId: string, index: number) =>
      `/storage/chunks/${recordingId}/${String(index).padStart(6, '0')}.mp3`,
    ),
  };

  let service: AudioService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AudioService(
      config as AppConfigService,
      storage as unknown as StorageService,
    );
  });

  it('plans 3600 seconds into four 900 second chunks', () => {
    expect(
      service.planDurationChunks({
        durationSeconds: 3600,
        maxChunkSeconds: 900,
      }),
    ).toEqual([
      { index: 0, startSeconds: 0, endSeconds: 900 },
      { index: 1, startSeconds: 900, endSeconds: 1800 },
      { index: 2, startSeconds: 1800, endSeconds: 2700 },
      { index: 3, startSeconds: 2700, endSeconds: 3600 },
    ]);
  });

  it('rejects invalid chunk planning inputs', () => {
    expect(() =>
      service.planDurationChunks({
        durationSeconds: Number.NaN,
        maxChunkSeconds: 900,
      }),
    ).toThrow('Invalid durationSeconds');

    expect(() =>
      service.planDurationChunks({
        durationSeconds: 60,
        maxChunkSeconds: 0,
      }),
    ).toThrow('Invalid maxChunkSeconds');
  });

  it('rejects non-positive ffprobe duration output', async () => {
    mockedRunCommand.mockResolvedValue('0\n');

    await expect(service.probeDurationSeconds('/tmp/input.wav')).rejects.toThrow(
      'Invalid ffprobe duration',
    );
  });

  it('rejects malformed ffprobe duration output', async () => {
    mockedRunCommand.mockResolvedValue('123abc\n');

    await expect(service.probeDurationSeconds('/tmp/input.wav')).rejects.toThrow(
      'Invalid ffprobe duration',
    );

    mockedRunCommand.mockResolvedValue('123\nunexpected\n');

    await expect(service.probeDurationSeconds('/tmp/input.wav')).rejects.toThrow(
      'Invalid ffprobe duration',
    );
  });

  it('rejects fractional chunk planning inputs', () => {
    expect(() =>
      service.planDurationChunks({
        durationSeconds: 60.5,
        maxChunkSeconds: 30,
      }),
    ).toThrow('Invalid durationSeconds');

    expect(() =>
      service.planDurationChunks({
        durationSeconds: 60,
        maxChunkSeconds: 0.000001,
      }),
    ).toThrow('Invalid maxChunkSeconds');
  });

  it('normalizes audio to mono 64k mp3 after ensuring the output parent exists', async () => {
    mockedRunCommand.mockResolvedValue('');

    await service.normalizeToMp3('/tmp/input.wav', '/storage/out.mp3');

    expect(storage.ensureParent).toHaveBeenCalledWith('/storage/out.mp3');
    expect(mockedRunCommand).toHaveBeenCalledWith('ffmpeg', [
      '-y',
      '-i',
      '/tmp/input.wav',
      '-ac',
      '1',
      '-b:a',
      '64k',
      '/storage/out.mp3',
    ]);
  });

  it('creates 45 minute duration chunks and rejects oversized output', async () => {
    mockedRunCommand.mockResolvedValue('');
    mockedStat
      .mockResolvedValueOnce({ size: 750 } as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValueOnce({ size: 1_250 } as Awaited<ReturnType<typeof stat>>);

    await expect(
      service.createDurationChunks({
        recordingId: '550e8400-e29b-41d4-a716-446655440000',
        normalizedPath: '/storage/normalized.mp3',
        durationSeconds: 3600,
      }),
    ).rejects.toThrow('exceeds configured target size');

    expect(mockedRunCommand).toHaveBeenNthCalledWith(1, 'ffmpeg', [
      '-y',
      '-i',
      '/storage/normalized.mp3',
      '-ss',
      '0',
      '-to',
      '2700',
      '-c',
      'copy',
      '/storage/chunks/550e8400-e29b-41d4-a716-446655440000/000000.mp3',
    ]);
    expect(mockedRunCommand).toHaveBeenNthCalledWith(2, 'ffmpeg', [
      '-y',
      '-i',
      '/storage/normalized.mp3',
      '-ss',
      '2700',
      '-to',
      '3600',
      '-c',
      'copy',
      '/storage/chunks/550e8400-e29b-41d4-a716-446655440000/000001.mp3',
    ]);
  });

  it('resolves from the Nest audio module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AudioModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({ storageRoot: '/storage', chunkTargetBytes: 1_000 })
      .compile();

    expect(moduleRef.get(AudioService)).toBeInstanceOf(AudioService);

    await moduleRef.close();
  });
});
