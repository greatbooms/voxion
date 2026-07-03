-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROBING', 'CHUNKING', 'TRANSCRIBING', 'MERGING', 'UPLOADING_TO_NOTION', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChunkStatus" AS ENUM ('PENDING', 'TRANSCRIBING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'UPLOADED',
    "title" TEXT,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "originalBytes" BIGINT NOT NULL,
    "normalizedPath" TEXT,
    "durationSeconds" DECIMAL(12,3),
    "language" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "transcriptPath" TEXT,
    "transcriptText" TEXT,
    "notionPageId" TEXT,
    "notionUrl" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "recordedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingChunk" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "status" "ChunkStatus" NOT NULL DEFAULT 'PENDING',
    "path" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "startSeconds" DECIMAL(12,3) NOT NULL,
    "endSeconds" DECIMAL(12,3) NOT NULL,
    "transcriptPath" TEXT,
    "text" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordingChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "bullJobId" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'QUEUED',
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordingChunk_recordingId_idx" ON "RecordingChunk"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingChunk_recordingId_index_key" ON "RecordingChunk"("recordingId", "index");

-- CreateIndex
CREATE INDEX "JobRun_recordingId_idx" ON "JobRun"("recordingId");

-- CreateIndex
CREATE INDEX "JobRun_queueName_bullJobId_idx" ON "JobRun"("queueName", "bullJobId");

-- AddForeignKey
ALTER TABLE "RecordingChunk" ADD CONSTRAINT "RecordingChunk_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
