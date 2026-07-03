import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import multer, { memoryStorage } from 'multer';
import { Observable } from 'rxjs';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class RecordingUploadInterceptor implements NestInterceptor {
  constructor(private readonly config: AppConfigService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    await new Promise<void>((resolve, reject) => {
      const upload = multer({
        storage: memoryStorage(),
        limits: { fileSize: this.config.maxUploadBytes },
      }).single('file');

      upload(request, response, (error: unknown) => {
        if (!error) {
          resolve();
          return;
        }

        if (
          error instanceof multer.MulterError &&
          error.code === 'LIMIT_FILE_SIZE'
        ) {
          reject(new PayloadTooLargeException('Audio file exceeds max upload size.'));
          return;
        }

        reject(
          new BadRequestException(
            error instanceof Error ? error.message : 'Invalid multipart upload.',
          ),
        );
      });
    });

    return next.handle();
  }
}
