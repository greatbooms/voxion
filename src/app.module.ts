import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RecordingsModule } from './recordings/recordings.module';

@Module({
  imports: [AppConfigModule, PrismaModule, RecordingsModule],
})
export class AppModule {}
