# Voxion Recording Transcription Design

Date: 2026-07-03

## Context

Voxion starts as a single-user internal tool. It receives recorded audio files, transcribes them with OpenAI speech-to-text, and creates a row in a Notion database for each recording.

The implementation will use TypeScript, NestJS, PostgreSQL, Prisma, BullMQ, Redis, local filesystem storage, and ffmpeg. The first product surface is API-only.

OpenAI audio transcription uploads are limited to 25 MB per file. Supported input formats include `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, and `webm`. The design must therefore support recordings larger than the OpenAI upload limit by splitting them before transcription.

Notion is used through a single internal integration token. The user will configure one target Notion data source, which corresponds to the Notion database where each transcription job becomes one row.

## Goals

- Accept one uploaded audio file through a NestJS REST API.
- Persist the recording and job state in PostgreSQL through Prisma.
- Process transcription asynchronously through BullMQ and Redis.
- Split large audio files into OpenAI-compatible chunks under a conservative 24 MB target.
- Use OpenAI transcription with `gpt-4o-transcribe` by default.
- Merge chunk transcripts in original order into one final transcript.
- Create one Notion database row per recording.
- Append the transcript to the Notion page body in rate-limit-aware chunks.
- Expose APIs to check job status and retrieve the transcript metadata.
- Keep the first version deployable on one local machine using the existing Docker-managed PostgreSQL and Redis services.

## Non-Goals

- No multi-user authentication or Notion OAuth.
- No browser UI in the first version.
- No cloud object storage in the first version.
- No speaker diarization in the first version.
- No manual transcript editing workflow.
- No automatic summary or action-item extraction in the first version.

## Key Decisions

### Application Shape

Use a NestJS monolith with clear modules instead of separate services. The API process and worker process can share the same codebase and run as separate Node processes:

- `api`: NestJS HTTP server.
- `worker`: NestJS application context that consumes BullMQ jobs.

This keeps deployment simple while preserving operational separation between request handling and long-running transcription work.

### Queue

Use BullMQ with Redis. Large audio files need retryable background work, and transcription can involve several external calls. BullMQ gives durable jobs, retries, backoff, concurrency limits, and job progress without building a polling worker by hand.

### Storage

Use local filesystem storage under a configured `STORAGE_ROOT`.

Recommended layout:

```text
storage/
  originals/{recordingId}/{safeOriginalFilename}
  chunks/{recordingId}/{chunkIndex}.mp3
  transcripts/{recordingId}/chunks/{chunkIndex}.json
  transcripts/{recordingId}/final.json
```

The database stores paths and metadata, not binary audio content. This is enough for a single-user local deployment and can later be replaced by S3-compatible storage behind the same storage service interface.

### Chunking

The system cannot truly split by sentence before transcription because sentence boundaries are text-level information. Instead, chunking uses an audio-first strategy:

1. Normalize uploaded audio to mono MP3 at a controlled bitrate.
2. Detect silence with ffmpeg `silencedetect`.
3. Prefer split points at silence boundaries.
4. Enforce a maximum chunk size target of 24 MB.
5. If a silence-based segment still exceeds the target, split it by duration and re-check output file size.
6. For forced duration splits, add a small overlap window only when needed and mark the overlap in chunk metadata.
7. Store chunk start and end offsets for later transcript ordering.

The 24 MB target is intentionally below OpenAI's 25 MB limit to leave room for encoding and multipart overhead.

### Transcription Model

Use `gpt-4o-transcribe` by default. The model name is configurable through `OPENAI_TRANSCRIPTION_MODEL` so it can be changed without code edits.

Use `language=ko` by default if most recordings are Korean. Keep `language` configurable per request and through `DEFAULT_TRANSCRIPTION_LANGUAGE`. Supplying the language can improve accuracy and latency according to the OpenAI transcription API reference.

### Notion Write Strategy

Create a new page under the configured Notion data source for each completed recording. In the Notion UI this appears as a new database row.

Store searchable metadata as Notion properties and store the full transcript in the page body. The body must be appended in batches because Notion limits arrays of block children to 100 elements per request, rich text content to 2000 characters, and has request size limits.

## Architecture

```text
Client
  |
  | POST /recordings multipart/form-data
  v
