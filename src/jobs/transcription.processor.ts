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

      const chunks = await this.audio.createDurationChunks({
        recordingId,
        normalizedPath,
        durationSeconds,
      });

      const persistedChunks = [];
      for (const chunk of chunks) {
        persistedChunks.push(
          await this.prisma.recordingChunk.upsert({
            where: {
              recordingId_index: { recordingId, index: chunk.index },
            },
            create: {
              recordingId,
              index: chunk.index,
              status: 'PENDING',
              path: chunk.path,
              bytes: BigInt(chunk.bytes),
              startSeconds: chunk.startSeconds,
              endSeconds: chunk.endSeconds,
            },
            update: {
              path: chunk.path,
              bytes: BigInt(chunk.bytes),
              startSeconds: chunk.startSeconds,
              endSeconds: chunk.endSeconds,
            },
          }),
        );
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
      const merged = this.mergeService.merge(transcriptChunks);
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

      const notionPage = await this.notion.createRecordingPage({
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
        where: { id: recordingId },
        data: {
          status: 'COMPLETED',
          notionPageId: notionPage.pageId,
          notionUrl: notionPage.url,
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

      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          status: 'FAILED',
          errorCode: 'PROCESSING_FAILED',
          errorMessage,
        },
      });
      await this.updateJobRun(job, {
        status: 'FAILED',
        attemptsMade,
        lastError: errorMessage,
      });

      throw error;
    }
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

  private toTranscriptChunk(chunk: {
    index: number;
    path: string;
    bytes: bigint | number;
    startSeconds: unknown;
    endSeconds: unknown;
    text: string;
  }): TranscriptChunk {
    return {
      index: chunk.index,
      path: chunk.path,
      bytes: Number(chunk.bytes),
      startSeconds: Number(chunk.startSeconds),
      endSeconds: Number(chunk.endSeconds),
      text: chunk.text,
    };
  }
}
