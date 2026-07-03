import {
  batchBlocks,
  splitTranscriptIntoParagraphBlocks,
} from './notion-blocks';
import type { AppendBlockChildrenParameters } from '@notionhq/client';

function getBlockContents(transcript: string): string[] {
  return splitTranscriptIntoParagraphBlocks(transcript).map(
    (block) => block.paragraph.rich_text[0].text.content,
  );
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

describe('splitTranscriptIntoParagraphBlocks', () => {
  it('splits long transcript paragraphs into Notion-safe paragraph chunks', () => {
    const blocks = splitTranscriptIntoParagraphBlocks('가'.repeat(4500));

    expect(blocks).toHaveLength(3);
    expect(
      blocks.every(
        (block) => block.paragraph.rich_text[0].text.content.length <= 1900,
      ),
    ).toBe(true);
  });

  it('preserves paragraphs separated by blank lines', () => {
    const blocks = splitTranscriptIntoParagraphBlocks(
      '첫 문장입니다.\n\n둘째 문장입니다.',
    );

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'paragraph',
    ]);
    expect(
      blocks.map((block) => block.paragraph.rich_text[0].text.content),
    ).toEqual(['첫 문장입니다.', '둘째 문장입니다.']);
  });

  it('treats CRLF and whitespace-only blank lines as paragraph separators', () => {
    expect(
      getBlockContents(
        '첫 문장입니다.\r\n\r\n둘째 문장입니다.\n  \n셋째 문장입니다.\r\n \t \r\n넷째 문장입니다.',
      ),
    ).toEqual([
      '첫 문장입니다.',
      '둘째 문장입니다.',
      '셋째 문장입니다.',
      '넷째 문장입니다.',
    ]);
  });

  it('does not split emoji surrogate pairs across chunks', () => {
    const transcript = `${'a'.repeat(1899)}😀${'b'.repeat(10)}`;
    const contents = getBlockContents(transcript);

    expect(contents).toHaveLength(2);
    expect(contents.join('')).toBe(transcript);
    expect(contents.every((content) => content.length <= 1900)).toBe(true);
    expect(contents.some(hasLoneSurrogate)).toBe(false);
  });

  it('does not split combining-character grapheme clusters across chunks', () => {
    const transcript = `${'a'.repeat(1899)}e\u0301${'b'.repeat(10)}`;
    const contents = getBlockContents(transcript);

    expect(contents).toHaveLength(2);
    expect(contents.join('')).toBe(transcript);
    expect(contents.every((content) => content.length <= 1900)).toBe(true);
    expect(contents[0].endsWith('e')).toBe(false);
    expect(contents[1].startsWith('\u0301')).toBe(false);
  });

  it('returns blocks compatible with Notion append block children', () => {
    const children: AppendBlockChildrenParameters['children'] =
      splitTranscriptIntoParagraphBlocks('첫 문장입니다.');

    expect(children).toHaveLength(1);
  });

  it('returns no blocks for empty transcripts', () => {
    expect(splitTranscriptIntoParagraphBlocks('')).toEqual([]);
    expect(splitTranscriptIntoParagraphBlocks(' \n\n\t ')).toEqual([]);
  });
});

describe('batchBlocks', () => {
  it('splits blocks into batches of at most the requested size', () => {
    expect(batchBlocks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns an empty list for empty input', () => {
    expect(batchBlocks([], 100)).toEqual([]);
  });

  it('allows Notion append block children maximum batch size', () => {
    expect(batchBlocks([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  it('rejects invalid batch sizes', () => {
    for (const invalidBatchSize of [Number.NaN, 0, -1, 1.5, 101]) {
      expect(() => batchBlocks([1], invalidBatchSize)).toThrow(
        'Invalid batch size',
      );
    }
  });
});
