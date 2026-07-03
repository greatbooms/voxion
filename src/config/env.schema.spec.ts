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

  it('defaults chunk target bytes below the OpenAI 25 MB upload boundary', () => {
    const env = envSchema.parse({
      ...baseEnv,
    });

    expect(env.CHUNK_TARGET_BYTES).toBe(25_165_824);
  });
});
