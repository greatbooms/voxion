import { PreconditionFailedException, Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../config/app-config.service';

export type TranscriptPostProcessInput = {
  text: string;
  language?: string;
};

export type TranscriptPostProcessResult = {
  text: string;
  applied: boolean;
  model?: string;
  chunkCount?: number;
  errorMessage?: string;
};

type ChatCreatePayload = {
  model: string;
  temperature: 0;
  messages: Array<{
    role: 'system' | 'user';
    content: string;
  }>;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

@Injectable()
export class TranscriptPostProcessorService {
  constructor(private readonly config: AppConfigService) {}

  async postProcess(
    input: TranscriptPostProcessInput,
  ): Promise<TranscriptPostProcessResult> {
    if (!this.config.openaiPostProcessingEnabled) {
      return { text: input.text, applied: false };
    }

    if (!this.config.openaiApiKey) {
      throw new PreconditionFailedException('OPENAI_API_KEY is not configured.');
    }

    const model = this.config.openaiPostProcessingModel;
    const chunks = splitText(
      input.text,
      this.config.openaiPostProcessingMaxInputChars,
    );
    const maxChunks = this.config.openaiPostProcessingMaxChunks;
    if (chunks.length > maxChunks) {
      throw new Error(
        `Transcript post-processing would require ${chunks.length} OpenAI calls; configured limit is ${maxChunks}.`,
      );
    }

    const client = new OpenAI({ apiKey: this.config.openaiApiKey });
    const processedChunks: string[] = [];

    for (const chunk of chunks) {
      processedChunks.push(
        await this.processChunk(client, {
          model,
          language: input.language,
          text: chunk,
        }),
      );
    }

    return {
      text: processedChunks.join('\n\n').trim(),
      applied: true,
      model,
      chunkCount: chunks.length,
    };
  }

  private async processChunk(
    client: OpenAI,
    input: { model: string; language?: string; text: string },
  ): Promise<string> {
    const completions = client.chat.completions;
    const create = completions.create as unknown as (
      this: typeof completions,
      body: ChatCreatePayload,
    ) => Promise<ChatCompletionResponse>;
    const response = await create.call(completions, {
      model: input.model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: this.buildSystemPrompt(input.language),
        },
        { role: 'user', content: input.text },
      ],
    });

    return response.choices?.[0]?.message?.content?.trim() || input.text;
  }

  private buildSystemPrompt(language?: string): string {
    const promptParts = [
      'You correct speech-to-text transcripts for meeting notes.',
      'Preserve the original meaning, order, and level of detail. Do not summarize.',
      'Fix obvious transcription mistakes, spacing, punctuation, and paragraph breaks.',
      'Keep technical terms, product names, acronyms, numbers, and proper nouns as written when uncertain.',
      'Output only the corrected transcript text.',
      `Transcript language: ${language || 'same as input'}.`,
    ];
    const customPrompt =
      this.config.openaiPostProcessingPrompt?.trim() ||
      this.config.openaiTranscriptionPrompt?.trim();

    if (customPrompt) {
      promptParts.push(`Domain glossary and correction hints:\n${customPrompt}`);
    }

    return promptParts.join('\n\n');
  }
}

function splitText(text: string, maxChars: number): string[] {
  const limit = Math.max(1, maxChars);
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [text]) {
    if (paragraph.length > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...splitByLength(paragraph, limit));
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > limit && current) {
      chunks.push(current);
      current = paragraph;
      continue;
    }

    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [text];
}

function splitByLength(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars));
  }

  return chunks;
}
