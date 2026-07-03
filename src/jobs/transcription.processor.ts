import { writeFile } from 'node:fs/promises';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AudioService, CreatedChunk } from '../audio/audio.service';
import { NotionService } from '../notion/notion.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OpenaiTranscriptionService } from '../transcription/openai-transcription.service';
import { TranscriptMergeService } from '../transcription/transcript-merge.service';
import { PROCESS_RECORDING_JOB, TRANSCRIPTION_QUEUE } from './jobs.constants';
import { ProcessRecordingJobData } from './transcription.queue';

type TranscriptChunk = CreatedChunk & {
  text: string;
};

@Injectable()
@Processor(TRANSCRIPTION_QUEUE, { concurrency: 1 })
export class TranscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audio: AudioService,
    private readonly storage: StorageService,
    private readonly transcription: OpenaiTranscriptionService,
    private readonly mergeService: TranscriptMergeService,
    private readonly notion: NotionService,
  ) {
    super();
  }

  async process(job: Job<ProcessRecordingJobData>): Promise<void> {
    if (job.name !== PROCESS_RECORDING_JOB) {
      throw new Error(`Unknown transcription job: ${job.name}`);
    }

    const recordingId = job.data.recordingId;
    const attemptsMade = this.getAttemptsMade(job);

    this.logger.log(`Processing recording ${recordingId}`);
    await this.updateJobRun(job, { status: 'ACTIVE', attemptsMade, lastError: null });

    const recording = await this.prisma.recording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      const error = new Error(`Recording not found: ${recordingId}`);
      await this.updateJobRun(job, {
        status: 'FAILED',
        attemptsMade,
        lastError: error.message,
      });
      throw error;
    }

    try {
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: 'PROBING' },
      });

      const durationSeconds = await this.audio.probeDurationSeconds(
        recording.originalPath,
      );
      const normalizedPath = this.storage.normalizedPath(recordingId);

      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          status: 'CHUNKING',
          durationSeconds,
          normalizedPath,
        },
      });
      await this.audio.normalizeToMp3(recording.originalPath, normalizedPath);

      const chunks = await this.audio.createChunks({
        recordingId,
        normalizedPath,
        durationSeconds,
      });

      const persistedChunks = [];
      for (const chunk of chunks) {
        persistedChunks.push(await this.persistPlannedChunk(recordingId, chunk));
      }
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: 'TRANSCRIBING', chunkCount: chunks.length },
      });

      const transcriptChunks: TranscriptChunk[] = [];

      for (const [chunkIndex, chunk] of chunks.entries()) {
        const persistedChunk = persistedChunks[chunkIndex];
        if (persistedChunk.status === 'COMPLETED' && persistedChunk.text) {
          transcriptChunks.push(
            this.toTranscriptChunk({
              ...persistedChunk,
              text: persistedChunk.text,
            }),
          );
          continue;
        }

        try {
          await this.prisma.recordingChunk.update({
            where: {
              recordingId_index: { recordingId, index: chunk.index },
            },
            data: {
              status: 'TRANSCRIBING',
              errorCode: null,
              errorMessage: null,
            },
          });

          const result = await this.transcription.transcribe({
            path: chunk.path,
            language: recording.language,
          });
          const transcriptPath = this.storage.chunkTranscriptPath(
            recordingId,
            chunk.index,
          );

          await this.storage.ensureParent(transcriptPath);
          await writeFile(transcriptPath, JSON.stringify(result.raw, null, 2));
          await this.prisma.recordingChunk.update({
            where: {
              recordingId_index: { recordingId, index: chunk.index },
            },
            data: {
              status: 'COMPLETED',
              transcriptPath,
              text: result.text,
            },
          });
          transcriptChunks.push({ ...chunk, text: result.text });
        } catch (error) {
          await this.prisma.recordingChunk.update({
            where: {
              recordingId_index: { recordingId, index: chunk.index },
            },
            data: {
              status: 'FAILED',
              errorCode: 'TRANSCRIPTION_FAILED',
              errorMessage: this.getErrorMessage(error),
            },
          });
          throw error;
        }
      }

      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: 'MERGING' },
      });
      const merged = this.mergeService.merge(transcriptChunks, {
        language: recording.language,
      });
      const finalTranscriptPath = this.storage.finalTranscriptPath(recordingId);

      await this.storage.ensureParent(finalTranscriptPath);
      await writeFile(finalTranscriptPath, JSON.stringify(merged, null, 2));
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          status: 'UPLOADING_TO_NOTION',
          transcriptPath: finalTranscriptPath,
          transcriptText: merged.text,
        },
      });

      // A previous attempt may have created the page but crashed before the
      // id reached the database; look the page up before creating another.
      let notionPage = recording.notionPageId
        ? { pageId: recording.notionPageId, url: recording.notionUrl ?? '' }
        : await this.notion.findRecordingPage(recordingId);

      if (!notionPage) {
        notionPage = await this.notion.createRecordingPageMetadata({
          title: recording.title || recording.originalFilename,
          status: 'Completed',
          language: recording.language,
          model: recording.model,
          durationSeconds,
          originalFilename: recording.originalFilename,
          fileSizeMb: Number(recording.originalBytes) / 1024 / 1024,
          chunkCount: chunks.length,
          recordedAt: recording.recordedAt ?? undefined,
          recordingId,
        });
      }

      if (!recording.notionPageId) {
        await this.prisma.recording.update({
          where: { id: recordingId },
          data: {
            notionPageId: notionPage.pageId,
            notionUrl: notionPage.url,
          },
        });
      }

      await this.notion.appendTranscriptToPage({
        pageId: notionPage.pageId,
        transcript: merged.text,
        chunks: merged.chunks.map((chunk) => ({
          index: chunk.index,
          startSeconds: Number(chunk.startSeconds),
          endSeconds: Number(chunk.endSeconds),
        })),
      });

      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
      await this.updateJobRun(job, {
        status: 'COMPLETED',
        attemptsMade,
        lastError: null,
      });
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      // While BullMQ retries remain, the recording is queued again rather
      // than terminally failed; only the final attempt marks FAILED.
      const willRetry = this.willRetry(job);

      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          status: willRetry ? 'QUEUED' : 'FAILED',
          errorCode: 'PROCESSING_FAILED',
          errorMessage,
        },
      });
      await this.updateJobRun(job, {
        status: willRetry ? 'QUEUED' : 'FAILED',
        attemptsMade,
        lastError: errorMessage,
      });

      throw error;
    }
  }

  private willRetry(job: Job<ProcessRecordingJobData>): boolean {
    const attempts = job.opts?.attempts ?? 1;
    const attemptsMade =
      typeof job.attemptsMade === 'number' ? job.attemptsMade : 0;

    return attemptsMade + 1 < attempts;
  }

  private async updateJobRun(
    job: Job<ProcessRecordingJobData>,
    data: Record<string, unknown>,
  ): Promise<void> {
    const jobId = job.id == null ? undefined : String(job.id);
    const orConditions = jobId
      ? [
          { queueName: TRANSCRIPTION_QUEUE, bullJobId: jobId },
          { id: jobId },
        ]
      : [{ recordingId: job.data.recordingId, queueName: TRANSCRIPTION_QUEUE }];

    const result = await this.prisma.jobRun.updateMany({
      where: { OR: orConditions },
      data,
    });
    const count = result.count;
    if (count !== 1) {
      this.logger.warn(
        `Job run update affected ${count} rows for recording ${job.data.recordingId}`,
      );
    }
  }

  private getAttemptsMade(job: Job<ProcessRecordingJobData>): number | undefined {
    return typeof job.attemptsMade === 'number' ? job.attemptsMade : undefined;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async persistPlannedChunk(recordingId: string, chunk: CreatedChunk) {
    const where = {
      recordingId_index: { recordingId, index: chunk.index },
    };
    const metadata = {
      path: chunk.path,
      bytes: BigInt(chunk.bytes),
      startSeconds: chunk.startSeconds,
      endSeconds: chunk.endSeconds,
      overlapSeconds: chunk.overlapSeconds,
    };
    const existing = await this.prisma.recordingChunk.findUnique({ where });

    if (!existing) {
      return this.prisma.recordingChunk.create({
        data: {
          recordingId,
          index: chunk.index,
          status: 'PENDING',
          ...metadata,
        },
      });
    }

    if (this.chunkMetadataMatches(existing, chunk)) {
      return existing;
    }

    return this.prisma.recordingChunk.update({
      where,
      data: {
        status: 'PENDING',
        ...metadata,
        transcriptPath: null,
        text: null,
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  private chunkMetadataMatches(
    persisted: {
      path: string;
      bytes: bigint | number;
      startSeconds: unknown;
      endSeconds: unknown;
      overlapSeconds?: unknown;
    },
    planned: CreatedChunk,
  ): boolean {
    return (
      persisted.path === planned.path &&
      this.normalizeComparable(persisted.bytes) ===
        this.normalizeComparable(BigInt(planned.bytes)) &&
      this.normalizeComparable(persisted.startSeconds) ===
        this.normalizeComparable(planned.startSeconds) &&
      this.normalizeComparable(persisted.endSeconds) ===
        this.normalizeComparable(planned.endSeconds) &&
      this.normalizeNumericComparable(persisted.overlapSeconds) ===
        this.normalizeNumericComparable(planned.overlapSeconds)
    );
  }

  private normalizeComparable(value: unknown): string {
    return String(value);
  }

  private normalizeNumericComparable(value: unknown): string {
    return String(Number(value ?? 0));
  }

  private toTranscriptChunk(chunk: {
    index: number;
    path: string;
    bytes: bigint | number;
    startSeconds: unknown;
    endSeconds: unknown;
    overlapSeconds?: unknown;
    text: string;
  }): TranscriptChunk {
    return {
      index: chunk.index,
      path: chunk.path,
      bytes: Number(chunk.bytes),
      startSeconds: Number(chunk.startSeconds),
      endSeconds: Number(chunk.endSeconds),
      overlapSeconds: Number(chunk.overlapSeconds ?? 0),
      text: chunk.text,
    };
  }
}
