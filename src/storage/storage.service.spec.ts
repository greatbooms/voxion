import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Test } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let root: string;
  let service: StorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'voxion-storage-'));
    service = new StorageService(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('sanitizes original filenames and writes upload buffers', async () => {
    const buffer = Buffer.from('audio');
    const saved = await service.saveOriginalUpload({
      recordingId: 'rec-1',
      originalFilename: '../meeting audio.m4a',
      buffer,
    });

    expect(dirname(saved.path)).toBe(join(root, 'originals', 'rec-1'));
    expect(saved.path.endsWith('meeting-audio.m4a')).toBe(true);
    await expect(readFile(saved.path)).resolves.toEqual(buffer);
  });

  it('builds chunk and transcript paths under the storage root', () => {
    expect(service.normalizedPath('rec-1')).toBe(
      join(root, 'normalized', 'rec-1', 'normalized.mp3'),
    );
    expect(service.chunkPath('rec-1', 2)).toBe(
      join(root, 'chunks', 'rec-1', '000002.mp3'),
    );
    expect(service.chunkTranscriptPath('rec-1', 2)).toBe(
      join(root, 'transcripts', 'rec-1', 'chunks', '000002.json'),
    );
    expect(service.finalTranscriptPath('rec-1')).toBe(
      join(root, 'transcripts', 'rec-1', 'final.json'),
    );
  });

  it('resolves from the Nest storage module with the configured root', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StorageModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({ storageRoot: root })
      .compile();

    const resolved = moduleRef.get(StorageService);

    expect(resolved.finalTranscriptPath('rec-1')).toBe(
      join(root, 'transcripts', 'rec-1', 'final.json'),
    );

    await moduleRef.close();
  });
});
