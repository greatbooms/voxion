import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CreateRecordingDto } from './dto/create-recording.dto';
import { RecordingsService } from './recordings.service';

const MAX_RECORDING_UPLOAD_BYTES = 2147483648;

@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_RECORDING_UPLOAD_BYTES },
    }),
  )
  create(
    @Body() dto: CreateRecordingDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.recordings.create(dto, file);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.recordings.findOne(id);
  }
}
