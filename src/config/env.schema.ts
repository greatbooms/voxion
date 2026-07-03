import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_KEY_PREFIX: z.string().default('local:'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().max(65535).default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_TTL: z.coerce.number().int().positive().default(300),
  REDIS_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  REDIS_CONNECT_TIMEOUT: z.coerce.number().int().positive().default(10000),
  REDIS_LAZY_CONNECT: booleanString.default('true'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default('gpt-4o-transcribe'),
  DEFAULT_TRANSCRIPTION_LANGUAGE: z.string().default('ko'),
  NOTION_TOKEN: z.string().optional(),
  NOTION_DATA_SOURCE_ID: z.string().optional(),
  NOTION_VERSION: z.string().default('2026-03-11'),
  STORAGE_ROOT: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2147483648),
  CHUNK_TARGET_BYTES: z.coerce.number().int().positive().default(24000000),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
});

export type Env = z.infer<typeof envSchema>;
