# Voxion Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an API-only NestJS service that uploads audio recordings, splits large files under the OpenAI STT upload limit, transcribes chunks in a BullMQ worker, and writes one row per recording to a Notion database.

**Architecture:** A single NestJS codebase runs as two processes: `api` for HTTP upload/status endpoints and `worker` for BullMQ background processing. PostgreSQL and Redis are existing local Docker services; Prisma stores recording/chunk/job state; local filesystem stores uploaded audio, chunk files, and transcript JSON.

**Tech Stack:** TypeScript, NestJS, Prisma, PostgreSQL, BullMQ, Redis, OpenAI Node SDK, Notion JS SDK, ffmpeg/ffprobe, Jest, Supertest.

---

## File Structure

Create this structure:

```text
.
├── .env
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── jest.config.ts
├── README.md
├── prisma/
│   └── schema.prisma
├── src/
│   ├── main.ts
│   ├── worker.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── env.schema.ts
│   │   ├── app-config.module.ts
│   │   └── app-config.service.ts
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── storage/
│   │   ├── storage.module.ts
│   │   ├── storage.service.ts
│   │   └── storage.service.spec.ts
│   ├── recordings/
│   │   ├── recordings.module.ts
│   │   ├── recordings.controller.ts
│   │   ├── recordings.service.ts
│   │   ├── dto/create-recording.dto.ts
│   │   └── recordings.controller.spec.ts
│   ├── jobs/
│   │   ├── jobs.module.ts
│   │   ├── jobs.constants.ts
│   │   ├── transcription.queue.ts
│   │   └── transcription.processor.ts
│   ├── audio/
│   │   ├── audio.module.ts
│   │   ├── audio.service.ts
│   │   ├── ffmpeg-runner.ts
│   │   └── audio.service.spec.ts
│   ├── transcription/
│   │   ├── transcription.module.ts
│   │   ├── openai-transcription.service.ts
│   │   ├── transcript-merge.service.ts
│   │   └── transcript-merge.service.spec.ts
│   └── notion/
│       ├── notion.module.ts
│       ├── notion.service.ts
│       ├── notion-blocks.ts
│       └── notion-blocks.spec.ts
└── test/
    └── app.e2e-spec.ts
```

Responsibility boundaries:

- `config`: parse and type environment variables.
- `prisma`: own database connection lifecycle.
- `storage`: own all filesystem paths and file writes.
- `recordings`: own HTTP API and recording orchestration entrypoint.
- `jobs`: own BullMQ connection, enqueueing, worker processor, and state transitions.
- `audio`: own ffprobe/ffmpeg probing, normalization, silence-aware chunk planning, and chunk creation.
- `transcription`: own OpenAI transcription calls and transcript merge logic.
- `notion`: own Notion page creation and block batching.

## Task 1: Bootstrap NestJS Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `nest-cli.json`
- Create: `jest.config.ts`
- Create: `src/main.ts`
- Create: `src/app.module.ts`
- Create: `test/app.e2e-spec.ts`

- [ ] **Step 1: Create package metadata and scripts**

Create `package.json`:

```json
{
  "name": "voxion",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:worker": "ts-node -r tsconfig-paths/register src/worker.ts",
    "lint": "eslint \"src/**/*.ts\" \"test/**/*.ts\"",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config jest.config.ts --runInBand test/app.e2e-spec.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  },
  "dependencies": {
    "@nestjs/bullmq": "^11.0.0",
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@notionhq/client": "^3.0.0",
    "@prisma/client": "^6.0.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.0.0",
    "multer": "^2.0.0",
    "openai": "^5.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/express": "^5.0.0",
    "@types/jest": "^30.0.0",
    "@types/multer": "^2.0.0",
    "@types/node": "^24.0.0",
    "@types/supertest": "^6.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "jest": "^30.0.0",
    "prisma": "^6.0.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.0.0",
    "ts-node": "^10.9.0",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and npm exits with code 0.

- [ ] **Step 3: Add TypeScript and Nest config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*.spec.ts"]
}
```

Create `nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}
```

Create `jest.config.ts`:

```ts
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;
```

- [ ] **Step 4: Add minimal Nest application**

Create `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
```

Create `src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
```

Create `test/app.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('App', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 for unknown routes', async () => {
    await request(app.getHttpServer()).get('/missing').expect(404);
  });
});
```

- [ ] **Step 5: Verify bootstrap**

Run:

```bash
npm test
npm run build
```

Expected: tests pass and `dist/` is generated.

## Task 2: Config Validation

**Files:**
- Create: `src/config/env.schema.ts`
- Create: `src/config/app-config.module.ts`
- Create: `src/config/app-config.service.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Add env schema**

Create `src/config/env.schema.ts`:

```ts
import { z } from 'zod';

