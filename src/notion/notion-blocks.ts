export type ParagraphBlock = {
  object: 'block';
  type: 'paragraph';
  paragraph: {
    rich_text: Array<{
      type: 'text';
      text: {
        content: string;
      };
    }>;
  };
};

const NOTION_RICH_TEXT_CONTENT_MAX_LENGTH = 1900;
const NOTION_APPEND_CHILDREN_MAX_BLOCKS = 100;
const PARAGRAPH_SEPARATOR_PATTERN =
  /(?:\r\n|\n|\r)[^\S\r\n]*(?:(?:\r\n|\n|\r)[^\S\r\n]*)+/;

export function splitTranscriptIntoParagraphBlocks(
  transcript: string,
): ParagraphBlock[] {
  return transcript
    .split(PARAGRAPH_SEPARATOR_PATTERN)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .flatMap((paragraph) =>
      splitByMaxChars(paragraph, NOTION_RICH_TEXT_CONTENT_MAX_LENGTH),
    )
    .map((content) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content,
            },
          },
        ],
      },
    }));
}

export function batchBlocks<T>(blocks: T[], batchSize = 100): T[][] {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > NOTION_APPEND_CHILDREN_MAX_BLOCKS
  ) {
    throw new RangeError('Invalid batch size');
  }

  const batches: T[][] = [];

  for (let start = 0; start < blocks.length; start += batchSize) {
    batches.push(blocks.slice(start, start + batchSize));
  }

  return batches;
}

function splitByMaxChars(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const segment of splitIntoTextSegments(text)) {
    if (segment.length > maxChars) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      chunks.push(...splitOversizedSegment(segment, maxChars));
      continue;
    }

    if (currentChunk.length + segment.length > maxChars) {
      chunks.push(currentChunk);
      currentChunk = segment;
      continue;
    }

    currentChunk += segment;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

type TextSegmenter = {
  segment(text: string): Iterable<{ segment: string }>;
};

type TextSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => TextSegmenter;

function splitIntoTextSegments(text: string): string[] {
  const Segmenter = (
    Intl as typeof Intl & { Segmenter?: TextSegmenterConstructor }
  ).Segmenter;

  if (Segmenter) {
    return Array.from(
      new Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
      ({ segment }) => segment,
    );
  }

  return Array.from(text);
}

function splitOversizedSegment(segment: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const codePoint of Array.from(segment)) {
    if (currentChunk.length + codePoint.length > maxChars) {
      chunks.push(currentChunk);
      currentChunk = codePoint;
      continue;
    }

    currentChunk += codePoint;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}
