import { Injectable } from '@nestjs/common';

export type ChunkTranscript = { index: number; text: string };
export type MergedTranscript = { text: string; chunks: ChunkTranscript[] };

@Injectable()
export class TranscriptMergeService {
  merge(chunks: ChunkTranscript[]): MergedTranscript {
    const orderedChunks = [...chunks].sort(
      (left, right) => left.index - right.index,
    );

    return {
      text: orderedChunks
        .map((chunk) => this.normalizeSentences(chunk.text))
        .filter((text) => text.length > 0)
        .join('\n\n'),
      chunks: orderedChunks,
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
