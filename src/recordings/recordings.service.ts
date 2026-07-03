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

const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/mpga',
  'audio/m4a',
  'audio/wav',
  'audio/webm',
  'video/mp4',
]);

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

    const recording = await this.prisma.$transaction(async (prisma) => {
      const uploaded = await prisma.recording.create({
        data: {
          status: RecordingStatus.UPLOADED,
          title: dto.title,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          originalPath: '',
          originalBytes: BigInt(file.size),
          language: dto.language ?? this.config.defaultTranscriptionLanguage,
          model: this.config.openaiTranscriptionModel,
          recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        },
      });

      const saved = await this.storage.saveOriginalUpload({
        recordingId: uploaded.id,
        originalFilename: file.originalname,
        buffer: file.buffer,
      });

      return prisma.recording.update({
        where: { id: uploaded.id },
        data: {
          originalPath: saved.path,
          status: RecordingStatus.QUEUED,
        },
      });
    });

    return {
      recordingId: recording.id,
      status: recording.status,
    };
  }

  findOne(id: string) {
    return this.prisma.recording.findUniqueOrThrow({
      where: { id },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });
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

    if (!SUPPORTED_AUDIO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported audio type: ${file.mimetype}`,
      );
    }
  }
}
