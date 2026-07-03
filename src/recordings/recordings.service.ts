import * as crypto from 'node:crypto';
import { unlink } from 'node:fs/promises';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  ChunkStatus,
  JobRunStatus,
  Prisma,
  RecordingStatus,
} from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { TRANSCRIPTION_QUEUE } from '../jobs/jobs.constants';
import { TranscriptionQueue } from '../jobs/transcription.queue';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateRecordingDto } from './dto/create-recording.dto';

const SUPPORTED_MEDIA_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/mpga',
  'audio/m4a',
  'audio/wav',
  'audio/webm',
  'video/mp4',
]);

const STORAGE_SAVE_FAILED_CODE = 'STORAGE_SAVE_FAILED';
const FINALIZE_RECORDING_FAILED_CODE = 'FINALIZE_RECORDING_FAILED';
const ENQUEUE_RECORDING_FAILED_CODE = 'ENQUEUE_RECORDING_FAILED';
const CREATE_JOB_RUN_FAILED_CODE = 'CREATE_JOB_RUN_FAILED';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATETIME_WITH_TIMEZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

type RecordingWithChunks = Prisma.RecordingGetPayload<{
  include: { chunks: true };
}>;

type RecordingChunkResponse = {
  id: string;
  recordingId: string;
  index: number;
  status: ChunkStatus;
  path: string;
  bytes: string;
  startSeconds: string;
  endSeconds: string;
  transcriptPath: string | null;
  text: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type RecordingResponse = {
  id: string;
  status: RecordingStatus;
  title: string | null;
  originalFilename: string;
  mimeType: string;
  originalPath: string;
  originalBytes: string;
  normalizedPath: string | null;
  durationSeconds: string | null;
  language: string;
  model: string;
  chunkCount: number;
  transcriptPath: string | null;
  transcriptText: string | null;
  notionPageId: string | null;
  notionUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  recordedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  chunks: RecordingChunkResponse[];
};

type TranscriptResponse = {
  id: string;
  text: string | null;
  notionPageId: string | null;
  notionUrl: string | null;
};

@Injectable()
export class RecordingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
    private readonly transcriptionQueue: TranscriptionQueue,
  ) {}

  async create(
    dto: CreateRecordingDto,
    file?: Express.Multer.File,
  ): Promise<{ recordingId: string; jobId: string; status: RecordingStatus }> {
    let recordedAt: Date;
    let language: string;

    try {
      this.validateUpload(file);
      recordedAt = this.parseRecordedAt(dto.recordedAt);
      language = this.parseLanguage(dto.language);
    } catch (error) {
      await this.removeTempUpload(file);
      throw error;
    }

    let uploaded: { id: string };

    try {
      uploaded = await this.prisma.recording.create({
        data: {
          status: RecordingStatus.UPLOADED,
          title: dto.title,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          originalPath: '',
          originalBytes: BigInt(file.size),
          language,
          model: this.config.openaiTranscriptionModel,
          recordedAt,
        },
      });
    } catch (error) {
      await this.removeTempUpload(file);
      throw error;
    }

    let saved: { path: string };

    try {
      saved = await this.persistOriginalUpload(uploaded.id, file);
    } catch (error) {
      await this.removeTempUpload(file);
      await this.prisma.recording.update({
        where: { id: uploaded.id },
        data: {
          status: RecordingStatus.FAILED,
          errorCode: STORAGE_SAVE_FAILED_CODE,
          errorMessage: this.errorMessage(error),
        },
      });

      throw error;
    }

    let recording: { id: string; status: RecordingStatus };

    try {
      recording = await this.prisma.recording.update({
        where: { id: uploaded.id },
        data: {
          originalPath: saved.path,
          status: RecordingStatus.QUEUED,
        },
      });
    } catch (error) {
      await this.removeSavedFile(saved.path);

      try {
        await this.prisma.recording.update({
          where: { id: uploaded.id },
          data: {
            status: RecordingStatus.FAILED,
            errorCode: FINALIZE_RECORDING_FAILED_CODE,
            errorMessage: this.errorMessage(error),
          },
        });
      } catch {
        // Preserve the original finalize failure after best-effort recovery.
      }

      throw error;
    }

    const jobRunId = crypto.randomUUID();
    let jobRun: { id: string };

    try {
      jobRun = await this.prisma.jobRun.create({
        data: {
          id: jobRunId,
          recordingId: recording.id,
          queueName: TRANSCRIPTION_QUEUE,
          bullJobId: jobRunId,
          status: JobRunStatus.QUEUED,
        },
      });
    } catch (error) {
      await this.markRecordingFailed(
        recording.id,
        CREATE_JOB_RUN_FAILED_CODE,
        error,
      );

      throw error;
    }

    try {
      await this.transcriptionQueue.enqueue({
        recordingId: recording.id,
        jobId: jobRun.id,
      });
    } catch (error) {
      await this.markQueueHandoffFailed(recording.id, jobRun.id, error);

      throw error;
    }

    return {
      recordingId: recording.id,
      jobId: jobRun.id,
      status: recording.status,
    };
  }

  async findOne(id: string): Promise<RecordingResponse> {
    if (!UUID_PATTERN.test(id)) {
      throw new BadRequestException('Recording id must be a valid UUID.');
    }

    const recording = await this.prisma.recording.findUnique({
      where: { id },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });

    if (!recording) {
      throw new NotFoundException('Recording not found.');
    }

    return this.toRecordingResponse(recording);
  }

  async transcript(id: string): Promise<TranscriptResponse> {
    if (!UUID_PATTERN.test(id)) {
      throw new BadRequestException('Recording id must be a valid UUID.');
    }

    const recording = await this.prisma.recording.findUnique({
      where: { id },
    });

    if (!recording) {
      throw new NotFoundException('Recording not found.');
    }

    if (recording.status !== RecordingStatus.COMPLETED) {
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

  private validateUpload(
    file?: Express.Multer.File,
  ): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException('Audio file is required.');
    }

    if (file.size > this.config.maxUploadBytes) {
      throw new PayloadTooLargeException(
        'Audio file exceeds max upload size.',
      );
    }

    if (!SUPPORTED_MEDIA_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported media type: ${file.mimetype}`,
      );
    }
  }

  private parseRecordedAt(recordedAt: unknown): Date {
    if (recordedAt === undefined) {
      return new Date();
    }

    if (typeof recordedAt !== 'string' || recordedAt.trim() === '') {
      throw new BadRequestException(
        'recordedAt must be a strict ISO-8601 datetime with timezone.',
      );
    }

    const match = ISO_DATETIME_WITH_TIMEZONE.exec(recordedAt);

    if (!match) {
      throw new BadRequestException(
        'recordedAt must be a strict ISO-8601 datetime with timezone.',
      );
    }

    const [
      ,
      yearValue,
      monthValue,
      dayValue,
      hourValue,
      minuteValue,
      secondValue,
      millisecondValue,
      ,
      ,
      offsetHourValue,
      offsetMinuteValue,
    ] = match;
    const year = Number(yearValue);
    const month = Number(monthValue);
    const day = Number(dayValue);
    const hour = Number(hourValue);
    const minute = Number(minuteValue);
    const second = Number(secondValue);
    const millisecond = Number((millisecondValue ?? '0').padEnd(3, '0'));
    const offsetHour =
      offsetHourValue === undefined ? 0 : Number(offsetHourValue);
    const offsetMinute =
      offsetMinuteValue === undefined ? 0 : Number(offsetMinuteValue);
    const componentDate = new Date(
      Date.UTC(year, month - 1, day, hour, minute, second, millisecond),
    );
    const parsed = new Date(recordedAt);
    const hasValidComponents =
      componentDate.getUTCFullYear() === year &&
      componentDate.getUTCMonth() === month - 1 &&
      componentDate.getUTCDate() === day &&
      componentDate.getUTCHours() === hour &&
      componentDate.getUTCMinutes() === minute &&
      componentDate.getUTCSeconds() === second &&
      componentDate.getUTCMilliseconds() === millisecond &&
      offsetHour <= 23 &&
      offsetMinute <= 59 &&
      !Number.isNaN(parsed.getTime());

    if (!hasValidComponents) {
      throw new BadRequestException(
        'recordedAt must be a strict ISO-8601 datetime with timezone.',
      );
    }

    return parsed;
  }

  private parseLanguage(language: unknown): string {
    if (language === undefined) {
      return this.config.defaultTranscriptionLanguage;
    }

    if (
      typeof language !== 'string' ||
      language.trim() === '' ||
      !LANGUAGE_TAG_PATTERN.test(language)
    ) {
      throw new BadRequestException('language must be a valid language tag.');
    }

    return language;
  }

  private async removeSavedFile(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // Best effort cleanup only.
    }
  }

  private async removeTempUpload(file?: Express.Multer.File): Promise<void> {
    if (!file?.path) {
      return;
    }

    await this.removeSavedFile(file.path);
  }

  private persistOriginalUpload(
    recordingId: string,
    file: Express.Multer.File,
  ): Promise<{ path: string }> {
    if (file.path) {
      return this.storage.moveOriginalUpload({
        recordingId,
        originalFilename: file.originalname,
        tempPath: file.path,
      });
    }

    return this.storage.saveOriginalUpload({
      recordingId,
      originalFilename: file.originalname,
      buffer: file.buffer,
    });
  }

  private async markRecordingFailed(
    recordingId: string,
    errorCode: string,
    error: unknown,
  ): Promise<void> {
    try {
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          status: RecordingStatus.FAILED,
          errorCode,
          errorMessage: this.errorMessage(error),
        },
      });
    } catch {
      // Preserve the original queue/job-run failure after best-effort recovery.
    }
  }

  private async markQueueHandoffFailed(
    recordingId: string,
    jobRunId: string,
    error: unknown,
  ): Promise<void> {
    const message = this.errorMessage(error);

    await this.markRecordingFailed(
      recordingId,
      ENQUEUE_RECORDING_FAILED_CODE,
      error,
    );

    try {
      await this.prisma.jobRun.update({
        where: { id: jobRunId },
        data: {
          status: JobRunStatus.FAILED,
          lastError: message,
        },
      });
    } catch {
      // Preserve the original enqueue failure after best-effort recovery.
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private toRecordingResponse(recording: RecordingWithChunks): RecordingResponse {
    return {
      id: recording.id,
      status: recording.status,
      title: recording.title,
      originalFilename: recording.originalFilename,
      mimeType: recording.mimeType,
      originalPath: recording.originalPath,
      originalBytes: recording.originalBytes.toString(),
      normalizedPath: recording.normalizedPath,
      durationSeconds: recording.durationSeconds?.toString() ?? null,
      language: recording.language,
      model: recording.model,
      chunkCount: recording.chunkCount,
      transcriptPath: recording.transcriptPath,
      transcriptText: recording.transcriptText,
      notionPageId: recording.notionPageId,
      notionUrl: recording.notionUrl,
      errorCode: recording.errorCode,
      errorMessage: recording.errorMessage,
      recordedAt: this.toIsoString(recording.recordedAt),
      createdAt: recording.createdAt.toISOString(),
      updatedAt: recording.updatedAt.toISOString(),
      completedAt: this.toIsoString(recording.completedAt),
      chunks: recording.chunks.map((chunk) => ({
        id: chunk.id,
        recordingId: chunk.recordingId,
        index: chunk.index,
        status: chunk.status,
        path: chunk.path,
        bytes: chunk.bytes.toString(),
        startSeconds: chunk.startSeconds.toString(),
        endSeconds: chunk.endSeconds.toString(),
        transcriptPath: chunk.transcriptPath,
        text: chunk.text,
        errorCode: chunk.errorCode,
        errorMessage: chunk.errorMessage,
        createdAt: chunk.createdAt.toISOString(),
        updatedAt: chunk.updatedAt.toISOString(),
      })),
    };
  }

  private toIsoString(value: Date | null): string | null {
    return value?.toISOString() ?? null;
  }
}