const booleanString = z
  .string()
  .transform((value) => value === 'true');

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_KEY_PREFIX: z.string().default('local:'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
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
  CHUNK_TARGET_BYTES: z.coerce.number().int().positive().default(25165824),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;
```

- [ ] **Step 2: Add config service**

Create `src/config/app-config.service.ts`:

```ts
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
```

- [ ] **Step 3: Add config module**

Create `src/config/app-config.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { envSchema } from './env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => envSchema.parse(env),
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
```

- [ ] **Step 4: Register config module**

Modify `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';

@Module({
  imports: [AppConfigModule],
})
export class AppModule {}
```

- [ ] **Step 5: Verify config build**

Run:

```bash
npm run build
```

Expected: build passes with no TypeScript errors.

## Task 3: Prisma Schema and Database

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/prisma/prisma.module.ts`
- Create: `src/prisma/prisma.service.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Add Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum RecordingStatus {
  UPLOADED
  QUEUED
  PROBING
  CHUNKING
  TRANSCRIBING
  MERGING
  UPLOADING_TO_NOTION
  COMPLETED
  FAILED
}

enum ChunkStatus {
  PENDING
  TRANSCRIBING
  COMPLETED
  FAILED
}

enum JobRunStatus {
  QUEUED
  ACTIVE
  COMPLETED
  FAILED
}

model Recording {
  id                String           @id @default(uuid())
  status            RecordingStatus  @default(UPLOADED)
  title             String?
  originalFilename  String
  mimeType          String
  originalPath      String
  originalBytes     BigInt
  normalizedPath    String?
  durationSeconds   Decimal?         @db.Decimal(12, 3)
  language          String
  model             String
  chunkCount        Int              @default(0)
  transcriptPath    String?
  transcriptText    String?
  notionPageId      String?
  notionUrl         String?
  errorCode         String?
  errorMessage      String?
  recordedAt        DateTime?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  completedAt       DateTime?
  chunks            RecordingChunk[]
  jobRuns           JobRun[]
}

model RecordingChunk {
  id             String       @id @default(uuid())
  recordingId    String
  recording      Recording    @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  index          Int
  status         ChunkStatus  @default(PENDING)
  path           String
  bytes          BigInt
  startSeconds   Decimal      @db.Decimal(12, 3)
  endSeconds     Decimal      @db.Decimal(12, 3)
  transcriptPath String?
  text           String?
  errorCode      String?
  errorMessage   String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@unique([recordingId, index])
  @@index([recordingId])
}

model JobRun {
  id           String       @id @default(uuid())
  recordingId  String
  recording    Recording    @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  queueName    String
  bullJobId    String
  status       JobRunStatus @default(QUEUED)
  attemptsMade Int          @default(0)
  lastError    String?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  @@index([recordingId])
  @@index([queueName, bullJobId])
}
```

- [ ] **Step 2: Generate Prisma client and migrate**

Run:

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

Expected: Prisma creates a migration and connects to `voxion_db` using the existing local PostgreSQL service.

- [ ] **Step 3: Add Prisma service**

Create `src/prisma/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Create `src/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 4: Register Prisma module**

Modify `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [AppConfigModule, PrismaModule],
})
export class AppModule {}
```

- [ ] **Step 5: Verify Prisma setup**

Run:

```bash
npm run build
```

Expected: build passes and generated Prisma enums are importable.

## Task 4: Storage Service

**Files:**
- Create: `src/storage/storage.module.ts`
- Create: `src/storage/storage.service.ts`
- Create: `src/storage/storage.service.spec.ts`

- [ ] **Step 1: Write storage tests**

Create `src/storage/storage.service.spec.ts`:

```ts
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let root: string;
  let service: StorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'voxion-storage-'));
    service = new StorageService(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('sanitizes original filenames and writes upload buffers', async () => {
    const saved = await service.saveOriginalUpload({
      recordingId: 'rec-1',
      originalFilename: '../meeting audio.m4a',
      buffer: Buffer.from('audio'),
    });

    expect(saved.path).toContain('rec-1');
    expect(saved.path.endsWith('meeting-audio.m4a')).toBe(true);
    await expect(stat(saved.path)).resolves.toBeDefined();
  });

  it('builds chunk and transcript paths under the storage root', () => {
    expect(service.chunkPath('rec-1', 2)).toContain('chunks/rec-1/000002.mp3');
    expect(service.finalTranscriptPath('rec-1')).toContain(
      'transcripts/rec-1/final.json',
    );
  });
});
```

- [ ] **Step 2: Run failing storage tests**

Run:

```bash
npm test -- src/storage/storage.service.spec.ts
```

Expected: FAIL because `StorageService` does not exist.

- [ ] **Step 3: Implement storage service**

Create `src/storage/storage.service.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

type SaveOriginalInput = {
  recordingId: string;
  originalFilename: string;
  buffer: Buffer;
};

@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(configOrRoot: AppConfigService | string) {
    this.root =
      typeof configOrRoot === 'string'
        ? configOrRoot
        : configOrRoot.storageRoot;
  }

  async saveOriginalUpload(input: SaveOriginalInput): Promise<{ path: string }> {
    const path = join(
      this.root,
      'originals',
      input.recordingId,
      this.safeFilename(input.originalFilename),
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.buffer);
    return { path };
  }

  normalizedPath(recordingId: string): string {
    return join(this.root, 'normalized', recordingId, 'normalized.mp3');
  }

  chunkPath(recordingId: string, index: number): string {
    return join(
      this.root,
      'chunks',
      recordingId,
      `${String(index).padStart(6, '0')}.mp3`,
    );
  }

  chunkTranscriptPath(recordingId: string, index: number): string {
    return join(
      this.root,
      'transcripts',
      recordingId,
      'chunks',
      `${String(index).padStart(6, '0')}.json`,
    );
  }

  finalTranscriptPath(recordingId: string): string {
    return join(this.root, 'transcripts', recordingId, 'final.json');
  }

  async ensureParent(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
  }

  private safeFilename(filename: string): string {
    const cleaned = filename
      .replace(/[/\\]/g, '-')
      .replace(/[^a-zA-Z0-9._ -]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    return cleaned.length > 0 ? cleaned : 'recording';
  }
}
```

Create `src/storage/storage.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
```

- [ ] **Step 4: Run storage tests**

Run:

```bash
npm test -- src/storage/storage.service.spec.ts
```

Expected: PASS.

## Task 5: Recordings Upload API

**Files:**
- Create: `src/recordings/dto/create-recording.dto.ts`
- Create: `src/recordings/recordings.module.ts`
- Create: `src/recordings/recordings.controller.ts`
- Create: `src/recordings/recordings.service.ts`
- Create: `src/recordings/recordings.controller.spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create DTO**

Create `src/recordings/dto/create-recording.dto.ts`:

```ts
export type CreateRecordingDto = {
  title?: string;
  language?: string;
  recordedAt?: string;
};
```

- [ ] **Step 2: Implement service**

Create `src/recordings/recordings.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { RecordingStatus } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateRecordingDto } from './dto/create-recording.dto';

