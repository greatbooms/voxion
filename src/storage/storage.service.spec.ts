import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Test } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  const recordingId = '00000000-0000-4000-8000-000000000001';

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
      recordingId,
      originalFilename: '../meeting audio.m4a',
      buffer,
    });

    expect(dirname(saved.path)).toBe(join(root, 'originals', recordingId));
    expect(basename(saved.path)).toBe('meeting-audio.m4a');
    await expect(readFile(saved.path)).resolves.toEqual(buffer);
  });

  it('moves temp uploads into the originals directory', async () => {
    const tempDirectory = service.tempUploadDirectory();
    const tempPath = join(tempDirectory, 'multer-upload');
    await mkdir(tempDirectory, { recursive: true });
    await writeFile(tempPath, Buffer.from('audio'));

    const saved = await service.moveOriginalUpload({
      recordingId,
      originalFilename: '../meeting audio.m4a',
      tempPath,
    });

    expect(dirname(saved.path)).toBe(join(root, 'originals', recordingId));
    expect(basename(saved.path)).toBe('meeting-audio.m4a');
    await expect(readFile(saved.path)).resolves.toEqual(Buffer.from('audio'));
    await expect(stat(tempPath)).rejects.toThrow();
  });

  it('builds chunk and transcript paths under the storage root', () => {
    expect(service.normalizedPath(recordingId)).toBe(
      join(root, 'normalized', recordingId, 'normalized.mp3'),
    );
    expect(service.chunkPath(recordingId, 2)).toBe(
      join(root, 'chunks', recordingId, '000002.mp3'),
    );
    expect(service.chunkTranscriptPath(recordingId, 2)).toBe(
      join(root, 'transcripts', recordingId, 'chunks', '000002.json'),
    );
    expect(service.finalTranscriptPath(recordingId)).toBe(
      join(root, 'transcripts', recordingId, 'final.json'),
    );
  });

  it('rejects traversal recording IDs', async () => {
    const escapedDirectoryName = `${basename(root)}-escape`;
    const traversalRecordingId = `../../${escapedDirectoryName}`;
    const escapedDirectory = join(dirname(root), escapedDirectoryName);

    expect(() => service.normalizedPath(traversalRecordingId)).toThrow(
      'Invalid recordingId',
    );
    expect(() => service.chunkPath(traversalRecordingId, 2)).toThrow(
      'Invalid recordingId',
    );
    expect(() =>
      service.chunkTranscriptPath(traversalRecordingId, 2),
    ).toThrow('Invalid recordingId');
    expect(() => service.finalTranscriptPath(traversalRecordingId)).toThrow(
      'Invalid recordingId',
    );
    await expect(
      service.moveOriginalUpload({
        recordingId: traversalRecordingId,
        originalFilename: 'meeting.m4a',
        tempPath: join(root, 'tmp', 'uploads', 'upload'),
      }),
    ).rejects.toThrow('Invalid recordingId');

    let rejected = false;
    try {
      await service.saveOriginalUpload({
        recordingId: traversalRecordingId,
        originalFilename: 'meeting.m4a',
        buffer: Buffer.from('audio'),
      });
    } catch {
      rejected = true;
    } finally {
      await rm(escapedDirectory, { recursive: true, force: true });
    }

    expect(rejected).toBe(true);
  });

  it.each([-1, 1.5, NaN])('rejects invalid chunk index %p', (index) => {
    expect(() => service.chunkPath(recordingId, index)).toThrow(
      'Invalid chunk index',
    );
    expect(() => service.chunkTranscriptPath(recordingId, index)).toThrow(
      'Invalid chunk index',
    );
  });

  it.each(['.', '..'])(
    'falls back safely for dot-segment filename %p',
    async (originalFilename) => {
      const buffer = Buffer.from('audio');
      const saved = await service.saveOriginalUpload({
        recordingId,
        originalFilename,
        buffer,
      });

      expect(dirname(saved.path)).toBe(join(root, 'originals', recordingId));
      expect(basename(saved.path)).toBe('recording');
      await expect(readFile(saved.path)).resolves.toEqual(buffer);
    },
  );

  it('resolves from the Nest storage module with the configured root', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StorageModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({ storageRoot: root })
      .compile();

    const resolved = moduleRef.get(StorageService);

    expect(resolved.finalTranscriptPath(recordingId)).toBe(
      join(root, 'transcripts', recordingId, 'final.json'),
    );

    await moduleRef.close();
  });
});
