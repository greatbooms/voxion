import { PreconditionFailedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createReadStream } from 'node:fs';
import OpenAI from 'openai';
import { AppConfigService } from '../config/app-config.service';
import { OpenaiTranscriptionService } from './openai-transcription.service';
import { TranscriptionModule } from './transcription.module';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('node:fs', () => ({
  ...jest.requireActual<typeof import('node:fs')>('node:fs'),
  createReadStream: jest.fn(),
}));

describe('OpenaiTranscriptionService', () => {
  const MockedOpenAI = jest.mocked(OpenAI);
  const mockedCreateReadStream = jest.mocked(createReadStream);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects transcription when OPENAI_API_KEY is not configured', async () => {
    const service = new OpenaiTranscriptionService({
      openaiApiKey: undefined,
      openaiTranscriptionModel: 'gpt-4o-transcribe',
    } as AppConfigService);

    await expect(
      service.transcribe({ path: '/tmp/audio.mp3', language: 'en' }),
    ).rejects.toThrow(
      new PreconditionFailedException('OPENAI_API_KEY is not configured.'),
    );
  });

  it('creates a transcription request and returns text with the raw response', async () => {
    const file = { readable: true };
    const raw = { text: 'Hello world.', id: 'transcription-id' };
    const create = jest.fn().mockResolvedValue(raw);
    MockedOpenAI.mockImplementation(
      () =>
        ({
          audio: {
            transcriptions: {
              create,
            },
          },
        }) as unknown as OpenAI,
    );
    mockedCreateReadStream.mockReturnValue(
      file as ReturnType<typeof createReadStream>,
    );

    const service = new OpenaiTranscriptionService({
      openaiApiKey: 'sk-test',
      openaiTranscriptionModel: 'gpt-4o-transcribe',
    } as AppConfigService);

    const result = await service.transcribe({
      path: '/tmp/audio.mp3',
      language: 'en',
    });

    expect(MockedOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
    expect(mockedCreateReadStream).toHaveBeenCalledWith('/tmp/audio.mp3');
    expect(create).toHaveBeenCalledWith({
      file,
      model: 'gpt-4o-transcribe',
      language: 'en',
      response_format: 'json',
    });
    expect(result).toEqual({ text: 'Hello world.', raw });
  });

  it('adds configured prompt and previous transcript context for non-diarize models', async () => {
    const file = { readable: true };
    const raw = { text: '새 청크입니다.' };
    const create = jest.fn().mockResolvedValue(raw);
    MockedOpenAI.mockImplementation(
      () =>
        ({
          audio: {
            transcriptions: {
              create,
            },
          },
        }) as unknown as OpenAI,
    );
    mockedCreateReadStream.mockReturnValue(
      file as ReturnType<typeof createReadStream>,
    );

    const service = new OpenaiTranscriptionService({
      openaiApiKey: 'sk-test',
      openaiTranscriptionModel: 'gpt-4o-transcribe',
      openaiTranscriptionPrompt: '회의 용어: CMT, Notion, PostgreSQL',
      openaiTranscriptionContextChars: 12,
    } as AppConfigService);

    await service.transcribe({
      path: '/tmp/audio.mp3',
      language: 'ko-KR',
      contextText: '이전 청크 앞부분입니다. 중요한 마지막 문맥',
    } as any);

    expect(create).toHaveBeenCalledWith({
      file,
      model: 'gpt-4o-transcribe',
      language: 'ko',
      response_format: 'json',
      prompt:
        '회의 용어: CMT, Notion, PostgreSQL\n\nPrevious transcript context:\n. 중요한 마지막 문맥',
    });
  });

  it('requests diarized_json and preserves speaker labels for diarize models', async () => {
    const file = { readable: true };
    const raw = {
      text: 'Hello. Hi.',
      segments: [
        { speaker: 'speaker_0', text: 'Hello.', start: 0, end: 1.2 },
        { speaker: 'speaker_1', text: 'Hi.', start: 1.2, end: 2.1 },
        { speaker: 'speaker_1', text: 'How are you?', start: 2.1, end: 3.4 },
      ],
    };
    const create = jest.fn().mockResolvedValue(raw);
    MockedOpenAI.mockImplementation(
      () =>
        ({
          audio: {
            transcriptions: {
              create,
            },
          },
        }) as unknown as OpenAI,
    );
    mockedCreateReadStream.mockReturnValue(
      file as ReturnType<typeof createReadStream>,
    );

    const service = new OpenaiTranscriptionService({
      openaiApiKey: 'sk-test',
      openaiTranscriptionModel: 'gpt-4o-transcribe-diarize',
      openaiTranscriptionPrompt: '회의 용어: CMT, Notion',
      openaiTranscriptionContextChars: 1200,
    } as AppConfigService);

    const result = await service.transcribe({
      path: '/tmp/audio.mp3',
      language: 'ko-KR',
      contextText: '이전 청크 문맥',
    } as any);

    expect(create).toHaveBeenCalledWith({
      file,
      model: 'gpt-4o-transcribe-diarize',
      language: 'ko',
      response_format: 'diarized_json',
      chunking_strategy: 'auto',
    });
    expect(result).toEqual({
      text: 'speaker_0: Hello.\n\nspeaker_1: Hi. How are you?',
      raw,
    });
  });

  it('preserves the OpenAI transcription resource context when creating requests', async () => {
    const file = { readable: true };
    const raw = { text: 'Bound context works.' };
    const create = jest.fn(function (this: { _client?: string }) {
      if (this._client !== 'openai-client') {
        throw new Error('missing OpenAI resource context');
      }

      return Promise.resolve(raw);
    });
    MockedOpenAI.mockImplementation(
      () =>
        ({
          audio: {
            transcriptions: {
              _client: 'openai-client',
              create,
            },
          },
        }) as unknown as OpenAI,
    );
    mockedCreateReadStream.mockReturnValue(
      file as ReturnType<typeof createReadStream>,
    );

    const service = new OpenaiTranscriptionService({
      openaiApiKey: 'sk-test',
      openaiTranscriptionModel: 'gpt-4o-transcribe',
    } as AppConfigService);

    const result = await service.transcribe({
      path: '/tmp/audio.mp3',
      language: 'en',
    });

    expect(create).toHaveBeenCalledWith({
      file,
      model: 'gpt-4o-transcribe',
      language: 'en',
      response_format: 'json',
    });
    expect(result).toEqual({ text: 'Bound context works.', raw });
  });

  it('is exported from TranscriptionModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TranscriptionModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({
        openaiApiKey: undefined,
        openaiTranscriptionModel: 'gpt-4o-transcribe',
      })
      .compile();

    expect(moduleRef.get(OpenaiTranscriptionService)).toBeInstanceOf(
      OpenaiTranscriptionService,
    );

    await moduleRef.close();
  });
});
