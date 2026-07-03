import {
  batchBlocks,
  splitTranscriptIntoParagraphBlocks,
} from './notion-blocks';

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

  it('rejects invalid batch sizes', () => {
    expect(() => batchBlocks([1], Number.NaN)).toThrow('Invalid batch size');
  });
});
