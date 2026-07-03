/*
  Warnings:

  - The primary key for the `JobRun` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Recording` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `RecordingChunk` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `id` on the `JobRun` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `recordingId` on the `JobRun` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `Recording` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `RecordingChunk` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `recordingId` on the `RecordingChunk` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "JobRun" DROP CONSTRAINT "JobRun_recordingId_fkey";

-- DropForeignKey
ALTER TABLE "RecordingChunk" DROP CONSTRAINT "RecordingChunk_recordingId_fkey";

-- AlterTable
ALTER TABLE "JobRun" DROP CONSTRAINT "JobRun_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "recordingId",
ADD COLUMN     "recordingId" UUID NOT NULL,
ADD CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Recording" DROP CONSTRAINT "Recording_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "Recording_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "RecordingChunk" DROP CONSTRAINT "RecordingChunk_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "recordingId",
ADD COLUMN     "recordingId" UUID NOT NULL,
ADD CONSTRAINT "RecordingChunk_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "JobRun_recordingId_idx" ON "JobRun"("recordingId");

-- CreateIndex
CREATE INDEX "RecordingChunk_recordingId_idx" ON "RecordingChunk"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingChunk_recordingId_index_key" ON "RecordingChunk"("recordingId", "index");

-- AddForeignKey
ALTER TABLE "RecordingChunk" ADD CONSTRAINT "RecordingChunk_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