NestJS API
  |
  | save original file
  | create Recording row
  | enqueue BullMQ job
  v
Redis / BullMQ
  |
  v
NestJS Worker
  |
  | ffmpeg normalize + chunk
  | OpenAI transcribe chunk N
  | merge transcript
  | create Notion row
  | append page blocks
  v
PostgreSQL + Notion
```

## NestJS Modules

### `ConfigModule`

Loads and validates required environment variables:

- `DATABASE_URL`
- `REDIS_KEY_PREFIX`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_DB`
- `REDIS_TTL`
- `REDIS_MAX_RETRIES`
- `REDIS_CONNECT_TIMEOUT`
- `REDIS_LAZY_CONNECT`
- `OPENAI_API_KEY`
- `OPENAI_TRANSCRIPTION_MODEL`
- `DEFAULT_TRANSCRIPTION_LANGUAGE`
- `NOTION_TOKEN`
- `NOTION_DATA_SOURCE_ID`
- `NOTION_VERSION`
- `STORAGE_ROOT`
- `MAX_UPLOAD_BYTES`
- `CHUNK_TARGET_BYTES`

### `RecordingsModule`

Owns the public REST API:

- `POST /recordings`
- `GET /recordings/:id`
- `GET /recordings/:id/transcript`
- `GET /jobs/:id`

It validates file type and size, persists the uploaded file, creates the database row, and enqueues the transcription job.

### `StorageModule`

Owns filesystem paths and file operations:

- Save original uploads.
- Create per-recording directories.
- Save generated chunks.
- Save raw chunk transcription responses.
- Save final transcript JSON.
- Delete temporary files only when explicitly configured.

### `AudioModule`

Wraps ffmpeg and ffprobe:

- Probe duration, codec, bitrate, and channels.
- Normalize audio.
- Detect silence.
- Split audio into chunk files under target size.
- Return ordered `AudioChunk` metadata with start/end offsets.

### `TranscriptionModule`

Owns OpenAI calls and transcript merging:

- Transcribe each chunk.
- Retry transient OpenAI errors through BullMQ job retries.
- Store each chunk response independently.
- Merge final text in chunk order.
- Apply best-effort sentence segmentation after transcription so the Notion body is readable.
- Preserve chunk boundaries in the final JSON for debugging.

### `NotionModule`

Owns all Notion API interactions:

- Create a row/page under the configured data source.
- Build properties from recording metadata.
- Convert final transcript to Notion paragraph blocks.
- Append blocks in batches of at most 100 children.
- Handle `429` and `529` responses with Retry-After-aware backoff.

### `JobsModule`

Owns BullMQ queues, workers, progress, and state transitions.

Initial queue:

- `transcription`

Initial job name:

- `process-recording`

Recommended worker concurrency for MVP: `1`. This avoids local CPU and API-rate surprises while the system is first being validated.

## API Design

### `POST /recordings`

Consumes `multipart/form-data`.

Fields:

- `file`: required audio file.
- `title`: optional title for Notion row and internal metadata.
- `language`: optional ISO-639-1 language code. Defaults to `DEFAULT_TRANSCRIPTION_LANGUAGE`.
- `recordedAt`: optional ISO-8601 datetime. Defaults to upload time if omitted.

Response:

```json
{
  "recordingId": "uuid",
  "jobId": "bullmq-job-id",
  "status": "QUEUED"
}
```

### `GET /recordings/:id`

Returns the current recording state and metadata.

Response:

```json
{
  "id": "uuid",
  "status": "TRANSCRIBING",
  "originalFilename": "meeting.m4a",
  "language": "ko",
  "durationSeconds": 3600.5,
  "chunkCount": 8,
  "notionPageId": null,
  "notionUrl": null,
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:01:00.000Z"
}
```

