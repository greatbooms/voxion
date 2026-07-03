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

export function splitTranscriptIntoParagraphBlocks(
  transcript: string,
): ParagraphBlock[] {
  const maxChars = 1900;

  return transcript
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .flatMap((paragraph) => splitByMaxChars(paragraph, maxChars))
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
  if (!Number.isInteger(batchSize) || batchSize < 1) {
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

  for (let start = 0; start < text.length; start += maxChars) {
    chunks.push(text.slice(start, start + maxChars));
  }

  return chunks;
}
