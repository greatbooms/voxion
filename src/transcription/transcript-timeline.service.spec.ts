import { TranscriptTimelineService } from './transcript-timeline.service';

describe('TranscriptTimelineService', () => {
  const service = new TranscriptTimelineService();

  it('prefixes transcript blocks with estimated timecodes from chunk timings', () => {
    const text = '첫 번째 논의입니다.\n\n두 번째 논의입니다.';
    const chunks = [
      {
        index: 0,
        startSeconds: 0,
        endSeconds: 120,
        text: '첫 번째 논의입니다.',
      },
      {
        index: 1,
        startSeconds: 120,
        endSeconds: 240,
        text: '두 번째 논의입니다.',
      },
    ];

    expect(service.addEstimatedTimecodes(text, chunks)).toBe(
      '[~00:00:00] 첫 번째 논의입니다.\n\n[~00:02:00] 두 번째 논의입니다.',
    );
  });

  it('splits very long paragraphs into sentence groups before adding timecodes', () => {
    const text =
      '첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다. 네 번째 문장입니다.';
    const chunks = [
      {
        index: 0,
        startSeconds: 60,
        endSeconds: 180,
        text,
      },
    ];

    const result = service.addEstimatedTimecodes(text, chunks, {
      maxBlockChars: 20,
    });

    expect(result).toContain('[~00:01:00] 첫 번째 문장입니다.');
    expect(result).toContain('[~00:01:');
    expect(result.split('\n\n')).toHaveLength(4);
  });

  it('returns the original text when there is no usable timing metadata', () => {
    expect(service.addEstimatedTimecodes('전사 본문', [])).toBe('전사 본문');
  });
});
