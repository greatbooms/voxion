import { Injectable } from '@nestjs/common';

export type TranscriptTimelineChunk = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type TranscriptTimelineOptions = {
  maxBlockChars?: number;
};

@Injectable()
export class TranscriptTimelineService {
  addEstimatedTimecodes(
    text: string,
    chunks: TranscriptTimelineChunk[],
    options: TranscriptTimelineOptions = {},
  ): string {
    const usableChunks = chunks
      .filter((chunk) => isFiniteTime(chunk.startSeconds, chunk.endSeconds))
      .sort((a, b) => a.index - b.index);

    if (!text.trim() || usableChunks.length === 0) {
      return text;
    }

    const blocks = splitTranscriptBlocks(text, options.maxBlockChars ?? 420);
    if (blocks.length === 0) {
      return text;
    }

    const rawChunkLengths = usableChunks.map((chunk) =>
      normalizedTextLength(chunk.text),
    );
    const rawTotal = sum(rawChunkLengths) || normalizedTextLength(text);
    const finalTotal = sum(blocks.map(normalizedTextLength)) || rawTotal;
    let finalCursor = 0;

    return blocks
      .map((block) => {
        const rawCursor = (finalCursor / finalTotal) * rawTotal;
        const seconds = estimateSecondsAtRawCursor(
          rawCursor,
          usableChunks,
          rawChunkLengths,
          rawTotal,
        );
        finalCursor += normalizedTextLength(block);

        return `[~${formatTimecode(seconds)}] ${block}`;
      })
      .join('\n\n');
  }
}

function splitTranscriptBlocks(text: string, maxBlockChars: number): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLongParagraph(paragraph, maxBlockChars));
}

function splitLongParagraph(paragraph: string, maxBlockChars: number): string[] {
  if (paragraph.length <= maxBlockChars) {
    return [paragraph];
  }

  const sentences =
    paragraph
      .match(/[^.!?。！？]+[.!?。！？]?/g)
      ?.map((sentence) => sentence.trim()) ??
    [paragraph];
  const blocks: string[] = [];
  let current = '';

  for (const sentence of sentences.filter(Boolean)) {
    if (sentence.length > maxBlockChars) {
      if (current) {
        blocks.push(current);
        current = '';
      }
      blocks.push(...splitByLength(sentence, maxBlockChars));
      continue;
    }

    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > maxBlockChars && current) {
      blocks.push(current);
      current = sentence;
      continue;
    }

    current = next;
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

function estimateSecondsAtRawCursor(
  rawCursor: number,
  chunks: TranscriptTimelineChunk[],
  chunkLengths: number[],
  rawTotal: number,
): number {
  let cursor = 0;

  for (const [index, chunk] of chunks.entries()) {
    const length = chunkLengths[index] || rawTotal / chunks.length;
    const nextCursor = cursor + length;

    if (rawCursor <= nextCursor || index === chunks.length - 1) {
      const ratio = length > 0 ? (rawCursor - cursor) / length : 0;
      return (
        chunk.startSeconds + clamp(ratio) * (chunk.endSeconds - chunk.startSeconds)
      );
    }

    cursor = nextCursor;
  }

  return chunks[0].startSeconds;
}

function splitByLength(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars).trim());
  }

  return chunks.filter(Boolean);
}

function normalizedTextLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isFiniteTime(startSeconds: number, endSeconds: number): boolean {
  return (
    Number.isFinite(startSeconds) &&
    Number.isFinite(endSeconds) &&
    endSeconds >= startSeconds
  );
}

function formatTimecode(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  return [hours, minutes, secs]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}
