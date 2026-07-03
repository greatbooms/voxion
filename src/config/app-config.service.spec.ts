import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { Env } from './env.schema';

const makeService = (overrides: Partial<Env> = {}) => {
  const values: Env = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/voxion',
    REDIS_KEY_PREFIX: 'test:',
    REDIS_HOST: 'redis',
    REDIS_PORT: 6380,
    REDIS_DB: 1,
    REDIS_TTL: 120,
    REDIS_MAX_RETRIES: 5,
    REDIS_CONNECT_TIMEOUT: 5000,
    REDIS_LAZY_CONNECT: false,
    OPENAI_TRANSCRIPTION_MODEL: 'gpt-4o-transcribe',
    DEFAULT_TRANSCRIPTION_LANGUAGE: 'ko',
    NOTION_VERSION: '2026-03-11',
    STORAGE_ROOT: './tmp-storage',
    MAX_UPLOAD_BYTES: 1024,
    CHUNK_TARGET_BYTES: 512,
    PORT: 4000,
    ...overrides,
  };
  const config = {
    get: jest.fn(<K extends keyof Env>(key: K): Env[K] => values[key]),
  };

  return new AppConfigService(config as unknown as ConfigService<Env, true>);
};

describe('AppConfigService', () => {
  it('exposes the app port', () => {
    const service = makeService({ PORT: 4500 });

    expect(service.port).toBe(4500);
  });

  it('exposes Redis TTL with the Redis settings', () => {
    const service = makeService({ REDIS_TTL: 90 });

    expect(service.redis.ttl).toBe(90);
  });
});
