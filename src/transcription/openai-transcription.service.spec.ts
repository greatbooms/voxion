import { PreconditionFailedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { OpenaiTranscriptionService } from './openai-transcription.service';
import { TranscriptionModule } from './transcription.module';

describe('OpenaiTranscriptionService', () => {
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
