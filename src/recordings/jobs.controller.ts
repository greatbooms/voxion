import { Controller, Get, Param } from '@nestjs/common';
import { RecordingsService } from './recordings.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.recordings.findJob(id);
  }
}
