import { stat } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { StorageService } from '../storage/storage.service';
import { runCommand } from './ffmpeg-runner';

const MAX_CHUNK_SECONDS = 45 * 60;

export type PlannedChunk = {
  index: number;
  startSeconds: number;
  endSeconds: number;
};

export type CreatedChunk = PlannedChunk & {
  path: string;
  bytes: number;
};

type PlanDurationChunksInput = {
  durationSeconds: number;
  maxChunkSeconds: number;
};

type CreateDurationChunksInput = {
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

  planDurationChunks(input: PlanDurationChunksInput): PlannedChunk[] {
    this.assertPositiveSafeInteger(input.durationSeconds, 'durationSeconds');
    this.assertPositiveSafeInteger(input.maxChunkSeconds, 'maxChunkSeconds');

    const chunks: PlannedChunk[] = [];
    let startSeconds = 0;

    while (startSeconds < input.durationSeconds) {
      const endSeconds = Math.min(
        startSeconds + input.maxChunkSeconds,
        input.durationSeconds,
      );

      if (endSeconds <= startSeconds) {
        throw new Error('Invalid chunk boundary');
      }

      chunks.push({
        index: chunks.length,
        startSeconds,
        endSeconds,
      });

      startSeconds = endSeconds;
    }

    return chunks;
  }

  async createDurationChunks(
    input: CreateDurationChunksInput,
  ): Promise<CreatedChunk[]> {
    const chunks = this.planDurationChunks({
      durationSeconds: input.durationSeconds,
      maxChunkSeconds: MAX_CHUNK_SECONDS,
    });
    const createdChunks: CreatedChunk[] = [];
    const chunkTargetBytes = this.config.chunkTargetBytes;

    this.assertPositiveFinite(chunkTargetBytes, 'chunkTargetBytes');

    for (const chunk of chunks) {
      const path = this.storage.chunkPath(input.recordingId, chunk.index);

      await this.storage.ensureParent(path);
      await runCommand('ffmpeg', [
        '-y',
        '-i',
        input.normalizedPath,
        '-ss',
        String(chunk.startSeconds),
        '-to',
        String(chunk.endSeconds),
        '-c',
        'copy',
        path,
      ]);

      const stats = await stat(path);

      if (stats.size > chunkTargetBytes) {
        throw new Error(
          `Chunk ${chunk.index} exceeds configured target size: ${stats.size} > ${chunkTargetBytes}`,
        );
      }

      createdChunks.push({
        ...chunk,
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

  private assertPositiveSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid ${name}`);
    }
  }
}
