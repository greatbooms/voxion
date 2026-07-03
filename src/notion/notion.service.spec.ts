import { PreconditionFailedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { NotionModule } from './notion.module';
import { NotionService } from './notion.service';

describe('NotionService', () => {
  const input = {
    title: 'Interview',
    status: 'Transcribed',
    language: 'en',
    model: 'gpt-4o-transcribe',
    originalFilename: 'interview.mp3',
    fileSizeMb: 1.25,
    chunkCount: 2,
    transcript: 'Hello world.',
  };

  it('rejects page creation when Notion config is missing', async () => {
    const service = new NotionService({
      notionToken: undefined,
      notionDataSourceId: 'data-source-id',
      notionVersion: '2022-06-28',
    } as AppConfigService);

    await expect(service.createRecordingPage(input)).rejects.toThrow(
      new PreconditionFailedException('Notion environment is not configured.'),
    );
  });

  it('is exported from NotionModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotionModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({
        notionToken: undefined,
        notionDataSourceId: undefined,
        notionVersion: '2022-06-28',
      })
      .compile();

    expect(moduleRef.get(NotionService)).toBeInstanceOf(NotionService);

    await moduleRef.close();
  });
});
