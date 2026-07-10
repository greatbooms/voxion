import { PreconditionFailedException, Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import OpenAI from 'openai';
import { AppConfigService } from '../config/app-config.service';

export type TranscribeInput = {
  path: string;
  language?: string;
  contextText?: string;
};

export type TranscribeResult = {
  text: string;
  raw: unknown;
};

type TranscriptionCreatePayload = {
  file: ReturnType<typeof createReadStream>;
  model: string;
  language?: string;
  prompt?: string;
  response_format: 'json' | 'diarized_json';
  chunking_strategy?: 'auto';
};

type DiarizedSegment = {
  speaker?: string;
  text?: string;
};

type DiarizedResponse = {
  text?: string;
  segments?: DiarizedSegment[];
};

@Injectable()
export class OpenaiTranscriptionService {
  constructor(private readonly config: AppConfigService) {}

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (!this.config.openaiApiKey) {
      throw new PreconditionFailedException('OPENAI_API_KEY is not configured.');
    }

    const model = this.config.openaiTranscriptionModel;
    const client = new OpenAI({ apiKey: this.config.openaiApiKey });
    const diarize = isDiarizeModel(model);
    const prompt = diarize
      ? undefined
      : buildPrompt({
          basePrompt: this.config.openaiTranscriptionPrompt,
          contextText: input.contextText,
          maxContextChars: this.config.openaiTranscriptionContextChars,
        });
    const payload: TranscriptionCreatePayload = {
      file: createReadStream(input.path),
      model,
      language: toIso639Primary(input.language),
      response_format: diarize ? 'diarized_json' : 'json',
      ...(prompt ? { prompt } : {}),
      ...(diarize ? { chunking_strategy: 'auto' as const } : {}),
    };
    const transcriptions = client.audio.transcriptions;
    const create = transcriptions.create as unknown as (
      this: typeof transcriptions,
      body: TranscriptionCreatePayload,
    ) => Promise<unknown>;
    const result = await create.call(transcriptions, payload);

    return {
      text: diarize ? formatDiarizedText(result) : textOf(result),
      raw: result,
    };
  }
}

function buildPrompt(input: {
  basePrompt?: string;
  contextText?: string;
  maxContextChars?: number;
}): string | undefined {
  const parts: string[] = [];
  const basePrompt = input.basePrompt?.trim();
  if (basePrompt) {
    parts.push(basePrompt);
  }

  const contextText = tail(input.contextText?.trim(), input.maxContextChars);
  if (contextText) {
    parts.push(`Previous transcript context:\n${contextText}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function tail(text: string | undefined, maxChars?: number): string | undefined {
  if (!text) {
    return undefined;
  }

  const limit = maxChars ?? 1200;
  if (limit <= 0 || text.length <= limit) {
    return limit <= 0 ? undefined : text;
  }

  return text.slice(-limit);
}

// OpenAI rejects region-qualified tags like "ko-KR"; it only accepts
// ISO-639-1 primary subtags.
function toIso639Primary(language?: string): string | undefined {
  if (!language) {
    return undefined;
  }

  return language.split('-')[0].toLowerCase();
}

function isDiarizeModel(model: string): boolean {
  return model.includes('diarize');
}

function textOf(result: unknown): string {
  if (
    typeof result === 'object' &&
    result !== null &&
    'text' in result &&
    typeof result.text === 'string'
  ) {
    return result.text;
  }

  return '';
}

function formatDiarizedText(result: unknown): string {
  const response = result as DiarizedResponse;

  if (!Array.isArray(response.segments) || response.segments.length === 0) {
    return response.text ?? '';
  }

  const turns: Array<{ speaker: string; text: string }> = [];

  for (const segment of response.segments) {
    const speaker = segment.speaker?.trim() || 'speaker_unknown';
    const text = segment.text?.trim();

    if (!text) {
      continue;
    }

    const previous = turns.at(-1);
    if (previous?.speaker === speaker) {
      previous.text += ` ${text}`;
      continue;
    }

    turns.push({ speaker, text });
  }

  return turns
    .map((turn) => `${turn.speaker}: ${turn.text}`)
    .join('\n\n');
}
