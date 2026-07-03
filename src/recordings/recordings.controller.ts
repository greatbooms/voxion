import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CreateRecordingDto } from './dto/create-recording.dto';
import { RecordingUploadInterceptor } from './recording-upload.interceptor';
import { RecordingsService } from './recordings.service';

@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Post()
  @UseInterceptors(RecordingUploadInterceptor)
  create(
    @Body() dto: CreateRecordingDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.recordings.create(dto, file);
  }

  @Get(':id/transcript')
  transcript(@Param('id') id: string) {
    return this.recordings.transcript(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.recordings.findOne(id);
  }
}
