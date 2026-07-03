import { Injectable } from '@nestjs/common';

export type ChunkTranscript = { index: number; text: string };
export type MergedTranscript = { text: string; chunks: ChunkTranscript[] };

@Injectable()
export class TranscriptMergeService {
  merge(chunks: ChunkTranscript[]): MergedTranscript {
    const normalizedChunks = [...chunks]
      .sort((left, right) => left.index - right.index)
      .map((chunk) => ({
        chunk,
        text: this.normalizeSentences(chunk.text),
      }))
      .filter(({ text }) => text.length > 0);

    return {
      text: normalizedChunks.map(({ text }) => text).join('\n\n'),
      chunks: normalizedChunks.map(({ chunk }) => chunk),
    };
  }

  private normalizeSentences(text: string): string {
    return text
      .replace(/([.!?。！？]|다\.)\s+/g, '$1\n')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }
}
