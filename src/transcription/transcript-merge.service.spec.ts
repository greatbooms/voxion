import { Test } from '@nestjs/testing';
import { TranscriptMergeService } from './transcript-merge.service';
import { TranscriptionModule } from './transcription.module';

describe('TranscriptMergeService', () => {
  const service = new TranscriptMergeService();

  it('orders chunks by index and separates paragraphs', () => {
    const result = service.merge([
      { index: 2, text: '세 번째 문장입니다.' },
      { index: 0, text: '첫 번째 문장입니다.' },
      { index: 1, text: '두 번째 문장입니다.' },
    ]);

    expect(result.text).toBe(
      '첫 번째 문장입니다.\n\n두 번째 문장입니다.\n\n세 번째 문장입니다.',
    );
  });

  it('returns empty text and chunks for empty input', () => {
    expect(service.merge([])).toEqual({ text: '', chunks: [] });
  });

  it('preserves original chunk objects sorted by index', () => {
    const second = { index: 1, text: 'Second.' };
    const first = { index: 0, text: 'First.' };

    const result = service.merge([second, first]);

    expect(result.chunks).toEqual([first, second]);
    expect(result.chunks[0]).toBe(first);
    expect(result.chunks[1]).toBe(second);
  });

  it('trims and filters blank text while preserving blank chunks', () => {
    const first = { index: 0, text: '  First.  ' };
    const blank = { index: 1, text: '   ' };
    const second = { index: 2, text: '\nSecond.\n' };

    const result = service.merge([first, blank, second]);

    expect(result.text).toBe('First.\n\nSecond.');
    expect(result.chunks).toEqual([first, blank, second]);
    expect(result.chunks[1]).toBe(blank);
  });

  it('does not mutate the input array', () => {
    const chunks = [
      { index: 2, text: 'Third.' },
      { index: 0, text: 'First.' },
      { index: 1, text: 'Second.' },
    ];

    service.merge(chunks);

    expect(chunks.map((chunk) => chunk.index)).toEqual([2, 0, 1]);
  });

  it('normalizes sentence breaks within each chunk', () => {
    const result = service.merge([
      { index: 0, text: '첫 문장입니다. 두 문장입니다.Third sentence. Fourth?' },
    ]);

    expect(result.text).toBe(
      '첫 문장입니다.\n두 문장입니다.Third sentence.\nFourth?',
    );
  });

  it('is exported from TranscriptionModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TranscriptionModule],
    }).compile();

    expect(moduleRef.get(TranscriptMergeService)).toBeInstanceOf(
      TranscriptMergeService,
    );

    await moduleRef.close();
  });
});