const SUPPORTED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/mpga',
  'audio/m4a',
  'audio/wav',
  'audio/webm',
  'video/mp4',
]);

type UploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Injectable()
export class RecordingsService {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(dto: CreateRecordingDto, file: UploadFile) {
    if (!file) {
      throw new BadRequestException('Audio file is required.');
    }

    if (file.size > this.config.maxUploadBytes) {
      throw new PayloadTooLargeException('Audio file exceeds max upload size.');
    }

    if (!SUPPORTED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`Unsupported audio type: ${file.mimetype}`);
    }

    const recording = await this.prisma.recording.create({
      data: {
        status: RecordingStatus.UPLOADED,
        title: dto.title,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        originalPath: '',
        originalBytes: BigInt(file.size),
        language: dto.language || this.config.defaultTranscriptionLanguage,
        model: this.config.openaiTranscriptionModel,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      },
    });

    const saved = await this.storage.saveOriginalUpload({
      recordingId: recording.id,
      originalFilename: file.originalname,
      buffer: file.buffer,
    });

    const updated = await this.prisma.recording.update({
      where: { id: recording.id },
      data: {
        originalPath: saved.path,
        status: RecordingStatus.QUEUED,
      },
    });

    return {
      recordingId: updated.id,
      status: updated.status,
    };
  }

  async findOne(id: string) {
    return this.prisma.recording.findUniqueOrThrow({
      where: { id },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });
  }
}
```

- [ ] **Step 3: Implement controller**

Create `src/recordings/recordings.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CreateRecordingDto } from './dto/create-recording.dto';
import { RecordingsService } from './recordings.service';

@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async create(
    @Body() dto: CreateRecordingDto,
    @UploadedFile()
    file: Express.Multer.File,
  ) {
    return this.recordings.create(dto, file);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.recordings.findOne(id);
  }
}
```

- [ ] **Step 4: Register module**

Create `src/recordings/recordings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';

