-- DropForeignKey
ALTER TABLE "JobRun" DROP CONSTRAINT "JobRun_recordingId_fkey";

-- DropForeignKey
ALTER TABLE "RecordingChunk" DROP CONSTRAINT "RecordingChunk_recordingId_fkey";

-- AlterTable
ALTER TABLE "Recording" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;

-- AlterTable
ALTER TABLE "RecordingChunk" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "RecordingChunk" ALTER COLUMN "recordingId" TYPE UUID USING "recordingId"::uuid;

-- AlterTable
ALTER TABLE "JobRun" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "JobRun" ALTER COLUMN "recordingId" TYPE UUID USING "recordingId"::uuid;

-- AddForeignKey
ALTER TABLE "RecordingChunk" ADD CONSTRAINT "RecordingChunk_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
