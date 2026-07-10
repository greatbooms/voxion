import { envSchema } from './env.schema';

const baseEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/voxion',
};

describe('envSchema', () => {
  it('rejects Redis ports above the TCP port range', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      REDIS_PORT: '65536',
    });

    expect(result.success).toBe(false);
  });

  it('rejects app ports above the TCP port range', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      PORT: '65536',
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid REDIS_LAZY_CONNECT strings', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      REDIS_LAZY_CONNECT: 'maybe',
    });

    expect(result.success).toBe(false);
  });

  it('parses REDIS_LAZY_CONNECT strings as booleans', () => {
    expect(
      envSchema.parse({ ...baseEnv, REDIS_LAZY_CONNECT: 'true' })
        .REDIS_LAZY_CONNECT,
    ).toBe(true);
    expect(
      envSchema.parse({ ...baseEnv, REDIS_LAZY_CONNECT: 'false' })
        .REDIS_LAZY_CONNECT,
    ).toBe(false);
  });

  it('parses ADMIN_COOKIE_SECURE strings as booleans', () => {
    expect(
      envSchema.parse({ ...baseEnv, ADMIN_COOKIE_SECURE: 'true' })
        .ADMIN_COOKIE_SECURE,
    ).toBe(true);
    expect(
      envSchema.parse({ ...baseEnv, ADMIN_COOKIE_SECURE: 'false' })
        .ADMIN_COOKIE_SECURE,
    ).toBe(false);
  });

  it('defaults chunk target bytes below the OpenAI 25 MB upload boundary', () => {
    const env = envSchema.parse({
      ...baseEnv,
    });

    expect(env.CHUNK_TARGET_BYTES).toBe(24_000_000);
  });

  it('defaults chunk max duration below the OpenAI model duration boundary', () => {
    const env = envSchema.parse({
      ...baseEnv,
    });

    expect(env.CHUNK_MAX_DURATION_SECONDS).toBe(1200);
  });

  it('defaults transcription prompt and post-processing options conservatively', () => {
    const env = envSchema.parse({
      ...baseEnv,
    });

    expect(env.OPENAI_TRANSCRIPTION_PROMPT).toBeUndefined();
    expect(env.OPENAI_TRANSCRIPTION_CONTEXT_CHARS).toBe(1200);
    expect(env.OPENAI_POST_PROCESSING_ENABLED).toBe(false);
    expect(env.OPENAI_POST_PROCESSING_MODEL).toBe('gpt-4.1');
    expect(env.OPENAI_POST_PROCESSING_PROMPT).toBeUndefined();
    expect(env.OPENAI_POST_PROCESSING_MAX_INPUT_CHARS).toBe(24000);
    expect(env.OPENAI_POST_PROCESSING_MAX_CHUNKS).toBe(8);
  });

  it('parses the Notion table data source id instead of the database page id', () => {
    const env = envSchema.parse({
      ...baseEnv,
      NOTION_TABLE_DATA_SOURCE_ID: 'table-data-source-id',
    });

    expect(env.NOTION_TABLE_DATA_SOURCE_ID).toBe('table-data-source-id');
  });

  it('defaults admin auth options without opening protected routes', () => {
    const env = envSchema.parse({
      ...baseEnv,
    });

    expect(env.ADMIN_USERNAME).toBeUndefined();
    expect(env.ADMIN_PASSWORD).toBeUndefined();
    expect(env.ADMIN_SESSION_SECRET).toBeUndefined();
    expect(env.ADMIN_SESSION_TTL_SECONDS).toBe(86400);
    expect(env.ADMIN_COOKIE_SECURE).toBe(false);
    expect(env.API_ACCESS_TOKEN).toBeUndefined();
  });
});
