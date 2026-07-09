import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Synology NAS deployment', () => {
  const workflow = readFileSync(
    join(process.cwd(), '.github/workflows/deploy.yml'),
    'utf8',
  );
  const compose = readFileSync(join(process.cwd(), 'deploy/compose.yml'), 'utf8');
  const script = readFileSync(
    join(process.cwd(), 'scripts/deploy-synology.sh'),
    'utf8',
  );
  const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

  it('builds and pushes a production image to GHCR before deploying', () => {
    expect(workflow).toContain('packages: write');
    expect(workflow).toContain('ghcr.io');
    expect(workflow).toContain('docker/build-push-action');
    expect(workflow).toContain('${{ github.sha }}');
    expect(workflow).toContain('tailscale/github-action');
    expect(workflow).toContain('SYNOLOGY_DEPLOY_PATH');
    expect(workflow).toContain('Missing required secret');
    expect(workflow).toContain('REMOTE_PORT: ${{ secrets.SYNOLOGY_PORT }}');
    expect(workflow).not.toContain("|| '2008'");
  });

  it('runs separate API and worker services from the same image on Synology', () => {
    expect(compose).toContain('voxion-api:');
    expect(compose).toContain('voxion-worker:');
    expect(compose).toContain('container_name: voxion-api');
    expect(compose).toContain('container_name: voxion-worker');
    expect(compose).toContain('network_mode: host');
    expect(compose).toContain('PORT: "3000"');
    expect(compose).toContain('node dist/main');
    expect(compose).toContain('node dist/worker');
    expect(compose).toContain('.env.prod');
    expect(compose).toContain('${STORAGE_PATH:-./storage}:/app/storage');
    expect(compose).toContain('STORAGE_ROOT: /app/storage');
  });

  it('keeps logs bounded and checks API health before cleanup', () => {
    expect(compose).toContain('driver: "json-file"');
    expect(compose).toContain('max-size: "100m"');
    expect(compose).toContain('max-file: "5"');
    expect(compose).toContain('http://127.0.0.1:3000/health');
    expect(script).toContain('API_CONTAINER_NAME="${API_CONTAINER_NAME:-voxion-api}"');
    expect(script).toContain('WORKER_CONTAINER_NAME="${WORKER_CONTAINER_NAME:-voxion-worker}"');
    expect(script).toContain('cleanup_unused_app_images');
    expect(script).toContain('Missing runtime env file');
  });

  it('includes ffmpeg and Prisma assets in the production image', () => {
    expect(dockerfile).toContain('apk add --no-cache ffmpeg');
    expect(dockerfile).toContain('npm ci');
    expect(dockerfile).toContain('npx prisma generate');
    expect(dockerfile).toContain('COPY --from=builder /app/prisma ./prisma');
  });
});
