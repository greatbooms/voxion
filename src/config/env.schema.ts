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
  OPENAI_TRANSCRIPTION_PROMPT: z.string().optional(),
  OPENAI_TRANSCRIPTION_CONTEXT_CHARS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(1200),
  OPENAI_POST_PROCESSING_ENABLED: booleanString.default('false'),
  OPENAI_POST_PROCESSING_MODEL: z.string().default('gpt-4.1'),
  OPENAI_POST_PROCESSING_PROMPT: z.string().optional(),
  OPENAI_POST_PROCESSING_MAX_INPUT_CHARS: z.coerce
    .number()
    .int()
    .positive()
    .default(24000),
  OPENAI_POST_PROCESSING_MAX_CHUNKS: z.coerce
    .number()
    .int()
    .positive()
    .default(8),
  DEFAULT_TRANSCRIPTION_LANGUAGE: z.string().default('ko'),
  NOTION_TOKEN: z.string().optional(),
  NOTION_TABLE_DATA_SOURCE_ID: z.string().optional(),
  NOTION_VERSION: z.string().default('2026-03-11'),
  STORAGE_ROOT: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2147483648),
  CHUNK_TARGET_BYTES: z.coerce.number().int().positive().default(24000000),
  CHUNK_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(1200),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_SESSION_SECRET: z.string().optional(),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  ADMIN_COOKIE_SECURE: booleanString.default('false'),
  API_ACCESS_TOKEN: z.string().optional(),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
});

export type Env = z.infer<typeof envSchema>;