@Module({
  imports: [StorageModule],
  controllers: [RecordingsController],
  providers: [RecordingsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
```

Modify `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RecordingsModule } from './recordings/recordings.module';

@Module({
  imports: [AppConfigModule, PrismaModule, RecordingsModule],
})
export class AppModule {}
```

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected: build passes.

## Task 6: BullMQ Queue and Worker Shell

**Files:**
- Create: `src/jobs/jobs.constants.ts`
- Create: `src/jobs/transcription.queue.ts`
- Create: `src/jobs/transcription.processor.ts`
- Create: `src/jobs/jobs.module.ts`
- Create: `src/worker.ts`
- Modify: `src/recordings/recordings.service.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Add queue constants**

Create `src/jobs/jobs.constants.ts`:

```ts
export const TRANSCRIPTION_QUEUE = 'transcription';
export const PROCESS_RECORDING_JOB = 'process-recording';
```

- [ ] **Step 2: Add queue service**

Create `src/jobs/transcription.queue.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PROCESS_RECORDING_JOB, TRANSCRIPTION_QUEUE } from './jobs.constants';

export type ProcessRecordingJobData = {
  recordingId: string;
};

@Injectable()
export class TranscriptionQueue {
  constructor(
    @InjectQueue(TRANSCRIPTION_QUEUE)
    private readonly queue: Queue<ProcessRecordingJobData>,
  ) {}

  async enqueue(recordingId: string): Promise<string> {
    const job = await this.queue.add(
      PROCESS_RECORDING_JOB,
      { recordingId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );

    return String(job.id);
  }
}
```

- [ ] **Step 3: Add processor shell**

Create `src/jobs/transcription.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PROCESS_RECORDING_JOB, TRANSCRIPTION_QUEUE } from './jobs.constants';
import { ProcessRecordingJobData } from './transcription.queue';

@Injectable()
@Processor(TRANSCRIPTION_QUEUE, { concurrency: 1 })
export class TranscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptionProcessor.name);

  async process(job: Job<ProcessRecordingJobData>): Promise<void> {
    if (job.name !== PROCESS_RECORDING_JOB) {
      this.logger.warn(`Ignoring unknown job ${job.name}`);
      return;
    }

    this.logger.log(`Processing recording ${job.data.recordingId}`);
  }
}
```

- [ ] **Step 4: Register BullMQ**

Create `src/jobs/jobs.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { TRANSCRIPTION_QUEUE } from './jobs.constants';
import { TranscriptionProcessor } from './transcription.processor';
import { TranscriptionQueue } from './transcription.queue';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: {
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          db: config.redis.db,
          maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
          connectTimeout: config.redis.connectTimeout,
          lazyConnect: config.redis.lazyConnect,
        },
        prefix: config.redis.keyPrefix,
      }),
    }),
    BullModule.registerQueue({ name: TRANSCRIPTION_QUEUE }),
  ],
  providers: [TranscriptionQueue, TranscriptionProcessor],
  exports: [TranscriptionQueue],
})
export class JobsModule {}
```

- [ ] **Step 5: Add worker entrypoint**

Create `src/worker.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('Worker');
  logger.log('Voxion worker started');

  const shutdown = async () => {
    logger.log('Shutting down worker');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void bootstrap();
```

- [ ] **Step 6: Enqueue after upload**

Modify `src/recordings/recordings.service.ts` constructor and `create` response:

```ts
import { TranscriptionQueue } from '../jobs/transcription.queue';
```

```ts
constructor(
  private readonly config: AppConfigService,
  private readonly prisma: PrismaService,
  private readonly storage: StorageService,
  private readonly transcriptionQueue: TranscriptionQueue,
) {}
```

```ts
const jobId = await this.transcriptionQueue.enqueue(updated.id);

await this.prisma.jobRun.create({
  data: {
    recordingId: updated.id,
    queueName: 'transcription',
    bullJobId: jobId,
    status: 'QUEUED',
  },
});

return {
  recordingId: updated.id,
  jobId,
  status: updated.status,
};
```

Modify `src/app.module.ts` to import `JobsModule`, and modify `RecordingsModule` to import `JobsModule`.

- [ ] **Step 7: Build**

Run:

```bash
npm run build
```

Expected: build passes.

## Task 7: Notion Block Splitting

**Files:**
- Create: `src/notion/notion-blocks.ts`
- Create: `src/notion/notion-blocks.spec.ts`

- [ ] **Step 1: Write tests**

Create `src/notion/notion-blocks.spec.ts`:

```ts
import { splitTranscriptIntoParagraphBlocks } from './notion-blocks';

describe('splitTranscriptIntoParagraphBlocks', () => {
  it('keeps paragraph text under 2000 characters', () => {
    const transcript = '가'.repeat(4500);
    const blocks = splitTranscriptIntoParagraphBlocks(transcript);

    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      const content = block.paragraph.rich_text[0].text.content;
      expect(content.length).toBeLessThanOrEqual(1900);
    }
  });

  it('preserves short paragraphs', () => {
    const blocks = splitTranscriptIntoParagraphBlocks('첫 문장입니다.\\n\\n둘째 문장입니다.');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].paragraph.rich_text[0].text.content).toBe('첫 문장입니다.');
    expect(blocks[1].paragraph.rich_text[0].text.content).toBe('둘째 문장입니다.');
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- src/notion/notion-blocks.spec.ts
```

Expected: FAIL because `notion-blocks.ts` does not exist.

- [ ] **Step 3: Implement block splitter**

Create `src/notion/notion-blocks.ts`:

```ts
type ParagraphBlock = {
  object: 'block';
  type: 'paragraph';
  paragraph: {
    rich_text: Array<{
      type: 'text';
      text: { content: string };
    }>;
  };
};

export function splitTranscriptIntoParagraphBlocks(
  transcript: string,
): ParagraphBlock[] {
  const maxChars = 1900;
  const paragraphs = transcript
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean);

  const chunks = paragraphs.flatMap((paragraph) =>
    splitTextByLength(paragraph, maxChars),
  );

  return chunks.map((content) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content } }],
    },
  }));
}

export function batchBlocks<T>(blocks: T[], batchSize = 100): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < blocks.length; index += batchSize) {
    batches.push(blocks.slice(index, index + batchSize));
  }
  return batches;
}

function splitTextByLength(value: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += maxChars) {
    chunks.push(value.slice(index, index + maxChars));
  }
  return chunks;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/notion/notion-blocks.spec.ts
```

Expected: PASS.

## Task 8: Transcript Merge

**Files:**
- Create: `src/transcription/transcript-merge.service.ts`
- Create: `src/transcription/transcript-merge.service.spec.ts`
- Create: `src/transcription/transcription.module.ts`

- [ ] **Step 1: Write merge tests**

Create `src/transcription/transcript-merge.service.spec.ts`:

```ts
import { TranscriptMergeService } from './transcript-merge.service';

describe('TranscriptMergeService', () => {
  const service = new TranscriptMergeService();

  it('orders chunks by index and separates paragraphs', () => {
    const result = service.merge([
      { index: 2, text: '세 번째 문장입니다.' },
      { index: 0, text: '첫 번째 문장입니다.' },
      { index: 1, text: '두 번째 문장입니다.' },
    ]);

    expect(result.text).toBe(
      '첫 번째 문장입니다.\\n\\n두 번째 문장입니다.\\n\\n세 번째 문장입니다.',
    );
  });
});
```

- [ ] **Step 2: Implement merge service**

Create `src/transcription/transcript-merge.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

export type ChunkTranscript = {
  index: number;
  text: string;
};

export type MergedTranscript = {
  text: string;
  chunks: ChunkTranscript[];
};

@Injectable()
export class TranscriptMergeService {
  merge(chunks: ChunkTranscript[]): MergedTranscript {
    const ordered = [...chunks].sort((a, b) => a.index - b.index);
    return {
      text: ordered
        .map((chunk) => this.normalizeSentences(chunk.text))
        .filter(Boolean)
        .join('\n\n'),
      chunks: ordered,
    };
  }

  private normalizeSentences(text: string): string {
    return text
      .replace(/([.!?。！？]|다\.)\s+/g, '$1\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }
}
```

Create `src/transcription/transcription.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TranscriptMergeService } from './transcript-merge.service';

@Module({
  providers: [TranscriptMergeService],
  exports: [TranscriptMergeService],
})
export class TranscriptionModule {}
```

- [ ] **Step 3: Run merge tests**

Run:

```bash
npm test -- src/transcription/transcript-merge.service.spec.ts
```

Expected: PASS.

## Task 9: Audio Probe and Chunking Service

**Files:**
- Create: `src/audio/ffmpeg-runner.ts`
- Create: `src/audio/audio.service.ts`
- Create: `src/audio/audio.service.spec.ts`
- Create: `src/audio/audio.module.ts`

- [ ] **Step 1: Write chunk planning test**

Create `src/audio/audio.service.spec.ts`:

```ts
import { AudioService } from './audio.service';

describe('AudioService', () => {
  it('plans duration-based chunks below the max seconds window', () => {
    const service = new AudioService({} as never, {} as never);
    const chunks = service.planDurationChunks({
      durationSeconds: 3600,
      maxChunkSeconds: 900,
    });

    expect(chunks).toEqual([
      { index: 0, startSeconds: 0, endSeconds: 900 },
      { index: 1, startSeconds: 900, endSeconds: 1800 },
      { index: 2, startSeconds: 1800, endSeconds: 2700 },
      { index: 3, startSeconds: 2700, endSeconds: 3600 },
    ]);
  });
});
```

- [ ] **Step 2: Implement ffmpeg runner**

Create `src/audio/ffmpeg-runner.ts`:

```ts
import { spawn } from 'node:child_process';

export async function runCommand(
  command: string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout || stderr);
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr}`));
    });
  });
}
```

- [ ] **Step 3: Implement audio service**

Create `src/audio/audio.service.ts`:

```ts
import { stat } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { StorageService } from '../storage/storage.service';
import { runCommand } from './ffmpeg-runner';

