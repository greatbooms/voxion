import { PreconditionFailedException, Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import OpenAI from 'openai';
import { AppConfigService } from '../config/app-config.service';

export type TranscribeInput = {
  path: string;
  language?: string;
};

export type TranscribeResult = {
  text: string;
  raw: unknown;
};

@Injectable()
export class OpenaiTranscriptionService {
  constructor(private readonly config: AppConfigService) {}

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (!this.config.openaiApiKey) {
      throw new PreconditionFailedException('OPENAI_API_KEY is not configured.');
    }

    const client = new OpenAI({ apiKey: this.config.openaiApiKey });
    const result = await client.audio.transcriptions.create({
      file: createReadStream(input.path),
      model: this.config.openaiTranscriptionModel,
      language: input.language,
      response_format: 'json',
    });

    return { text: result.text, raw: result };
  }
}
