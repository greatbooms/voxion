# Voxion

NestJS service for uploading recordings, transcribing them with OpenAI speech-to-text, and publishing completed transcripts to Notion.

## Requirements

- Node.js 20 or newer
- npm
- `ffmpeg` and `ffprobe` available on `PATH`
- Existing local PostgreSQL instance
- Existing local Redis instance

## Environment

Copy `.env.example` to `.env` for local development:

```sh
cp .env.example .env
```

The local `.env` file is expected to contain database and Redis connection values for your local services. The checked-in `.env.example` includes local defaults for those values, but leaves secrets blank.

Fill these values before running real transcription or Notion upload work:

```sh
OPENAI_API_KEY=
NOTION_TOKEN=
NOTION_DATA_SOURCE_ID=
```

## Setup

```sh
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
```

## Run

Start the API:

```sh
npm run start:dev
```

Start the transcription worker in a separate shell:

```sh
npm run start:worker
```

By default, the API listens on `http://localhost:3000`.

## API Examples

Upload a recording:

```sh
curl -X POST http://localhost:3000/recordings \
  -F "file=@/path/to/meeting.m4a;type=audio/m4a" \
  -F "title=Team sync" \
  -F "language=en" \
  -F "recordedAt=2026-07-03T09:00:00+09:00"
```

Check status and recording details:

```sh
curl http://localhost:3000/recordings/00000000-0000-4000-8000-000000000001
```

Read the completed transcript:

```sh
curl http://localhost:3000/recordings/00000000-0000-4000-8000-000000000001/transcript
```

The transcript endpoint returns `409 Conflict` with the current recording status until the recording reaches `COMPLETED`.

## Recording Processing

Large recordings are normalized and split into chunks under `CHUNK_TARGET_BYTES` before transcription so each OpenAI speech-to-text request stays below the service limit. The default chunk target is defined in `.env.example` and can be overridden in local `.env`.
