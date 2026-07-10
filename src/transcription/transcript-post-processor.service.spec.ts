import { PreconditionFailedException } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../config/app-config.service';
import { TranscriptPostProcessorService } from './transcript-post-processor.service';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('TranscriptPostProcessorService', () => {
  const MockedOpenAI = jest.mocked(OpenAI);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the original transcript without calling OpenAI when disabled', async () => {
    const service = new TranscriptPostProcessorService(makeConfig({
      openaiApiKey: 'sk-test',
      openaiPostProcessingEnabled: false,
      openaiPostProcessingModel: 'gpt-4.1',
      openaiPostProcessingMaxInputChars: 24000,
      openaiPostProcessingMaxChunks: 8,
    }));

    await expect(
      service.postProcess({ text: '원문 전사', language: 'ko' }),
    ).resolves.toEqual({ text: '원문 전사', applied: false });
    expect(MockedOpenAI).not.toHaveBeenCalled();
  });

  it('rejects enabled post-processing when OPENAI_API_KEY is not configured', async () => {
    const service = new TranscriptPostProcessorService(makeConfig({
      openaiApiKey: undefined,
      openaiPostProcessingEnabled: true,
      openaiPostProcessingModel: 'gpt-4.1',
      openaiPostProcessingMaxInputChars: 24000,
      openaiPostProcessingMaxChunks: 8,
    }));

    await expect(
      service.postProcess({ text: '원문 전사', language: 'ko' }),
    ).rejects.toThrow(
      new PreconditionFailedException('OPENAI_API_KEY is not configured.'),
    );
  });

  it('uses chat completions with the configured correction prompt', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '보정된 전사' } }],
    });
    MockedOpenAI.mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create,
            },
          },
        }) as unknown as OpenAI,
    );

    const service = new TranscriptPostProcessorService(makeConfig({
      openaiApiKey: 'sk-test',
      openaiPostProcessingEnabled: true,
      openaiPostProcessingModel: 'gpt-4.1',
      openaiPostProcessingPrompt: '회의 용어: CMT, Notion, PostgreSQL',
      openaiPostProcessingMaxInputChars: 24000,
      openaiPostProcessingMaxChunks: 8,
    }));

    await expect(
      service.postProcess({ text: '원문 전사', language: 'ko' }),
    ).resolves.toEqual({
      text: '보정된 전사',
      applied: true,
      model: 'gpt-4.1',
      chunkCount: 1,
    });

    expect(MockedOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
    expect(create).toHaveBeenCalledWith({
      model: 'gpt-4.1',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: expect.stringContaining('회의 용어: CMT, Notion, PostgreSQL'),
        },
        { role: 'user', content: '원문 전사' },
      ],
    });
  });

  it('splits long transcripts before post-processing and joins the corrected chunks', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '첫 문단 보정' } }] })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '둘째 문단 보정' } }],
      });
    MockedOpenAI.mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create,
            },
          },
        }) as unknown as OpenAI,
    );

    const service = new TranscriptPostProcessorService(makeConfig({
      openaiApiKey: 'sk-test',
      openaiPostProcessingEnabled: true,
      openaiPostProcessingModel: 'gpt-4.1',
      openaiPostProcessingMaxInputChars: 8,
      openaiPostProcessingMaxChunks: 8,
    }));

    await expect(
      service.postProcess({ text: '첫 문단\n\n둘째 문단', language: 'ko' }),
    ).resolves.toEqual({
      text: '첫 문단 보정\n\n둘째 문단 보정',
      applied: true,
      model: 'gpt-4.1',
      chunkCount: 2,
    });

    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'user', content: '첫 문단' }]),
      }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'user', content: '둘째 문단' }]),
      }),
    );
  });

  it('rejects transcripts that would exceed the configured post-processing call limit', async () => {
    const create = jest.fn();
    MockedOpenAI.mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create,
            },
          },
        }) as unknown as OpenAI,
    );

    const service = new TranscriptPostProcessorService(makeConfig({
      openaiApiKey: 'sk-test',
      openaiPostProcessingEnabled: true,
      openaiPostProcessingModel: 'gpt-4.1',
      openaiPostProcessingMaxInputChars: 4,
      openaiPostProcessingMaxChunks: 1,
    }));

    await expect(
      service.postProcess({ text: '첫문단\n\n둘문단', language: 'ko' }),
    ).rejects.toThrow(
      'Transcript post-processing would require 2 OpenAI calls; configured limit is 1.',
    );
    expect(create).not.toHaveBeenCalled();
  });
});

function makeConfig(
  overrides: Partial<AppConfigService>,
): AppConfigService {
  return {
    openaiTranscriptionPrompt: undefined,
    ...overrides,
  } as unknown as AppConfigService;
}
