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
    OPENAI_TRANSCRIPTION_CONTEXT_CHARS: 1200,
    OPENAI_POST_PROCESSING_ENABLED: false,
    OPENAI_POST_PROCESSING_MODEL: 'gpt-4.1',
    OPENAI_POST_PROCESSING_MAX_INPUT_CHARS: 24000,
    OPENAI_POST_PROCESSING_MAX_CHUNKS: 8,
    DEFAULT_TRANSCRIPTION_LANGUAGE: 'ko',
    NOTION_VERSION: '2026-03-11',
    STORAGE_ROOT: './tmp-storage',
    MAX_UPLOAD_BYTES: 1024,
    CHUNK_TARGET_BYTES: 512,
    CHUNK_MAX_DURATION_SECONDS: 1200,
    ADMIN_SESSION_TTL_SECONDS: 86400,
    ADMIN_COOKIE_SECURE: false,
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

  it('exposes chunk max duration seconds', () => {
    const service = makeService({ CHUNK_MAX_DURATION_SECONDS: 900 });

    expect(service.chunkMaxDurationSeconds).toBe(900);
  });

  it('exposes transcription prompt and post-processing settings', () => {
    const service = makeService({
      OPENAI_TRANSCRIPTION_PROMPT: 'CMT, Notion, PostgreSQL',
      OPENAI_TRANSCRIPTION_CONTEXT_CHARS: 800,
      OPENAI_POST_PROCESSING_ENABLED: true,
      OPENAI_POST_PROCESSING_MODEL: 'gpt-4.1-mini',
      OPENAI_POST_PROCESSING_PROMPT: '회의록 용어를 보정합니다.',
      OPENAI_POST_PROCESSING_MAX_INPUT_CHARS: 12000,
      OPENAI_POST_PROCESSING_MAX_CHUNKS: 4,
    });

    expect(service.openaiTranscriptionPrompt).toBe('CMT, Notion, PostgreSQL');
    expect(service.openaiTranscriptionContextChars).toBe(800);
    expect(service.openaiPostProcessingEnabled).toBe(true);
    expect(service.openaiPostProcessingModel).toBe('gpt-4.1-mini');
    expect(service.openaiPostProcessingPrompt).toBe('회의록 용어를 보정합니다.');
    expect(service.openaiPostProcessingMaxInputChars).toBe(12000);
    expect(service.openaiPostProcessingMaxChunks).toBe(4);
  });

  it('exposes the Notion table data source id', () => {
    const service = makeService({
      NOTION_TABLE_DATA_SOURCE_ID: 'table-data-source-id',
    });

    expect(service.notionTableDataSourceId).toBe('table-data-source-id');
  });

  it('exposes admin auth settings', () => {
    const service = makeService({
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'password',
      ADMIN_SESSION_SECRET: 'secret',
      ADMIN_SESSION_TTL_SECONDS: 3600,
      ADMIN_COOKIE_SECURE: true,
      API_ACCESS_TOKEN: 'token',
    });

    expect(service.adminUsername).toBe('admin');
    expect(service.adminPassword).toBe('password');
    expect(service.adminSessionSecret).toBe('secret');
    expect(service.adminSessionTtlSeconds).toBe(3600);
    expect(service.adminCookieSecure).toBe(true);
    expect(service.apiAccessToken).toBe('token');
  });
});
