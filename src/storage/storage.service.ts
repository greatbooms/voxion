import { copyFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

type SaveOriginalInput = {
  recordingId: string;
  originalFilename: string;
  buffer: Buffer;
};

type MoveOriginalInput = {
  recordingId: string;
  originalFilename: string;
  tempPath: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(
    @Inject(AppConfigService) configOrRoot: AppConfigService | string,
  ) {
    const root =
      typeof configOrRoot === 'string'
        ? configOrRoot
        : configOrRoot.storageRoot;
    this.root = resolve(root);
  }

  async saveOriginalUpload(input: SaveOriginalInput): Promise<{ path: string }> {
    const path = this.originalUploadPath(
      input.recordingId,
      input.originalFilename,
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.buffer);
    return { path };
  }

  tempUploadDirectory(): string {
    return this.storagePath('tmp', 'uploads');
  }

  async moveOriginalUpload(input: MoveOriginalInput): Promise<{ path: string }> {
    const tempPath = resolve(input.tempPath);
    this.assertUnderRoot(tempPath);

    const path = this.originalUploadPath(
      input.recordingId,
      input.originalFilename,
    );
    await mkdir(dirname(path), { recursive: true });

    try {
      await rename(tempPath, path);
    } catch (error) {
      if (!this.isCrossDeviceRenameError(error)) {
        throw error;
      }

      await copyFile(tempPath, path);
      await unlink(tempPath);
    }

    return { path };
  }

  normalizedPath(recordingId: string): string {
    return this.storagePath(
      'normalized',
      this.requireRecordingId(recordingId),
      'normalized.mp3',
    );
  }

  chunkPath(recordingId: string, index: number): string {
    return this.storagePath(
      'chunks',
      this.requireRecordingId(recordingId),
      `${this.formatChunkIndex(index)}.mp3`,
    );
  }

  chunkTranscriptPath(recordingId: string, index: number): string {
    return this.storagePath(
      'transcripts',
      this.requireRecordingId(recordingId),
      'chunks',
      `${this.formatChunkIndex(index)}.json`,
    );
  }

  finalTranscriptPath(recordingId: string): string {
    return this.storagePath(
      'transcripts',
      this.requireRecordingId(recordingId),
      'final.json',
    );
  }

  async ensureParent(path: string): Promise<void> {
    this.assertUnderRoot(path);
    await mkdir(dirname(resolve(path)), { recursive: true });
  }

  private safeFilename(filename: string): string {
    const segment = filename.split(/[/\\]+/).filter(Boolean).pop() ?? '';
    const cleaned = segment
      .replace(/[^a-zA-Z0-9._ -]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') {
      return 'recording';
    }

    return cleaned;
  }

  private requireRecordingId(recordingId: string): string {
    if (!UUID_PATTERN.test(recordingId)) {
      throw new Error('Invalid recordingId');
    }

    return recordingId;
  }

  private formatChunkIndex(index: number): string {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error('Invalid chunk index');
    }

    return String(index).padStart(6, '0');
  }

  private originalUploadPath(
    recordingId: string,
    originalFilename: string,
  ): string {
    return this.storagePath(
      'originals',
      this.requireRecordingId(recordingId),
      this.safeFilename(originalFilename),
    );
  }

  private storagePath(...segments: string[]): string {
    const path = resolve(this.root, ...segments);
    this.assertUnderRoot(path);
    return path;
  }

  private assertUnderRoot(path: string): void {
    const resolvedPath = resolve(path);
    const relativePath = relative(this.root, resolvedPath);
    const isInsideRoot =
      relativePath === '' ||
      (!relativePath.startsWith('..') && !isAbsolute(relativePath));

    if (!isInsideRoot) {
      throw new Error('Storage path escapes root');
    }
  }

  private isCrossDeviceRenameError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EXDEV'
    );
  }
}
