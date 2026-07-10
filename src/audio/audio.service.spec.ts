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

const recordingId = '550e8400-e29b-41d4-a716-446655440000';
const chunkPathFor = (index: number) =>
  `/storage/chunks/${recordingId}/${String(index).padStart(6, '0')}.mp3`;

const silencedetectArgs = (path: string) => [
  '-hide_banner',
  '-nostats',
  '-i',
  path,
  '-af',
  'silencedetect=noise=-30dB:d=0.4',
  '-f',
  'null',
  '-',
];

const cutArgs = (start: number, end: number, index: number) => [
  '-y',
  '-i',
  '/storage/normalized.mp3',
  '-ss',
  String(start),
  '-to',
  String(end),
  '-c',
  'copy',
  chunkPathFor(index),
];

describe('AudioService', () => {
  const config = { chunkTargetBytes: 25_165_824, chunkMaxDurationSeconds: 1200 };
  const storage = {
    ensureParent: jest.fn(),
    chunkPath: jest.fn((id: string, index: number) =>
      `/storage/chunks/${id}/${String(index).padStart(6, '0')}.mp3`,
    ),
  };

  let service: AudioService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.chunkTargetBytes = 25_165_824;
    config.chunkMaxDurationSeconds = 1200;
    service = new AudioService(
      config as unknown as AppConfigService,
      storage as unknown as StorageService,
    );
  });

  it('plans forced duration splits with a trailing overlap window', () => {
    expect(
      service.planDurationChunks({
        durationSeconds: 3600,
        maxChunkSeconds: 900,
      }),
    ).toEqual([
      { index: 0, startSeconds: 0, endSeconds: 900, overlapSeconds: 0 },
      { index: 1, startSeconds: 898, endSeconds: 1798, overlapSeconds: 2 },
      { index: 2, startSeconds: 1796, endSeconds: 2696, overlapSeconds: 2 },
      { index: 3, startSeconds: 2694, endSeconds: 3594, overlapSeconds: 2 },
      { index: 4, startSeconds: 3592, endSeconds: 3600, overlapSeconds: 2 },
    ]);
  });

  it('plans fractional total duration with a fractional final chunk end', () => {
    expect(
      service.planDurationChunks({
        durationSeconds: 3600.5,
        maxChunkSeconds: 900,
      }),
    ).toEqual([
      { index: 0, startSeconds: 0, endSeconds: 900, overlapSeconds: 0 },
      { index: 1, startSeconds: 898, endSeconds: 1798, overlapSeconds: 2 },
      { index: 2, startSeconds: 1796, endSeconds: 2696, overlapSeconds: 2 },
      { index: 3, startSeconds: 2694, endSeconds: 3594, overlapSeconds: 2 },
      { index: 4, startSeconds: 3592, endSeconds: 3600.5, overlapSeconds: 2 },
    ]);
  });

  it('prefers silence midpoints over forced splits and skips the overlap there', () => {
    expect(
      service.planDurationChunks({
        durationSeconds: 1800,
        maxChunkSeconds: 900,
        silences: [{ startSeconds: 799, endSeconds: 801 }],
      }),
    ).toEqual([
      { index: 0, startSeconds: 0, endSeconds: 800, overlapSeconds: 0 },
      { index: 1, startSeconds: 800, endSeconds: 1700, overlapSeconds: 0 },
      { index: 2, startSeconds: 1698, endSeconds: 1800, overlapSeconds: 2 },
    ]);
  });

  it('ignores silence midpoints in the first half of the window', () => {
    expect(
      service.planDurationChunks({
        durationSeconds: 1000,
        maxChunkSeconds: 900,
        silences: [{ startSeconds: 100, endSeconds: 102 }],
      }),
    ).toEqual([
      { index: 0, startSeconds: 0, endSeconds: 900, overlapSeconds: 0 },
      { index: 1, startSeconds: 898, endSeconds: 1000, overlapSeconds: 2 },
    ]);
  });

  it('skips the overlap window for very short chunk targets', () => {
    expect(
      service.planDurationChunks({
        durationSeconds: 3,
        maxChunkSeconds: 1,
      }),
    ).toEqual([
      { index: 0, startSeconds: 0, endSeconds: 1, overlapSeconds: 0 },
      { index: 1, startSeconds: 1, endSeconds: 2, overlapSeconds: 0 },
      { index: 2, startSeconds: 2, endSeconds: 3, overlapSeconds: 0 },
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

  it('accepts fractional ffprobe duration output', async () => {
    mockedRunCommand.mockResolvedValue('123.456\n');

    await expect(service.probeDurationSeconds('/tmp/input.wav')).resolves.toBe(
      123.456,
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

  it('rejects max chunk durations below one second', () => {
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

  it('parses silencedetect output into silence ranges', async () => {
    mockedRunCommand.mockResolvedValue(
      [
        '[silencedetect @ 0x0] silence_start: 12.5',
        '[silencedetect @ 0x0] silence_end: 14.25 | silence_duration: 1.75',
        '[silencedetect @ 0x0] silence_start: 100',
        '[silencedetect @ 0x0] silence_end: 101 | silence_duration: 1',
        '[silencedetect @ 0x0] silence_start: 200',
      ].join('\n'),
    );

    await expect(service.detectSilences('/storage/normalized.mp3')).resolves.toEqual(
      [
        { startSeconds: 12.5, endSeconds: 14.25 },
        { startSeconds: 100, endSeconds: 101 },
      ],
    );

    expect(mockedRunCommand).toHaveBeenCalledWith(
      'ffmpeg',
      silencedetectArgs('/storage/normalized.mp3'),
    );
  });

  it('cuts a single chunk without running silence detection', async () => {
    mockedRunCommand.mockResolvedValue('');
    mockedStat.mockResolvedValue({ size: 750 } as Awaited<
      ReturnType<typeof stat>
    >);

    const chunks = await service.createChunks({
      recordingId,
      normalizedPath: '/storage/normalized.mp3',
      durationSeconds: 60,
    });

    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
    expect(mockedRunCommand).toHaveBeenCalledWith('ffmpeg', cutArgs(0, 60, 0));
    expect(chunks).toEqual([
      {
        index: 0,
        startSeconds: 0,
        endSeconds: 60,
        overlapSeconds: 0,
        path: chunkPathFor(0),
        bytes: 750,
      },
    ]);
  });

  it('splits long audio at detected silences before forcing duration cuts', async () => {
    mockedRunCommand
      .mockResolvedValueOnce(
        [
          'silence_start: 2000',
          'silence_end: 2004 | silence_duration: 4',
        ].join('\n'),
      )
      .mockResolvedValue('');
    mockedStat.mockResolvedValue({ size: 750 } as Awaited<
      ReturnType<typeof stat>
    >);

    const chunks = await service.createChunks({
      recordingId,
      normalizedPath: '/storage/normalized.mp3',
      durationSeconds: 3600,
    });

    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      1,
      'ffmpeg',
      silencedetectArgs('/storage/normalized.mp3'),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      2,
      'ffmpeg',
      cutArgs(0, 1200, 0),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      3,
      'ffmpeg',
      cutArgs(1198, 2002, 1),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      4,
      'ffmpeg',
      cutArgs(2002, 3202, 2),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      5,
      'ffmpeg',
      cutArgs(3200, 3600, 3),
    );
    expect(chunks).toEqual([
      {
        index: 0,
        startSeconds: 0,
        endSeconds: 1200,
        overlapSeconds: 0,
        path: chunkPathFor(0),
        bytes: 750,
      },
      {
        index: 1,
        startSeconds: 1198,
        endSeconds: 2002,
        overlapSeconds: 2,
        path: chunkPathFor(1),
        bytes: 750,
      },
      {
        index: 2,
        startSeconds: 2002,
        endSeconds: 3202,
        overlapSeconds: 0,
        path: chunkPathFor(2),
        bytes: 750,
      },
      {
        index: 3,
        startSeconds: 3200,
        endSeconds: 3600,
        overlapSeconds: 2,
        path: chunkPathFor(3),
        bytes: 750,
      },
    ]);
  });

  it('caps chunk duration below the OpenAI model duration limit', async () => {
    mockedRunCommand.mockResolvedValue('');
    mockedStat.mockResolvedValue({ size: 750 } as Awaited<
      ReturnType<typeof stat>
    >);

    const chunks = await service.createChunks({
      recordingId,
      normalizedPath: '/storage/normalized.mp3',
      durationSeconds: 2651.557,
    });

    expect(chunks.every((chunk) => chunk.endSeconds - chunk.startSeconds <= 1200)).toBe(
      true,
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      2,
      'ffmpeg',
      cutArgs(0, 1200, 0),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      3,
      'ffmpeg',
      cutArgs(1198, 2398, 1),
    );
  });

  it('re-splits oversized chunk output instead of failing the job', async () => {
    mockedRunCommand.mockResolvedValue('');
    mockedStat
      .mockResolvedValueOnce({ size: 750 } as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValueOnce({
        size: 25_165_825,
      } as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({ size: 900 } as Awaited<ReturnType<typeof stat>>);

    const chunks = await service.createChunks({
      recordingId,
      normalizedPath: '/storage/normalized.mp3',
      durationSeconds: 3600,
    });

    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      1,
      'ffmpeg',
      silencedetectArgs('/storage/normalized.mp3'),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      2,
      'ffmpeg',
      cutArgs(0, 1200, 0),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      3,
      'ffmpeg',
      cutArgs(1198, 2398, 1),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      4,
      'ffmpeg',
      cutArgs(1198, 1798, 1),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      5,
      'ffmpeg',
      cutArgs(1798, 2398, 2),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      6,
      'ffmpeg',
      cutArgs(2396, 3596, 3),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      7,
      'ffmpeg',
      cutArgs(3594, 3600, 4),
    );
    expect(chunks).toEqual([
      {
        index: 0,
        startSeconds: 0,
        endSeconds: 1200,
        overlapSeconds: 0,
        path: chunkPathFor(0),
        bytes: 750,
      },
      {
        index: 1,
        startSeconds: 1198,
        endSeconds: 1798,
        overlapSeconds: 2,
        path: chunkPathFor(1),
        bytes: 900,
      },
      {
        index: 2,
        startSeconds: 1798,
        endSeconds: 2398,
        overlapSeconds: 0,
        path: chunkPathFor(2),
        bytes: 900,
      },
      {
        index: 3,
        startSeconds: 2396,
        endSeconds: 3596,
        overlapSeconds: 2,
        path: chunkPathFor(3),
        bytes: 900,
      },
      {
        index: 4,
        startSeconds: 3594,
        endSeconds: 3600,
        overlapSeconds: 2,
        path: chunkPathFor(4),
        bytes: 900,
      },
    ]);
  });

  it('fails when an oversized chunk is already too short to split', async () => {
    config.chunkTargetBytes = 16_000;
    mockedRunCommand.mockResolvedValue('');
    mockedStat.mockResolvedValue({
      size: 16_001,
    } as Awaited<ReturnType<typeof stat>>);

    await expect(
      service.createChunks({
        recordingId,
        normalizedPath: '/storage/normalized.mp3',
        durationSeconds: 3,
      }),
    ).rejects.toThrow('cannot be split further');
  });

  it('resolves from the Nest audio module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AudioModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({
        storageRoot: '/storage',
        chunkTargetBytes: 1_000,
        chunkMaxDurationSeconds: 1200,
      })
      .compile();

    expect(moduleRef.get(AudioService)).toBeInstanceOf(AudioService);

    await moduleRef.close();
  });
});
