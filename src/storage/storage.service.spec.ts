import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    const saved = await service.saveOriginalUpload({
      recordingId: 'rec-1',
      originalFilename: '../meeting audio.m4a',
      buffer: Buffer.from('audio'),
    });

    expect(saved.path).toContain('rec-1');
    expect(saved.path.endsWith('meeting-audio.m4a')).toBe(true);
    await expect(stat(saved.path)).resolves.toBeDefined();
  });

  it('builds chunk and transcript paths under the storage root', () => {
    expect(service.chunkPath('rec-1', 2)).toContain('chunks/rec-1/000002.mp3');
    expect(service.finalTranscriptPath('rec-1')).toContain(
      'transcripts/rec-1/final.json',
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

    expect(resolved.finalTranscriptPath('rec-1')).toContain(
      join(root, 'transcripts', 'rec-1', 'final.json'),
    );

    await moduleRef.close();
  });
});
