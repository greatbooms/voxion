import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

type SaveOriginalInput = {
  recordingId: string;
  originalFilename: string;
  buffer: Buffer;
};

@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(
    @Inject(AppConfigService) configOrRoot: AppConfigService | string,
  ) {
    this.root =
      typeof configOrRoot === 'string'
        ? configOrRoot
        : configOrRoot.storageRoot;
  }

  async saveOriginalUpload(input: SaveOriginalInput): Promise<{ path: string }> {
    const path = join(
      this.root,
      'originals',
      input.recordingId,
      this.safeFilename(input.originalFilename),
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.buffer);
    return { path };
  }

  normalizedPath(recordingId: string): string {
    return join(this.root, 'normalized', recordingId, 'normalized.mp3');
  }

  chunkPath(recordingId: string, index: number): string {
    return join(
      this.root,
      'chunks',
      recordingId,
      `${String(index).padStart(6, '0')}.mp3`,
    );
  }

  chunkTranscriptPath(recordingId: string, index: number): string {
    return join(
      this.root,
      'transcripts',
      recordingId,
      'chunks',
      `${String(index).padStart(6, '0')}.json`,
    );
  }

  finalTranscriptPath(recordingId: string): string {
    return join(this.root, 'transcripts', recordingId, 'final.json');
  }

  async ensureParent(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
  }

  private safeFilename(filename: string): string {
    const cleaned = filename
      .replace(/[/\\]/g, '-')
      .replace(/[^a-zA-Z0-9._ -]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    return cleaned.length > 0 ? cleaned : 'recording';
  }
}
