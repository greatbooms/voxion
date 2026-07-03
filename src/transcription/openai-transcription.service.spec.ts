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
