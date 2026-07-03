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

@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
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