### `GET /recordings/:id/transcript`

Returns the merged transcript after completion.

If the recording is not completed, return `409 Conflict` with the current status.

### `GET /jobs/:id`

Returns queue progress for operational debugging.

## Database Model

### `Recording`

Fields:

- `id`: UUID primary key.
- `status`: enum.
- `title`: nullable string.
- `originalFilename`: string.
- `mimeType`: string.
- `originalPath`: string.
- `originalBytes`: bigint.
- `normalizedPath`: nullable string.
- `durationSeconds`: nullable decimal.
- `language`: string.
- `model`: string.
- `chunkCount`: integer default `0`.
- `transcriptPath`: nullable string.
- `transcriptText`: nullable text.
- `notionPageId`: nullable string.
- `notionUrl`: nullable string.
- `errorCode`: nullable string.
- `errorMessage`: nullable text.
- `createdAt`: timestamp.
- `updatedAt`: timestamp.
- `completedAt`: nullable timestamp.

### `RecordingChunk`

Fields:

- `id`: UUID primary key.
- `recordingId`: foreign key.
- `index`: integer.
- `status`: enum.
- `path`: string.
- `bytes`: bigint.
- `startSeconds`: decimal.
- `endSeconds`: decimal.
- `transcriptPath`: nullable string.
- `text`: nullable text.
- `errorCode`: nullable string.
- `errorMessage`: nullable text.
- `createdAt`: timestamp.
- `updatedAt`: timestamp.

Unique constraint:

- `(recordingId, index)`

### `JobRun`

Fields:

- `id`: UUID primary key.
- `recordingId`: foreign key.
- `queueName`: string.
- `bullJobId`: string.
- `status`: enum.
- `attemptsMade`: integer.
- `lastError`: nullable text.
- `createdAt`: timestamp.
- `updatedAt`: timestamp.

### Status Enums

`RecordingStatus`:

- `UPLOADED`
- `QUEUED`
- `PROBING`
- `CHUNKING`
- `TRANSCRIBING`
- `MERGING`
- `UPLOADING_TO_NOTION`
- `COMPLETED`
- `FAILED`

`ChunkStatus`:

- `PENDING`
- `TRANSCRIBING`
- `COMPLETED`
- `FAILED`

`JobRunStatus`:

- `QUEUED`
- `ACTIVE`
- `COMPLETED`
- `FAILED`

## Notion Data Source Schema

Recommended Notion properties:

- `Name`: title.
- `Status`: select.
- `Recorded At`: date.
- `Uploaded At`: date.
- `Language`: rich text or select.
- `Model`: rich text.
- `Duration Seconds`: number.
- `Original Filename`: rich text.
- `File Size MB`: number.
- `Chunk Count`: number.
- `Error`: rich text.

Page body structure:

```text
# Transcript

Full transcript paragraphs...

# Chunks

Chunk 1: 00:00:00 - 00:10:14
...
```

If the final transcript is long, the Notion module splits it into paragraph blocks whose rich text content is below 2000 characters and appends those blocks in batches of at most 100.

Transcript paragraphs are generated from best-effort sentence segmentation after STT. This happens after transcription, not before chunking, because sentence boundaries are unavailable before the audio has been transcribed.

## Background Job Flow

1. `POST /recordings` saves upload and inserts `Recording(status=UPLOADED)`.
2. API enqueues `process-recording`, sets `Recording(status=QUEUED)`, and returns the queued recording ID and BullMQ job ID.
3. Worker sets `PROBING` and extracts file metadata.
4. Worker sets `CHUNKING`, normalizes the audio, and creates chunk files.
5. Worker inserts `RecordingChunk` rows.
6. Worker sets `TRANSCRIBING` and transcribes chunks in order.
7. Worker saves each chunk response before moving to the next chunk.
8. Worker sets `MERGING` and creates the final transcript.
9. Worker sets `UPLOADING_TO_NOTION` and creates the Notion row/page.
10. Worker appends transcript blocks to the Notion page.
11. Worker sets `COMPLETED` and stores Notion IDs and URL.

