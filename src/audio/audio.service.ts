import { stat } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { StorageService } from '../storage/storage.service';
import { runCommand } from './ffmpeg-runner';

const MAX_CHUNK_SECONDS = 45 * 60;
const NORMALIZED_MP3_BYTES_PER_SECOND = 8_000;
const CHUNK_TARGET_SAFETY_MARGIN = 0.9;
const SILENCE_NOISE_THRESHOLD = '-30dB';
const SILENCE_MIN_DURATION_SECONDS = 0.4;
// Forced mid-speech splits cut words apart; the next chunk re-reads a short
// overlap window so the boundary words survive in at least one transcript.
const FORCED_SPLIT_OVERLAP_SECONDS = 2;
// Only add the overlap when the chunk is long enough that re-reading a couple
// of seconds cannot stall chunk progress.
const MIN_CHUNK_SECONDS_FOR_OVERLAP = FORCED_SPLIT_OVERLAP_SECONDS * 4;
const MIN_RESPLIT_SPAN_SECONDS = 2;

export type Silence = {
  startSeconds: number;
  endSeconds: number;
};

export type PlannedChunk = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  overlapSeconds: number;
};

export type CreatedChunk = PlannedChunk & {
  path: string;
  bytes: number;
};

type PlanDurationChunksInput = {
  durationSeconds: number;
  maxChunkSeconds: number;
  silences?: Silence[];
};

type CreateChunksInput = {
  recordingId: string;
  normalizedPath: string;
  durationSeconds: number;
};

@Injectable()
export class AudioService {
  constructor(
    private readonly config: AppConfigService,
    private readonly storage: StorageService,
  ) {}

  async probeDurationSeconds(path: string): Promise<number> {
    const output = await runCommand('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ]);
    const trimmedOutput = output.trim();

    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmedOutput)) {
      throw new Error(`Invalid ffprobe duration: ${trimmedOutput}`);
    }