export type PlannedChunk = {
  index: number;
  startSeconds: number;
  endSeconds: number;
};

@Injectable()
export class AudioService {
  constructor(
    private readonly config: AppConfigService,
    private readonly storage: StorageService,
  ) {}

  async probeDurationSeconds(path: string): Promise<number> {
    const output = await runCommand('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ]);

    return Number(output.trim());
  }

  async normalizeToMp3(inputPath: string, outputPath: string): Promise<void> {
    await this.storage.ensureParent(outputPath);
    await runCommand('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-b:a',
      '64k',
      outputPath,
    ]);
  }

  planDurationChunks(input: {
    durationSeconds: number;
    maxChunkSeconds: number;
  }): PlannedChunk[] {
    const chunks: PlannedChunk[] = [];
    let startSeconds = 0;
    let index = 0;

    while (startSeconds < input.durationSeconds) {
      const endSeconds = Math.min(
        startSeconds + input.maxChunkSeconds,
        input.durationSeconds,
      );
      chunks.push({ index, startSeconds, endSeconds });
      startSeconds = endSeconds;
      index += 1;
    }

    return chunks;
  }

  async createDurationChunks(input: {
    recordingId: string;
    normalizedPath: string;
    durationSeconds: number;
  }) {
    const maxChunkSeconds = 45 * 60;
    const planned = this.planDurationChunks({
      durationSeconds: input.durationSeconds,
      maxChunkSeconds,
    });

    const created = [];
    for (const chunk of planned) {
      const outputPath = this.storage.chunkPath(input.recordingId, chunk.index);
      await this.storage.ensureParent(outputPath);
      await runCommand('ffmpeg', [
        '-y',
        '-i',
        input.normalizedPath,
        '-ss',
        String(chunk.startSeconds),
        '-to',
        String(chunk.endSeconds),
        '-c',
        'copy',
        outputPath,
      ]);
      const file = await stat(outputPath);
      if (file.size > this.config.chunkTargetBytes) {
        throw new Error(`Chunk ${chunk.index} exceeds target byte size.`);
      }
      created.push({ ...chunk, path: outputPath, bytes: file.size });
    }

    return created;
  }
}
```

Create `src/audio/audio.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AudioService } from './audio.service';

