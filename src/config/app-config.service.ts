import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL');
  }

  get redis() {
    return {
      host: this.config.get('REDIS_HOST'),
      port: this.config.get('REDIS_PORT'),
      password: this.config.get('REDIS_PASSWORD') || undefined,
      db: this.config.get('REDIS_DB'),
      keyPrefix: this.config.get('REDIS_KEY_PREFIX'),
      maxRetriesPerRequest: this.config.get('REDIS_MAX_RETRIES'),
      connectTimeout: this.config.get('REDIS_CONNECT_TIMEOUT'),
      lazyConnect: this.config.get('REDIS_LAZY_CONNECT'),
    };
  }

  get openaiApiKey(): string | undefined {
    return this.config.get('OPENAI_API_KEY') || undefined;
  }

  get openaiTranscriptionModel(): string {
    return this.config.get('OPENAI_TRANSCRIPTION_MODEL');
  }

  get defaultTranscriptionLanguage(): string {
    return this.config.get('DEFAULT_TRANSCRIPTION_LANGUAGE');
  }

  get notionToken(): string | undefined {
    return this.config.get('NOTION_TOKEN') || undefined;
  }

  get notionDataSourceId(): string | undefined {
    return this.config.get('NOTION_DATA_SOURCE_ID') || undefined;
  }

  get notionVersion(): string {
    return this.config.get('NOTION_VERSION');
  }

  get storageRoot(): string {
    return this.config.get('STORAGE_ROOT');
  }

  get maxUploadBytes(): number {
    return this.config.get('MAX_UPLOAD_BYTES');
  }

  get chunkTargetBytes(): number {
    return this.config.get('CHUNK_TARGET_BYTES');
  }
}
