import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';
import { RecordingsModule } from './recordings/recordings.module';

@Module({
  imports: [AppConfigModule, PrismaModule, JobsModule, RecordingsModule],
})
export class AppModule {}
