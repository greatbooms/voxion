import { PreconditionFailedException } from '@nestjs/common';
import { Client } from '@notionhq/client';
import { Test } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { NotionModule } from './notion.module';
import { NotionService } from './notion.service';

jest.mock('@notionhq/client', () => ({
  Client: jest.fn(),
}));

describe('NotionService', () => {
  const MockedClient = jest.mocked(Client);
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('rejects page creation when Notion data source id is missing', async () => {
    const service = new NotionService({
      notionToken: 'notion-token',
      notionDataSourceId: undefined,
      notionVersion: '2022-06-28',
    } as AppConfigService);

    await expect(service.createRecordingPage(input)).rejects.toThrow(
      new PreconditionFailedException('Notion environment is not configured.'),
    );
  });

  it('creates a page, appends transcript blocks in batches, and returns page details', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'page-id',
      url: 'https://notion.so/page-id',
    });
    const append = jest.fn().mockResolvedValue({});
    MockedClient.mockImplementation(
      () =>
        ({
          pages: { create },
          blocks: { children: { append } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionDataSourceId: 'data-source-id',
      notionVersion: '2022-06-28',
    } as AppConfigService);
    const transcript = Array.from(
      { length: 250 },
      (_, index) => `Paragraph ${index + 1}`,
    ).join('\n\n');

    const result = await service.createRecordingPage({
      ...input,
      transcript,
      durationSeconds: 12.5,
      recordedAt: new Date('2026-07-03T01:02:03.000Z'),
    });

    expect(MockedClient).toHaveBeenCalledWith({
      auth: 'notion-token',
      notionVersion: '2022-06-28',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { data_source_id: 'data-source-id' },
        properties: expect.objectContaining({
          Name: { title: [{ text: { content: 'Interview' } }] },
          Status: { select: { name: 'Transcribed' } },
          Language: { rich_text: [{ text: { content: 'en' } }] },
          Model: { rich_text: [{ text: { content: 'gpt-4o-transcribe' } }] },
          'Duration Seconds': { number: 12.5 },
          'Original Filename': {
            rich_text: [{ text: { content: 'interview.mp3' } }],
          },
          'File Size MB': { number: 1.25 },
          'Chunk Count': { number: 2 },
          'Recorded At': { date: { start: '2026-07-03T01:02:03.000Z' } },
          'Uploaded At': { date: { start: expect.any(String) } },
        }),
      }),
    );
    expect(append).toHaveBeenCalledTimes(3);
    expect(append).toHaveBeenNthCalledWith(1, {
      block_id: 'page-id',
      children: expect.arrayContaining([
        expect.objectContaining({
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'Paragraph 1' } }],
          },
        }),
      ]),
    });
    expect(append.mock.calls[0][0].children).toHaveLength(100);
    expect(append.mock.calls[1][0].children).toHaveLength(100);
    expect(append.mock.calls[2][0].children).toHaveLength(50);
    expect(result).toEqual({
      pageId: 'page-id',
      url: 'https://notion.so/page-id',
    });
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
