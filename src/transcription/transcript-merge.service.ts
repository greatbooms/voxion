import { Injectable } from '@nestjs/common';

export type ChunkTranscript = {
  index: number;
  text: string;
  overlapSeconds?: number;
};
export type MergedTranscript<T extends ChunkTranscript = ChunkTranscript> = {
  text: string;
  chunks: T[];
};
export type MergeOptions = {
  language?: string;
};

// STT output arrives as one unbroken stream of text per chunk; regrouping it
// into paragraphs of a few sentences keeps the Notion page body readable.
const MAX_PARAGRAPH_CHARS = 500;

@Injectable()
export class TranscriptMergeService {
  merge<T extends ChunkTranscript>(
    chunks: readonly T[],
    options: MergeOptions = {},
  ): MergedTranscript<T> {
    const orderedChunks = [...chunks].sort(
      (left, right) => left.index - right.index,
    );

    const paragraphs: string[] = [];
    let mergedText = '';

    for (const chunk of orderedChunks) {
      const normalized = this.normalizeTranscriptText(chunk.text);
      const text =
        chunk.overlapSeconds && chunk.overlapSeconds > 0
          ? removeDuplicatedOverlap(mergedText, normalized)
          : normalized;

      paragraphs.push(
        ...(isSpeakerLabeledText(text)
          ? splitSpeakerTurns(text)
          : this.toParagraphs(text, options)),
      );

      if (text.length > 0) {
        mergedText = mergedText.length > 0 ? `${mergedText} ${text}` : text;
      }
    }

    return { text: paragraphs.join('\n\n'), chunks: orderedChunks };
  }

  private toParagraphs(text: string, options: MergeOptions): string[] {
    if (text.length === 0) {
      return [];
    }

    const sentences = segmentSentences(text, options.language);
    const paragraphs: string[] = [];
    let currentParagraph = '';

    for (const sentence of sentences) {
      if (currentParagraph.length === 0) {
        currentParagraph = sentence;
        continue;
      }

      if (currentParagraph.length + sentence.length + 1 > MAX_PARAGRAPH_CHARS) {
        paragraphs.push(currentParagraph);
        currentParagraph = sentence;
        continue;
      }

      currentParagraph += ` ${sentence}`;
    }

    if (currentParagraph.length > 0) {
      paragraphs.push(currentParagraph);
    }

    return paragraphs;
  }

  private normalizeWhitespace(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
  }

  private normalizeTranscriptText(text: string): string {
    const trimmed = text.trim();

    if (!trimmed.includes('\n')) {
      return this.normalizeWhitespace(trimmed);
    }

    return splitExistingParagraphs(trimmed)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter((paragraph) => paragraph.length > 0)
      .join('\n\n');
  }
}

type SentenceSegmenter = {
  segment(text: string): Iterable<{ segment: string }>;
};

type SentenceSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'sentence' },
) => SentenceSegmenter;

function segmentSentences(text: string, language?: string): string[] {
  const segmenter = createSentenceSegmenter(language);

  if (!segmenter) {
    return fallbackSentenceSplit(text);
  }

  return Array.from(segmenter.segment(text), ({ segment }) => segment.trim())
    .filter((sentence) => sentence.length > 0);
}

function createSentenceSegmenter(
  language?: string,
): SentenceSegmenter | undefined {
  const Segmenter = (
    Intl as typeof Intl & { Segmenter?: SentenceSegmenterConstructor }
  ).Segmenter;

  if (!Segmenter) {
    return undefined;
  }

  try {
    return new Segmenter(language, { granularity: 'sentence' });
  } catch {
    return new Segmenter(undefined, { granularity: 'sentence' });
  }
}

function fallbackSentenceSplit(text: string): string[] {
  return text
    .split(/(?<=[.!?…。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function splitExistingParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function splitSpeakerTurns(text: string): string[] {
  return splitExistingParagraphs(text)
    .flatMap((paragraph) =>
      paragraph
        .replace(/\s+((?:speaker[\w -]*|화자\s*\d+|[A-Z]):\s+)/g, '\n\n$1')
        .split(/\n{2,}/),
    )
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function isSpeakerLabeledText(text: string): boolean {
  return /^(speaker[\w -]*|화자\s*\d+|[A-Z]):\s+/im.test(text);
}

function removeDuplicatedOverlap(previousText: string, currentText: string): string {
  if (previousText.length === 0 || currentText.length === 0) {
    return currentText;
  }

  const previousWords = words(previousText);
  const currentWordMatches = Array.from(currentText.matchAll(/\S+/g));
  const currentWords = currentWordMatches.map((match) => match[0]);
  const maxOverlap = Math.min(previousWords.length, currentWords.length);

  for (let size = maxOverlap; size >= 2; size -= 1) {
    const previousSuffix = previousWords.slice(-size).join(' ').toLowerCase();
    const currentPrefix = currentWords.slice(0, size).join(' ').toLowerCase();

    if (previousSuffix === currentPrefix) {
      const nextWord = currentWordMatches[size];

      return nextWord ? currentText.slice(nextWord.index).trim() : '';
    }
  }

  return currentText;
}

function words(text: string): string[] {
  return Array.from(text.matchAll(/\S+/g), (match) => match[0]);
}
