import { Injectable } from '@nestjs/common';

export type ChunkTranscript = { index: number; text: string };
export type MergedTranscript<T extends ChunkTranscript = ChunkTranscript> = {
  text: string;
  chunks: T[];
};

@Injectable()
export class TranscriptMergeService {
  merge<T extends ChunkTranscript>(chunks: readonly T[]): MergedTranscript<T> {
    const orderedChunks = [...chunks].sort(
      (left, right) => left.index - right.index,
    );

    return {
      text: orderedChunks
        .map((chunk) => this.normalizeWhitespace(chunk.text))
        .filter((text) => text.length > 0)
        .join('\n\n'),
      chunks: orderedChunks,
    };
  }

  private normalizeWhitespace(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
  }
}