On failure, the worker records `errorCode`, `errorMessage`, and leaves already completed chunk responses on disk for later inspection or resume support.

## Error Handling

- Invalid file type: return `400 Bad Request`.
- Upload over local API limit: return `413 Payload Too Large`.
- ffmpeg probe or chunking failure: mark recording `FAILED`.
- OpenAI transient failure: retry through BullMQ with exponential backoff.
- OpenAI permanent failure for one chunk: mark chunk and recording `FAILED`.
- Notion rate limit or overload: wait using Retry-After when present, otherwise back off.
- Notion validation failure: mark recording `FAILED` and preserve transcript locally.

## Retry Policy

Initial BullMQ settings:

- Attempts: `3`
- Backoff: exponential, starting at `30s`
- Remove completed jobs after `100`
- Keep failed jobs for debugging

Within a job, each chunk result is persisted after success. A later enhancement can resume from completed chunks instead of retranscribing all chunks after a job retry.

## Testing Strategy

### Unit Tests

- Config validation.
- Storage path generation.
- Notion block splitting below rich text and block batch limits.
- Transcript merge ordering.
- Status transition helper logic.

### Integration Tests

- `POST /recordings` creates a recording and enqueues a job.
- Prisma repositories persist recording and chunk state.
- Worker state machine handles a mocked successful transcription.
- Worker handles a mocked OpenAI failure and records failure state.
- Notion writer creates properties and block batches with mocked API client.

### Manual Verification

- Upload a small sample file under 25 MB.
- Upload a large sample file over 25 MB.
- Confirm chunk files are below 24 MB.
- Confirm final transcript order matches chunk order.
- Confirm Notion row is created with expected properties.
- Confirm long transcript body appears in Notion without API validation errors.

## Deployment Shape

Use the existing local Docker PostgreSQL and Redis instances for local development instead of creating new database and Redis containers for this project.

Run the application as two local Node processes:

- `api`
- `worker`

The host machine or container image must include `ffmpeg` and `ffprobe`.

## Environment Variables

```text
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/voxion_db?schema=public&connection_limit=5
REDIS_KEY_PREFIX=local:
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis123
REDIS_DB=0
REDIS_TTL=300
REDIS_MAX_RETRIES=3
REDIS_CONNECT_TIMEOUT=10000
REDIS_LAZY_CONNECT=true
OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
DEFAULT_TRANSCRIPTION_LANGUAGE=ko
NOTION_TOKEN=
NOTION_DATA_SOURCE_ID=
NOTION_VERSION=2026-03-11
STORAGE_ROOT=./storage
MAX_UPLOAD_BYTES=2147483648
CHUNK_TARGET_BYTES=25165824
```

`CHUNK_TARGET_BYTES=25165824` is exactly 24 MiB.

## Implementation Order

1. Scaffold NestJS project with TypeScript.
2. Add `.env.example` and local `.env` using the existing PostgreSQL and Redis settings.
3. Add Prisma, PostgreSQL schema, and migrations.
4. Add config validation.
5. Implement file upload and local storage.
6. Add BullMQ queue and worker process.
7. Implement ffmpeg probe, normalization, and chunking.
8. Implement OpenAI transcription client.
9. Implement transcript merge and persistence.
10. Implement Notion row creation and block append.
11. Add tests around chunking boundaries, Notion block splitting, and worker success/failure.
12. Add README runbook.

## Source References

- OpenAI Speech to text guide: https://developers.openai.com/api/docs/guides/speech-to-text
- OpenAI Create transcription API reference: https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
- Notion Create page API reference: https://developers.notion.com/reference/post-page
- Notion Append block children API reference: https://developers.notion.com/reference/patch-block-children
- Notion Request limits: https://developers.notion.com/reference/request-limits
- Notion Authorization guide: https://developers.notion.com/guides/get-started/authorization
