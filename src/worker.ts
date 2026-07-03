import { Logger } from '@nestjs/common';
import { BullRegistrar } from '@nestjs/bullmq';
import { NestFactory } from '@nestjs/core';
import { JobsModule } from './jobs/jobs.module';

async function bootstrap() {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(JobsModule);
  const registrar = app.get(BullRegistrar);

  registrar.register();

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.log(`Received ${signal}; shutting down worker`);
    await app.close();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.log('Worker started');
}

void bootstrap();
