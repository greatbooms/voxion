import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ChunkStatus, Prisma, RecordingStatus } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
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

@Injectable()
export class RecordingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
  ) {}

  async create(
    dto: CreateRecordingDto,
    file?: Express.Multer.File,
  ): Promise<{ recordingId: string; status: RecordingStatus }> {
    this.validateUpload(file);
    const recordedAt = this.parseRecordedAt(dto.recordedAt);

    const uploaded = await this.prisma.recording.create({
      data: {
        status: RecordingStatus.UPLOADED,
        title: dto.title,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        originalPath: '',
        originalBytes: BigInt(file.size),
        language: dto.language ?? this.config.defaultTranscriptionLanguage,
        model: this.config.openaiTranscriptionModel,
        recordedAt,
      },
    });

    let saved: { path: string };

    try {
      saved = await this.storage.saveOriginalUpload({
        recordingId: uploaded.id,
        originalFilename: file.originalname,
        buffer: file.buffer,
      });
    } catch (error) {
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

    const recording = await this.prisma.recording.update({
      where: { id: uploaded.id },
      data: {
        originalPath: saved.path,
        status: RecordingStatus.QUEUED,
      },
    });

    return {
      recordingId: recording.id,
      status: recording.status,
    };
  }

  async findOne(id: string): Promise<RecordingResponse> {
    const recording = await this.prisma.recording.findUniqueOrThrow({
      where: { id },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });

    return this.toRecordingResponse(recording);
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

  private parseRecordedAt(recordedAt?: string): Date {
    if (recordedAt === undefined) {
      return new Date();
    }

    if (recordedAt.trim() === '') {
      throw new BadRequestException(
        'recordedAt must be a valid ISO date string.',
      );
    }

    const parsed = new Date(recordedAt);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        'recordedAt must be a valid ISO date string.',
      );
    }

    return parsed;
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
