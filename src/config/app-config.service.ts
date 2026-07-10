import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get redis() {
    return {
      host: this.config.get('REDIS_HOST', { infer: true }),
      port: this.config.get('REDIS_PORT', { infer: true }),
      password: this.config.get('REDIS_PASSWORD', { infer: true }) || undefined,
      db: this.config.get('REDIS_DB', { infer: true }),
      ttl: this.config.get('REDIS_TTL', { infer: true }),
      keyPrefix: this.config.get('REDIS_KEY_PREFIX', { infer: true }),
      maxRetriesPerRequest: this.config.get('REDIS_MAX_RETRIES', {
        infer: true,
      }),
      connectTimeout: this.config.get('REDIS_CONNECT_TIMEOUT', {
        infer: true,
      }),
      lazyConnect: this.config.get('REDIS_LAZY_CONNECT', { infer: true }),
    };
  }

  get openaiApiKey(): string | undefined {
    return this.config.get('OPENAI_API_KEY', { infer: true }) || undefined;
  }

  get openaiTranscriptionModel(): string {
    return this.config.get('OPENAI_TRANSCRIPTION_MODEL', { infer: true });
  }

  get openaiTranscriptionPrompt(): string | undefined {
    return (
      this.config.get('OPENAI_TRANSCRIPTION_PROMPT', { infer: true }) ||
      undefined
    );
  }

  get openaiTranscriptionContextChars(): number {
    return this.config.get('OPENAI_TRANSCRIPTION_CONTEXT_CHARS', {
      infer: true,
    });
  }

  get openaiPostProcessingEnabled(): boolean {
    return this.config.get('OPENAI_POST_PROCESSING_ENABLED', { infer: true });
  }

  get openaiPostProcessingModel(): string {
    return this.config.get('OPENAI_POST_PROCESSING_MODEL', { infer: true });
  }

  get openaiPostProcessingPrompt(): string | undefined {
    return (
      this.config.get('OPENAI_POST_PROCESSING_PROMPT', { infer: true }) ||
      undefined
    );
  }

  get openaiPostProcessingMaxInputChars(): number {
    return this.config.get('OPENAI_POST_PROCESSING_MAX_INPUT_CHARS', {
      infer: true,
    });
  }

  get openaiPostProcessingMaxChunks(): number {
    return this.config.get('OPENAI_POST_PROCESSING_MAX_CHUNKS', {
      infer: true,
    });
  }

  get defaultTranscriptionLanguage(): string {
    return this.config.get('DEFAULT_TRANSCRIPTION_LANGUAGE', { infer: true });
  }

  get notionToken(): string | undefined {
    return this.config.get('NOTION_TOKEN', { infer: true }) || undefined;
  }

  get notionTableDataSourceId(): string | undefined {
    return (
      this.config.get('NOTION_TABLE_DATA_SOURCE_ID', { infer: true }) ||
      undefined
    );
  }

  get notionVersion(): string {
    return this.config.get('NOTION_VERSION', { infer: true });
  }

  get storageRoot(): string {
    return this.config.get('STORAGE_ROOT', { infer: true });
  }

  get maxUploadBytes(): number {
    return this.config.get('MAX_UPLOAD_BYTES', { infer: true });
  }

  get chunkTargetBytes(): number {
    return this.config.get('CHUNK_TARGET_BYTES', { infer: true });
  }

  get chunkMaxDurationSeconds(): number {
    return this.config.get('CHUNK_MAX_DURATION_SECONDS', { infer: true });
  }

  get adminUsername(): string | undefined {
    return this.config.get('ADMIN_USERNAME', { infer: true }) || undefined;
  }

  get adminPassword(): string | undefined {
    return this.config.get('ADMIN_PASSWORD', { infer: true }) || undefined;
  }

  get adminSessionSecret(): string | undefined {
    return this.config.get('ADMIN_SESSION_SECRET', { infer: true }) || undefined;
  }

  get adminSessionTtlSeconds(): number {
    return this.config.get('ADMIN_SESSION_TTL_SECONDS', { infer: true });
  }

  get adminCookieSecure(): boolean {
    return this.config.get('ADMIN_COOKIE_SECURE', { infer: true });
  }

  get apiAccessToken(): string | undefined {
    return this.config.get('API_ACCESS_TOKEN', { infer: true }) || undefined;
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }
}
