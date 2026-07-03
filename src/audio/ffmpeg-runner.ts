import { spawn } from 'node:child_process';

export function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });

    child.on('error', reject);

    child.on('close', (code) => {
      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');

      if (code === 0) {
        resolve(stdoutText || stderrText);
        return;
      }

      reject(
        new Error(
          `${command} exited with code ${code}: ${stderrText || stdoutText}`,
        ),
      );
    });
  });
}