@Module({
  imports: [StorageModule],
  providers: [AudioService],
  exports: [AudioService],
})
export class AudioModule {}
```

- [ ] **Step 4: Run audio tests**

Run:

```bash
npm test -- src/audio/audio.service.spec.ts
```

Expected: PASS.

## Task 10: OpenAI and Notion Services

**Files:**
- Create: `src/transcription/openai-transcription.service.ts`
- Modify: `src/transcription/transcription.module.ts`
- Create: `src/notion/notion.service.ts`
- Create: `src/notion/notion.module.ts`

- [ ] **Step 1: Implement OpenAI transcription service**

Create `src/transcription/openai-transcription.service.ts`:

```ts
import { createReadStream } from 'node:fs';
import { Injectable, PreconditionFailedException } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class OpenaiTranscriptionService {
  constructor(private readonly config: AppConfigService) {}

  async transcribe(input: {
    path: string;
    language: string;
  }): Promise<{ text: string; raw: unknown }> {
    const apiKey = this.config.openaiApiKey;
    if (!apiKey) {
      throw new PreconditionFailedException('OPENAI_API_KEY is not configured.');
    }

    const client = new OpenAI({ apiKey });
    const result = await client.audio.transcriptions.create({
      file: createReadStream(input.path),
      model: this.config.openaiTranscriptionModel,
      language: input.language,
      response_format: 'json',
    });

    return {
      text: result.text,
      raw: result,
    };
  }
}
```

- [ ] **Step 2: Register OpenAI service**

Modify `src/transcription/transcription.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OpenaiTranscriptionService } from './openai-transcription.service';
import { TranscriptMergeService } from './transcript-merge.service';

@Module({
  providers: [OpenaiTranscriptionService, TranscriptMergeService],
  exports: [OpenaiTranscriptionService, TranscriptMergeService],
})
export class TranscriptionModule {}
```

- [ ] **Step 3: Implement Notion service**

Create `src/notion/notion.service.ts`:

```ts
import { Injectable, PreconditionFailedException } from '@nestjs/common';
import { Client } from '@notionhq/client';
import { AppConfigService } from '../config/app-config.service';
import { batchBlocks, splitTranscriptIntoParagraphBlocks } from './notion-blocks';

@Injectable()
export class NotionService {
  constructor(private readonly config: AppConfigService) {}

  async createRecordingPage(input: {
    title: string;
    status: string;
    language: string;
    model: string;
    durationSeconds?: number;
    originalFilename: string;
    fileSizeMb: number;
    chunkCount: number;
    transcript: string;
    recordedAt?: Date;
  }): Promise<{ pageId: string; url: string }> {
    const token = this.config.notionToken;
    const dataSourceId = this.config.notionDataSourceId;
    if (!token || !dataSourceId) {
      throw new PreconditionFailedException('Notion environment is not configured.');
    }

    const notion = new Client({
      auth: token,
      notionVersion: this.config.notionVersion,
    });

    const page = await notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: {
        Name: {
          type: 'title',
          title: [{ type: 'text', text: { content: input.title } }],
        },
        Status: {
          type: 'select',
          select: { name: input.status },
        },
        Language: {
          type: 'rich_text',
          rich_text: [{ type: 'text', text: { content: input.language } }],
        },
        Model: {
          type: 'rich_text',
          rich_text: [{ type: 'text', text: { content: input.model } }],
        },
        'Duration Seconds': {
          type: 'number',
          number: input.durationSeconds ?? null,
        },
        'Original Filename': {
          type: 'rich_text',
          rich_text: [
            { type: 'text', text: { content: input.originalFilename } },
          ],
        },
        'File Size MB': {
          type: 'number',
          number: input.fileSizeMb,
        },
        'Chunk Count': {
          type: 'number',
          number: input.chunkCount,
        },
        'Recorded At': {
          type: 'date',
          date: { start: (input.recordedAt ?? new Date()).toISOString() },
        },
        'Uploaded At': {
          type: 'date',
          date: { start: new Date().toISOString() },
        },
      },
    });

    const blocks = splitTranscriptIntoParagraphBlocks(input.transcript);
    for (const batch of batchBlocks(blocks, 100)) {
      await notion.blocks.children.append({
        block_id: page.id,
        children: batch,
      });
    }

    return {
      pageId: page.id,
      url: 'url' in page && typeof page.url === 'string' ? page.url : '',
    };
  }
}
```

Create `src/notion/notion.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { NotionService } from './notion.service';

@Module({
  providers: [NotionService],
  exports: [NotionService],
})
export class NotionModule {}
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: build passes.

