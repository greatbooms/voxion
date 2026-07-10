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

  it('preserves original chunk metadata sorted by index', () => {
    const second = {
      index: 1,
      text: 'Second.',
      startedAtMs: 1_000,
      endedAtMs: 2_000,
      sourcePath: '/tmp/chunks/chunk-1.wav',
    };
    const first = {
      index: 0,
      text: 'First.',
      startedAtMs: 0,
      endedAtMs: 1_000,
      sourcePath: '/tmp/chunks/chunk-0.wav',
    };

    const result = service.merge([second, first]);

    expect(result.chunks).toEqual([first, second]);
    expect(result.chunks[0]).toBe(first);
    expect(result.chunks[1]).toBe(second);
    expect(result.chunks[0].startedAtMs).toBe(0);
    expect(result.chunks[0].endedAtMs).toBe(1_000);
    expect(result.chunks[0].sourcePath).toBe('/tmp/chunks/chunk-0.wav');
    expect(result.chunks[1].startedAtMs).toBe(1_000);
    expect(result.chunks[1].endedAtMs).toBe(2_000);
    expect(result.chunks[1].sourcePath).toBe('/tmp/chunks/chunk-1.wav');
  });

  it('trims and filters blank text while preserving blank chunk metadata', () => {
    const first = {
      index: 0,
      text: '  First.  ',
      startedAtMs: 0,
      endedAtMs: 1_000,
      sourcePath: '/tmp/chunks/chunk-0.wav',
    };
    const blank = {
      index: 1,
      text: '   ',
      startedAtMs: 1_000,
      endedAtMs: 2_000,
      sourcePath: '/tmp/chunks/chunk-1.wav',
    };
    const second = {
      index: 2,
      text: '\nSecond.\n',
      startedAtMs: 2_000,
      endedAtMs: 3_000,
      sourcePath: '/tmp/chunks/chunk-2.wav',
    };

    const result = service.merge([first, blank, second]);

    expect(result.text).toBe('First.\n\nSecond.');
    expect(result.chunks).toEqual([first, blank, second]);
    expect(result.chunks[1]).toBe(blank);
    expect(result.chunks[1].startedAtMs).toBe(1_000);
    expect(result.chunks[1].endedAtMs).toBe(2_000);
    expect(result.chunks[1].sourcePath).toBe('/tmp/chunks/chunk-1.wav');
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

  it('collapses whitespace while keeping short sentences in one paragraph', () => {
    const result = service.merge([
      {
        index: 0,
        text: '  첫 문장입니다.   두 문장입니다.\nThird sentence.   Fourth?  ',
      },
    ]);

    expect(result.text).toBe(
      '첫 문장입니다. 두 문장입니다. Third sentence. Fourth?',
    );
  });

  it('preserves speaker-labeled diarized transcript turns as paragraphs', () => {
    const result = service.merge([
      {
        index: 0,
        text: 'speaker_0: 안녕하세요.\n\nspeaker_1: 네 반갑습니다. 다음 안건 볼까요?',
      },
    ]);

    expect(result.text).toBe(
      'speaker_0: 안녕하세요.\n\nspeaker_1: 네 반갑습니다. 다음 안건 볼까요?',
    );
  });

  it('preserves single-letter diarized speaker turns as paragraphs', () => {
    const result = service.merge([
      {
        index: 0,
        text: 'A: 안녕하세요.\n\nB: 네 반갑습니다.\n\nA: 다음 안건 보겠습니다.',
      },
    ]);

    expect(result.text).toBe(
      'A: 안녕하세요.\n\nB: 네 반갑습니다.\n\nA: 다음 안건 보겠습니다.',
    );
  });

  it('preserves speaker turn paragraphs after removing overlapped chunk text', () => {
    const result = service.merge([
      {
        index: 0,
        text: 'A: 첫 설명입니다.\n\nB: 네 확인했습니다.',
        overlapSeconds: 0,
      },
      {
        index: 1,
        text: 'B: 네 확인했습니다.\n\nA: 다음 설명입니다.\n\nC: 질문 있습니다.',
        overlapSeconds: 2,
      },
    ]);

    expect(result.text).toBe(
      'A: 첫 설명입니다.\n\nB: 네 확인했습니다.\n\nA: 다음 설명입니다.\n\nC: 질문 있습니다.',
    );
  });

  it('segments long chunk text into readable paragraphs at sentence boundaries', () => {
    const sentence = '이 문장은 충분히 길어서 문단 분할 기준을 검증할 수 있습니다.';
    const sentences = Array.from({ length: 40 }, () => sentence);
    const result = service.merge(
      [{ index: 0, text: sentences.join(' ') }],
      { language: 'ko' },
    );
    const paragraphs = result.text.split('\n\n');

    expect(paragraphs.length).toBeGreaterThan(1);

    for (const paragraph of paragraphs) {
      expect(paragraph.length).toBeLessThanOrEqual(500);
      expect(paragraph.endsWith('.')).toBe(true);
    }

    expect(paragraphs.join(' ')).toBe(sentences.join(' '));
  });

  it('keeps a single oversized sentence intact in its own paragraph', () => {
    const longSentence = `${'가나다라 '.repeat(200)}끝입니다.`;
    const normalized = longSentence.replace(/\s+/g, ' ').trim();
    const result = service.merge([{ index: 0, text: longSentence }], {
      language: 'ko',
    });

    expect(result.text.split('\n\n')).toContain(normalized);
  });

  it('separates chunk transcripts into distinct paragraphs', () => {
    const result = service.merge(
      [
        { index: 0, text: 'First chunk sentence.' },
        { index: 1, text: 'Second chunk sentence.' },
      ],
      { language: 'en' },
    );

    expect(result.text).toBe(
      'First chunk sentence.\n\nSecond chunk sentence.',
    );
  });

  it('removes duplicated boundary text from overlapped chunks', () => {
    const result = service.merge(
      [
        {
          index: 0,
          text: '오늘 회의에서는 예산안을 검토했습니다. 다음 일정도 정했습니다.',
          overlapSeconds: 0,
        },
        {
          index: 1,
          text: '다음 일정도 정했습니다. 마지막으로 질문을 받았습니다.',
          overlapSeconds: 2,
        },
      ],
      { language: 'ko' },
    );

    expect(result.text).toBe(
      '오늘 회의에서는 예산안을 검토했습니다. 다음 일정도 정했습니다.\n\n마지막으로 질문을 받았습니다.',
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
