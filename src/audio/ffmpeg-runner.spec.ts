import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { runCommand } from './ffmpeg-runner';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);

class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
}

describe('runCommand', () => {
  let child: FakeChildProcess;

  beforeEach(() => {
    child = new FakeChildProcess();
    mockedSpawn.mockReturnValue(child as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves stdout on exit 0', async () => {
    const result = runCommand('ffmpeg', ['-version']);

    child.stdout.emit('data', Buffer.from('ffmpeg version\n'));
    child.stderr.emit('data', Buffer.from('diagnostics\n'));
    child.emit('close', 0);

    await expect(result).resolves.toBe('ffmpeg version\n');
    expect(mockedSpawn).toHaveBeenCalledWith('ffmpeg', ['-version']);
  });

  it('resolves stderr if stdout is empty on exit 0', async () => {
    const result = runCommand('ffprobe', ['input.mp3']);

    child.stderr.emit('data', Buffer.from('duration=1.23\n'));
    child.emit('close', 0);

    await expect(result).resolves.toBe('duration=1.23\n');
  });

  it('rejects nonzero exit with stderr context', async () => {
    const result = runCommand('ffmpeg', ['bad']);

    child.stdout.emit('data', Buffer.from('stdout context\n'));
    child.stderr.emit('data', Buffer.from('stderr context\n'));
    child.emit('close', 1);

    await expect(result).rejects.toThrow(
      'ffmpeg exited with code 1: stderr context',
    );
  });

  it('rejects spawn error cleanly', async () => {
    const result = runCommand('ffmpeg', ['missing']);
    const error = new Error('spawn ENOENT');

    child.emit('error', error);
    child.emit('close', 0);

    await expect(result).rejects.toBe(error);
  });
});