    const durationSeconds = Number(trimmedOutput);

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`Invalid ffprobe duration: ${trimmedOutput}`);
    }

    return durationSeconds;
  }

  async normalizeToMp3(inputPath: string, outputPath: string): Promise<void> {
    await this.storage.ensureParent(outputPath);
    await runCommand('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-b:a',
      '64k',
      outputPath,
    ]);
  }

  async detectSilences(path: string): Promise<Silence[]> {
    const output = await runCommand('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i',
      path,
      '-af',
      `silencedetect=noise=${SILENCE_NOISE_THRESHOLD}:d=${SILENCE_MIN_DURATION_SECONDS}`,
      '-f',
      'null',
      '-',
    ]);

    return parseSilences(output);
  }

  planDurationChunks(input: PlanDurationChunksInput): PlannedChunk[] {
    this.assertPositiveFinite(input.durationSeconds, 'durationSeconds');
    this.assertMinimumChunkSeconds(input.maxChunkSeconds, 'maxChunkSeconds');

    const splitCandidates = silenceMidpoints(
      input.silences ?? [],
      input.durationSeconds,
    );
    const overlapSeconds =
      input.maxChunkSeconds >= MIN_CHUNK_SECONDS_FOR_OVERLAP
        ? FORCED_SPLIT_OVERLAP_SECONDS
        : 0;
    const chunks: PlannedChunk[] = [];
    let startSeconds = 0;
    let leadingOverlap = 0;

    while (startSeconds < input.durationSeconds) {
      const limit = startSeconds + input.maxChunkSeconds;

      if (limit >= input.durationSeconds) {
        chunks.push({
          index: chunks.length,
          startSeconds,
          endSeconds: input.durationSeconds,
          overlapSeconds: leadingOverlap,
        });
        break;
      }

      // Prefer the latest silence midpoint in the second half of the window
      // so silence-aligned chunks stay reasonably full.
      const searchFloor = startSeconds + input.maxChunkSeconds / 2;
      const silenceSplit = latestCandidateInRange(
        splitCandidates,
        searchFloor,
        limit,
      );

      if (silenceSplit !== undefined) {
        chunks.push({
          index: chunks.length,
          startSeconds,
          endSeconds: silenceSplit,
          overlapSeconds: leadingOverlap,
        });
        startSeconds = silenceSplit;
        leadingOverlap = 0;
        continue;
      }

      chunks.push({
        index: chunks.length,
        startSeconds,
        endSeconds: limit,
        overlapSeconds: leadingOverlap,
      });
      startSeconds = limit - overlapSeconds;
      leadingOverlap = overlapSeconds;
    }

    return chunks;
  }

  async createChunks(input: CreateChunksInput): Promise<CreatedChunk[]> {
    const chunkTargetBytes = this.config.chunkTargetBytes;

    this.assertPositiveFinite(chunkTargetBytes, 'chunkTargetBytes');

    const maxChunkSeconds = this.maxChunkSecondsForTargetBytes(
      chunkTargetBytes,
    );
    const silences =
      input.durationSeconds > maxChunkSeconds
        ? await this.detectSilences(input.normalizedPath)
        : [];
    const pending = this.planDurationChunks({
      durationSeconds: input.durationSeconds,
      maxChunkSeconds,
      silences,
    });
    const createdChunks: CreatedChunk[] = [];

    while (pending.length > 0) {
      const span = pending.shift() as PlannedChunk;
      const index = createdChunks.length;
      const path = this.storage.chunkPath(input.recordingId, index);

      await this.storage.ensureParent(path);
      await runCommand('ffmpeg', [
        '-y',
        '-i',
        input.normalizedPath,
        '-ss',
        String(span.startSeconds),
        '-to',
        String(span.endSeconds),
        '-c',
        'copy',
        path,
      ]);

      const stats = await stat(path);

      if (stats.size > chunkTargetBytes) {
        const spanSeconds = span.endSeconds - span.startSeconds;

        if (spanSeconds < MIN_RESPLIT_SPAN_SECONDS * 2) {
          throw new Error(
            `Chunk ${index} exceeds configured target size and cannot be split further: ${stats.size} > ${chunkTargetBytes}`,
          );
        }

        // Re-split the oversized span in place; the same output path is
        // overwritten by the first half on the next iteration.
        const midSeconds = span.startSeconds + spanSeconds / 2;

        pending.unshift(
          { ...span, endSeconds: midSeconds },
          {
            index: span.index,
            startSeconds: midSeconds,
            endSeconds: span.endSeconds,
            overlapSeconds: 0,
          },
        );
        continue;
      }

      createdChunks.push({
        index,
        startSeconds: span.startSeconds,
        endSeconds: span.endSeconds,
        overlapSeconds: span.overlapSeconds,
        path,
        bytes: stats.size,
      });
    }

    return createdChunks;
  }

  private assertPositiveFinite(value: number, name: string): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid ${name}`);
    }
  }

  private assertMinimumChunkSeconds(value: number, name: string): void {
    if (!Number.isFinite(value) || value < 1) {
      throw new Error(`Invalid ${name}`);
    }
  }

  private maxChunkSecondsForTargetBytes(chunkTargetBytes: number): number {
    const targetSeconds = Math.floor(
      (chunkTargetBytes * CHUNK_TARGET_SAFETY_MARGIN) /
        NORMALIZED_MP3_BYTES_PER_SECOND,
    );

    this.assertMinimumChunkSeconds(targetSeconds, 'maxChunkSeconds');

    return Math.min(targetSeconds, MAX_CHUNK_SECONDS);
  }
}

function parseSilences(ffmpegOutput: string): Silence[] {
  const silences: Silence[] = [];
  let pendingStart: number | undefined;
  const pattern = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(ffmpegOutput)) !== null) {
    const value = Number(match[2]);

    if (!Number.isFinite(value)) {
      continue;
    }

    if (match[1] === 'start') {
      pendingStart = value;
      continue;
    }

    if (pendingStart !== undefined && value > pendingStart) {
      silences.push({ startSeconds: pendingStart, endSeconds: value });
    }

    pendingStart = undefined;
  }

  return silences;
}

function silenceMidpoints(
  silences: Silence[],
  durationSeconds: number,
): number[] {
  return silences
    .map((silence) => (silence.startSeconds + silence.endSeconds) / 2)
    .filter((midpoint) => midpoint > 0 && midpoint < durationSeconds)
    .sort((left, right) => left - right);
}

function latestCandidateInRange(
  candidates: number[],
  exclusiveFloor: number,
  inclusiveCeiling: number,
): number | undefined {
  let latest: number | undefined;

  for (const candidate of candidates) {
    if (candidate > inclusiveCeiling) {
      break;
    }

    if (candidate > exclusiveFloor) {
      latest = candidate;
    }
  }

  return latest;
}