## Task 11: Wire Worker Processing

**Files:**
- Modify: `src/jobs/transcription.processor.ts`
- Modify: `src/jobs/jobs.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Register processing dependencies**

Modify `src/jobs/jobs.module.ts` imports:

```ts
import { AudioModule } from '../audio/audio.module';
import { NotionModule } from '../notion/notion.module';
import { StorageModule } from '../storage/storage.module';
import { TranscriptionModule } from '../transcription/transcription.module';
```

Ensure `JobsModule` imports include:

```ts
AudioModule,
StorageModule,
TranscriptionModule,
NotionModule,
```

- [ ] **Step 2: Implement processor workflow**

Replace `src/jobs/transcription.processor.ts` with:

```ts
import { writeFile } from 'node:fs/promises';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ChunkStatus, RecordingStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { AudioService } from '../audio/audio.service';
import { NotionService } from '../notion/notion.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OpenaiTranscriptionService } from '../transcription/openai-transcription.service';
import { TranscriptMergeService } from '../transcription/transcript-merge.service';
import { PROCESS_RECORDING_JOB, TRANSCRIPTION_QUEUE } from './jobs.constants';
import { ProcessRecordingJobData } from './transcription.queue';

@Injectable()
@Processor(TRANSCRIPTION_QUEUE, { concurrency: 1 })
export class TranscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audio: AudioService,
    private readonly storage: StorageService,
    private readonly openai: OpenaiTranscriptionService,
    private readonly merge: TranscriptMergeService,
    private readonly notion: NotionService,
  ) {
    super();
  }

  async process(job: Job<ProcessRecordingJobData>): Promise<void> {
    if (job.name !== PROCESS_RECORDING_JOB) {
      this.logger.warn(`Ignoring unknown job ${job.name}`);
      return;
    }

    const recording = await this.prisma.recording.findUniqueOrThrow({
      where: { id: job.data.recordingId },
    });

    try {
      await this.prisma.recording.update({
        where: { id: recording.id },
        data: { status: RecordingStatus.PROBING },
      });

      const durationSeconds = await this.audio.probeDurationSeconds(
        recording.originalPath,
      );
      const normalizedPath = this.storage.normalizedPath(recording.id);

      await this.prisma.recording.update({
        where: { id: recording.id },
        data: {
          status: RecordingStatus.CHUNKING,
          durationSeconds,
          normalizedPath,
        },
      });

      await this.audio.normalizeToMp3(recording.originalPath, normalizedPath);
      const chunks = await this.audio.createDurationChunks({
        recordingId: recording.id,
        normalizedPath,
        durationSeconds,
      });

      await this.prisma.recordingChunk.createMany({
        data: chunks.map((chunk) => ({
          recordingId: recording.id,
          index: chunk.index,
          status: ChunkStatus.PENDING,
          path: chunk.path,
          bytes: BigInt(chunk.bytes),
          startSeconds: chunk.startSeconds,
          endSeconds: chunk.endSeconds,
        })),
      });

      await this.prisma.recording.update({
        where: { id: recording.id },
        data: {
          status: RecordingStatus.TRANSCRIBING,
          chunkCount: chunks.length,
        },
      });

      const transcriptChunks = [];
      for (const chunk of chunks) {
        await this.prisma.recordingChunk.update({
          where: {
            recordingId_index: {
              recordingId: recording.id,
              index: chunk.index,
            },
          },
          data: { status: ChunkStatus.TRANSCRIBING },
        });

        const result = await this.openai.transcribe({
          path: chunk.path,
          language: recording.language,
        });
        const transcriptPath = this.storage.chunkTranscriptPath(
          recording.id,
          chunk.index,
        );
        await this.storage.ensureParent(transcriptPath);
        await writeFile(transcriptPath, JSON.stringify(result.raw, null, 2));

        await this.prisma.recordingChunk.update({
          where: {
            recordingId_index: {
              recordingId: recording.id,
              index: chunk.index,
            },
          },
          data: {
            status: ChunkStatus.COMPLETED,
            transcriptPath,
            text: result.text,
          },
        });

        transcriptChunks.push({ index: chunk.index, text: result.text });
      }

      await this.prisma.recording.update({
        where: { id: recording.id },
        data: { status: RecordingStatus.MERGING },
      });

      const merged = this.merge.merge(transcriptChunks);
      const finalTranscriptPath = this.storage.finalTranscriptPath(recording.id);
      await this.storage.ensureParent(finalTranscriptPath);
      await writeFile(finalTranscriptPath, JSON.stringify(merged, null, 2));

      await this.prisma.recording.update({
        where: { id: recording.id },
        data: {
          status: RecordingStatus.UPLOADING_TO_NOTION,
          transcriptPath: finalTranscriptPath,
          transcriptText: merged.text,
        },
      });

      const page = await this.notion.createRecordingPage({
        title: recording.title || recording.originalFilename,
        status: 'Completed',
        language: recording.language,
        model: recording.model,
        durationSeconds,
        originalFilename: recording.originalFilename,
        fileSizeMb: Number(recording.originalBytes) / 1024 / 1024,
        chunkCount: chunks.length,
        transcript: merged.text,
        recordedAt: recording.recordedAt ?? undefined,
      });

      await this.prisma.recording.update({
        where: { id: recording.id },
        data: {
          status: RecordingStatus.COMPLETED,
          notionPageId: page.pageId,
          notionUrl: page.url,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.recording.update({
        where: { id: recording.id },
        data: {
          status: RecordingStatus.FAILED,
          errorCode: 'PROCESSING_FAILED',
          errorMessage: message,
        },
      });
      throw error;
    }
  }
}
```

- [ ] **Step 3: Register modules in app module**

Modify `src/app.module.ts` imports:

```ts
import { AudioModule } from './audio/audio.module';
import { JobsModule } from './jobs/jobs.module';
import { NotionModule } from './notion/notion.module';
import { TranscriptionModule } from './transcription/transcription.module';
```

Ensure `AppModule` includes:

```ts
AudioModule,
JobsModule,
NotionModule,
TranscriptionModule,
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: build passes.

## Task 12: Transcript Endpoint and README

**Files:**
- Modify: `src/recordings/recordings.controller.ts`
- Modify: `src/recordings/recordings.service.ts`
- Create: `README.md`

- [ ] **Step 1: Add transcript read method**

Modify `src/recordings/recordings.service.ts`:

```ts
import { ConflictException } from '@nestjs/common';
```

Add:

```ts
async transcript(id: string) {
  const recording = await this.prisma.recording.findUniqueOrThrow({
    where: { id },
  });

  if (recording.status !== 'COMPLETED') {
    throw new ConflictException({
      status: recording.status,
      message: 'Transcript is not ready.',
    });
  }

  return {
    id: recording.id,
    text: recording.transcriptText,
    notionPageId: recording.notionPageId,
    notionUrl: recording.notionUrl,
  };
}
```

- [ ] **Step 2: Add controller route**

Modify `src/recordings/recordings.controller.ts`:

```ts
@Get(':id/transcript')
async transcript(@Param('id') id: string) {
  return this.recordings.transcript(id);
}
```

- [ ] **Step 3: Add README**

Create `README.md`:

```md
# Voxion

API-only recording transcription service.

## Requirements

- Node.js
- npm
- ffmpeg and ffprobe
- Existing local PostgreSQL on `localhost:5432`
- Existing local Redis on `localhost:6379`

## Environment

`.env` is local-only. `.env.example` documents required variables.

Required secrets:

- `OPENAI_API_KEY`
- `NOTION_TOKEN`
- `NOTION_DATA_SOURCE_ID`

## Setup

```bash
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
```

## Run

Terminal 1:

```bash
npm run start:dev
```

Terminal 2:

```bash
npm run start:worker
```

## Upload

```bash
curl -X POST http://localhost:3000/recordings \
  -F "file=@/absolute/path/to/audio.m4a" \
  -F "title=Meeting recording" \
  -F "language=ko"
```

## Status

```bash
curl http://localhost:3000/recordings/<recording-id>
```

## Transcript

```bash
curl http://localhost:3000/recordings/<recording-id>/transcript
```
```

- [ ] **Step 4: Final verification**

Run:

```bash
npm test
npm run build
```

Expected: tests pass and build succeeds.

## Manual Smoke Test

- [ ] Confirm `.env` contains local PostgreSQL and Redis values.
- [ ] Add `OPENAI_API_KEY`, `NOTION_TOKEN`, and `NOTION_DATA_SOURCE_ID` locally.
- [ ] Run `npm run prisma:migrate -- --name init`.
- [ ] Run `npm run start:dev`.
- [ ] Run `npm run start:worker`.
- [ ] Upload a small Korean audio file under 25 MB.
- [ ] Confirm `GET /recordings/:id` reaches `COMPLETED`.
- [ ] Confirm a Notion database row appears.
- [ ] Upload a file over 25 MB.
- [ ] Confirm chunk files in `storage/chunks/<recordingId>/` are below `25165824` bytes.
- [ ] Confirm final transcript appears in Notion body.

## Self-Review

Spec coverage:

- API-only upload and status endpoints are covered in Tasks 5 and 12.
- Existing local PostgreSQL and Redis env decisions are covered by existing `.env`, `.env.example`, and Tasks 2, 3, and 6.
- Prisma schema and migrations are covered in Task 3.
- BullMQ worker processing is covered in Tasks 6 and 11.
- ffmpeg chunking is covered in Task 9.
- OpenAI transcription is covered in Task 10.
- transcript merge and sentence readability are covered in Task 8.
- Notion row creation and block batching are covered in Tasks 7 and 10.
- README runbook and smoke test are covered in Task 12.

Placeholder scan:

- The plan contains no unfinished markers or intentionally incomplete sections.

Type consistency:

- `RecordingStatus`, `ChunkStatus`, and `JobRunStatus` names match `prisma/schema.prisma`.
- `recordingId_index` matches the Prisma compound unique constraint.
- `TranscriptionQueue.enqueue()` returns a string job ID used by `JobRun`.
- `StorageService` path helpers are used by the worker and tests.
