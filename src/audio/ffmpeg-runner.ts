import { spawn } from 'node:child_process';

export function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');

      if (code === 0) {
        settled = true;
        resolve(stdoutText || stderrText);
        return;
      }

      settled = true;
      reject(
        new Error(
          `${command} exited with code ${code}: ${stderrText || stdoutText}`,
        ),
      );
    });
  });
}
