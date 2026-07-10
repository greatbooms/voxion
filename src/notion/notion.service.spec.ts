import { PreconditionFailedException } from '@nestjs/common';
import { Client } from '@notionhq/client';
import { Test } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { NotionModule } from './notion.module';
import { NotionService } from './notion.service';

jest.mock('@notionhq/client', () => ({
  Client: jest.fn(),
}));

function markerBlock(content: string, id = `${content}-id`) {
  return {
    object: 'block',
    id,
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content } }],
    },
  };
}

function paragraphBlock(id: string, content: string) {
  return {
    object: 'block',
    id,
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content }, plain_text: content }],
    },
  };
}

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
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await expect(service.createRecordingPage(input)).rejects.toThrow(
      new PreconditionFailedException('Notion environment is not configured.'),
    );
  });

  it('rejects page creation when Notion data source id is missing', async () => {
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: undefined,
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await expect(service.createRecordingPage(input)).rejects.toThrow(
      new PreconditionFailedException('Notion environment is not configured.'),
    );
  });

  it('creates a page metadata payload and returns page details', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      properties: {
        Name: { type: 'title' },
        Status: { type: 'select' },
        Language: { type: 'rich_text' },
        Model: { type: 'rich_text' },
        'Duration Seconds': { type: 'number' },
        'Original Filename': { type: 'rich_text' },
        'File Size MB': { type: 'number' },
        'Chunk Count': { type: 'number' },
        'Recorded At': { type: 'date' },
        'Uploaded At': { type: 'date' },
        'Recording Id': { type: 'rich_text' },
      },
    });
    const update = jest.fn();
    const create = jest.fn().mockResolvedValue({
      id: 'page-id',
      url: 'https://notion.so/page-id',
    });
    MockedClient.mockImplementation(
      () =>
        ({
          pages: { create },
          dataSources: { retrieve, update },
          blocks: { children: {} },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    const result = await service.createRecordingPageMetadata({
      ...input,
      durationSeconds: 12.5,
      recordedAt: new Date('2026-07-03T01:02:03.000Z'),
    });

    expect(MockedClient).toHaveBeenCalledWith({
      auth: 'notion-token',
      notionVersion: '2026-03-11',
    });
    expect(retrieve).toHaveBeenCalledWith({
      data_source_id: 'data-source-id',
    });
    expect(update).not.toHaveBeenCalled();
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
    expect(result).toEqual({
      pageId: 'page-id',
      url: 'https://notion.so/page-id',
    });
  });

  it('adds missing metadata properties before creating a page', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      properties: {
        Name: { type: 'title' },
      },
    });
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn().mockResolvedValue({
      id: 'page-id',
      url: 'https://notion.so/page-id',
    });
    MockedClient.mockImplementation(
      () =>
        ({
          pages: { create },
          dataSources: { retrieve, update },
          blocks: { children: {} },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await service.createRecordingPageMetadata({
      ...input,
      durationSeconds: 12.5,
      recordedAt: new Date('2026-07-03T01:02:03.000Z'),
    });

    expect(update).toHaveBeenCalledWith({
      data_source_id: 'data-source-id',
      properties: expect.objectContaining({
        Status: expect.objectContaining({ type: 'select' }),
        Language: expect.objectContaining({ type: 'rich_text' }),
        'Recorded At': expect.objectContaining({ type: 'date' }),
        'Recording Id': expect.objectContaining({
          type: 'rich_text',
        }),
      }),
    });
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0],
    );
  });

  it('appends only missing transcript paragraph blocks in batches', async () => {
    const list = jest
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            object: 'block',
            type: 'heading_2',
            heading_2: {
              rich_text: [
                { type: 'text', text: { content: 'Voxion Transcript' } },
              ],
            },
          },
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: 'Paragraph 1' } }],
            },
          },
        ],
        has_more: true,
        next_cursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        results: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: 'Paragraph 2' } }],
            },
          },
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: 'Paragraph 3' } }],
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
    const append = jest.fn().mockResolvedValue({});
    MockedClient.mockImplementation(
      () =>
        ({
          blocks: { children: { append, list } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);
    const transcript = Array.from(
      { length: 205 },
      (_, index) => `Paragraph ${index + 1}`,
    ).join('\n\n');

    await service.appendTranscriptToPage({ pageId: 'page-id', transcript });

    expect(list).toHaveBeenNthCalledWith(1, {
      block_id: 'page-id',
      page_size: 100,
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      block_id: 'page-id',
      page_size: 100,
      start_cursor: 'cursor-2',
    });
    expect(append).toHaveBeenCalledTimes(3);
    expect(append).toHaveBeenNthCalledWith(1, {
      block_id: 'page-id',
      children: expect.arrayContaining([
        expect.objectContaining({
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'Paragraph 4' } }],
          },
        }),
      ]),
    });
    expect(append.mock.calls[0][0].children).toHaveLength(100);
    expect(append.mock.calls[1][0].children).toHaveLength(100);
    expect(append.mock.calls[2][0].children).toHaveLength(2);
  });

  it('ignores non-transcript paragraphs before the transcript marker', async () => {
    const list = jest.fn().mockResolvedValue({
      results: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'Template intro' } }],
          },
        },
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [
              { type: 'text', text: { content: 'Voxion Transcript' } },
            ],
          },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'Paragraph 1' } }],
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });
    const append = jest.fn().mockResolvedValue({});
    MockedClient.mockImplementation(
      () =>
        ({
          blocks: { children: { append, list } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await service.appendTranscriptToPage({
      pageId: 'page-id',
      transcript: 'Paragraph 1\n\nParagraph 2\n\nParagraph 3',
    });

    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      block_id: 'page-id',
      children: [
        expect.objectContaining({
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'Paragraph 2' } }],
          },
        }),
        expect.objectContaining({
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'Paragraph 3' } }],
          },
        }),
      ],
    });
  });

  it('adds a transcript marker before appending transcript blocks to a fresh page', async () => {
    const list = jest.fn().mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    const append = jest.fn().mockResolvedValue({});
    MockedClient.mockImplementation(
      () =>
        ({
          blocks: { children: { append, list } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await service.appendTranscriptToPage({
      pageId: 'page-id',
      transcript: 'Paragraph 1\n\nParagraph 2',
    });

    expect(append).toHaveBeenCalledWith({
      block_id: 'page-id',
      children: [
        expect.objectContaining({
          type: 'heading_2',
          heading_2: {
            rich_text: [
              { type: 'text', text: { content: 'Voxion Transcript' } },
            ],
          },
        }),
        expect.objectContaining({
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'Paragraph 1' } }],
          },
        }),
        expect.objectContaining({
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'Paragraph 2' } }],
          },
        }),
      ],
    });
  });

  it('keeps createRecordingPage backwards-compatible', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      properties: {
        Name: { type: 'title' },
      },
    });
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn().mockResolvedValue({
      id: 'page-id',
      url: 'https://notion.so/page-id',
    });
    const list = jest.fn().mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    const append = jest.fn().mockResolvedValue({});
    MockedClient.mockImplementation(
      () =>
        ({
          pages: { create },
          dataSources: { retrieve, update },
          blocks: { children: { append, list } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    const result = await service.createRecordingPage(input);

    expect(create).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({
      block_id: 'page-id',
      page_size: 100,
    });
    expect(append).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      pageId: 'page-id',
      url: 'https://notion.so/page-id',
    });
  });

  it('retries rate-limited Notion calls using the Retry-After header', async () => {
    const rateLimited = Object.assign(new Error('rate limited'), {
      status: 429,
      headers: { 'retry-after': '2' },
    });
    const list = jest.fn().mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    const append = jest
      .fn()
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValue({});
    MockedClient.mockImplementation(
      () =>
        ({
          blocks: { children: { append, list } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);
    const sleep = jest.fn().mockResolvedValue(undefined);
    (service as any).sleepFn = sleep;

    await service.appendTranscriptToPage({
      pageId: 'page-id',
      transcript: 'Paragraph 1',
    });

    expect(append).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('gives up after repeated overload responses', async () => {
    const overloaded = Object.assign(new Error('overloaded'), {
      status: 529,
    });
    const list = jest.fn().mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    const append = jest.fn().mockRejectedValue(overloaded);
    MockedClient.mockImplementation(
      () =>
        ({
          blocks: { children: { append, list } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);
    const sleep = jest.fn().mockResolvedValue(undefined);
    (service as any).sleepFn = sleep;

    await expect(
      service.appendTranscriptToPage({
        pageId: 'page-id',
        transcript: 'Paragraph 1',
      }),
    ).rejects.toThrow('overloaded');

    expect(append).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenNthCalledWith(1, 1_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2_000);
  });

  it('does not retry non-transient Notion errors', async () => {
    const badRequest = Object.assign(new Error('invalid request'), {
      status: 400,
    });
    const list = jest.fn().mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    const append = jest.fn().mockRejectedValue(badRequest);
    MockedClient.mockImplementation(
      () =>
        ({
          blocks: { children: { append, list } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await expect(
      service.appendTranscriptToPage({
        pageId: 'page-id',
        transcript: 'Paragraph 1',
      }),
    ).rejects.toThrow('invalid request');

    expect(append).toHaveBeenCalledTimes(1);
  });

  it('appends a chunks section with timestamps after the transcript', async () => {
    const list = jest.fn().mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    const append = jest.fn().mockResolvedValue({});
    MockedClient.mockImplementation(
      () =>
        ({
          blocks: { children: { append, list } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await service.appendTranscriptToPage({
      pageId: 'page-id',
      transcript: 'Paragraph 1',
      chunks: [
        { index: 1, startSeconds: 2700, endSeconds: 3661 },
        { index: 0, startSeconds: 0, endSeconds: 2700 },
      ],
    });

    expect(append).toHaveBeenCalledWith({
      block_id: 'page-id',
      children: [
        expect.objectContaining({
          heading_2: {
            rich_text: [
              { type: 'text', text: { content: 'Voxion Transcript' } },
            ],
          },
        }),
        expect.objectContaining({
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'Paragraph 1' } }],
          },
        }),
        expect.objectContaining({
          heading_2: {
            rich_text: [{ type: 'text', text: { content: 'Voxion Chunks' } }],
          },
        }),
        expect.objectContaining({
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: 'Chunk 1: 00:00:00 - 00:45:00' },
              },
            ],
          },
        }),
        expect.objectContaining({
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: 'Chunk 2: 00:45:00 - 01:01:01' },
              },
            ],
          },
        }),
      ],
    });
  });

  it('skips the chunks section when it already exists', async () => {
    const list = jest.fn().mockResolvedValue({
      results: [
        markerBlock('Voxion Transcript'),
        paragraphBlock('block-1', 'Paragraph 1'),
        markerBlock('Voxion Chunks', 'chunks-marker'),
        paragraphBlock('chunk-line-1', 'Chunk 1: 00:00:00 - 00:45:00'),
      ],
      has_more: false,
      next_cursor: null,
    });
    const append = jest.fn().mockResolvedValue({});
    MockedClient.mockImplementation(
      () =>
        ({
          blocks: { children: { append, list } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await service.appendTranscriptToPage({
      pageId: 'page-id',
      transcript: 'Paragraph 1',
      chunks: [{ index: 0, startSeconds: 0, endSeconds: 2700 }],
    });

    expect(append).not.toHaveBeenCalled();
  });

  it('appends missing chunk summary blocks when a previous retry stopped inside the chunks section', async () => {
    const list = jest.fn().mockResolvedValue({
      results: [
        markerBlock('Voxion Transcript'),
        paragraphBlock('block-1', 'Paragraph 1'),
        markerBlock('Voxion Chunks', 'chunks-marker'),
        paragraphBlock('chunk-line-1', 'Chunk 1: 00:00:00 - 00:45:00'),
      ],
      has_more: false,
      next_cursor: null,
    });
    const append = jest.fn().mockResolvedValue({});
    MockedClient.mockImplementation(
      () =>
        ({
          blocks: { children: { append, list } },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await service.appendTranscriptToPage({
      pageId: 'page-id',
      transcript: 'Paragraph 1',
      chunks: [
        { index: 0, startSeconds: 0, endSeconds: 2700 },
        { index: 1, startSeconds: 2700, endSeconds: 3600 },
      ],
    });

    expect(append).toHaveBeenCalledWith({
      block_id: 'page-id',
      children: [
        expect.objectContaining({
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: 'Chunk 2: 00:45:00 - 01:00:00' },
              },
            ],
          },
        }),
      ],
    });
  });

  it('resets stale appended content when it no longer matches the transcript', async () => {
    const list = jest.fn().mockResolvedValue({
      results: [
        markerBlock('Voxion Transcript'),
        paragraphBlock('stale-1', 'Old paragraph'),
        markerBlock('Voxion Chunks', 'stale-chunks-marker'),
        paragraphBlock('stale-2', 'Chunk 1: 00:00:00 - 00:30:00'),
      ],
      has_more: false,
      next_cursor: null,
    });
    const append = jest.fn().mockResolvedValue({});
    const deleteBlock = jest.fn().mockResolvedValue({});
    MockedClient.mockImplementation(
      () =>
        ({
          blocks: { children: { append, list }, delete: deleteBlock },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await service.appendTranscriptToPage({
      pageId: 'page-id',
      transcript: 'Fresh paragraph',
      chunks: [{ index: 0, startSeconds: 0, endSeconds: 2700 }],
    });

    expect(deleteBlock.mock.calls.map(([input]) => input.block_id)).toEqual([
      'stale-1',
      'stale-chunks-marker',
      'stale-2',
    ]);
    expect(append).toHaveBeenCalledWith({
      block_id: 'page-id',
      children: [
        expect.objectContaining({
          paragraph: {
            rich_text: [
              { type: 'text', text: { content: 'Fresh paragraph' } },
            ],
          },
        }),
        expect.objectContaining({
          heading_2: {
            rich_text: [{ type: 'text', text: { content: 'Voxion Chunks' } }],
          },
        }),
        expect.objectContaining({
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: 'Chunk 1: 00:00:00 - 00:45:00' },
              },
            ],
          },
        }),
      ],
    });
  });

  it('includes the Recording Id property when a recording id is provided', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      properties: {
        Name: { type: 'title' },
      },
    });
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn().mockResolvedValue({
      id: 'page-id',
      url: 'https://notion.so/page-id',
    });
    MockedClient.mockImplementation(
      () =>
        ({
          pages: { create },
          dataSources: { retrieve, update },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await service.createRecordingPageMetadata({
      ...input,
      recordingId: 'recording-uuid',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          'Recording Id': {
            rich_text: [{ text: { content: 'recording-uuid' } }],
          },
        }),
      }),
    );
  });

  it('retries page creation without Recording Id when the property is missing', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      properties: {
        Name: { type: 'title' },
      },
    });
    const update = jest.fn().mockResolvedValue({});
    const validationError = Object.assign(new Error('property not found'), {
      status: 400,
      code: 'validation_error',
    });
    const create = jest
      .fn()
      .mockRejectedValueOnce(validationError)
      .mockResolvedValue({ id: 'page-id', url: 'https://notion.so/page-id' });
    MockedClient.mockImplementation(
      () =>
        ({
          pages: { create },
          dataSources: { retrieve, update },
        }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    const result = await service.createRecordingPageMetadata({
      ...input,
      recordingId: 'recording-uuid',
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].properties).not.toHaveProperty(
      'Recording Id',
    );
    expect(result).toEqual({
      pageId: 'page-id',
      url: 'https://notion.so/page-id',
    });
  });

  it('finds an existing recording page through the data source query', async () => {
    const query = jest.fn().mockResolvedValue({
      results: [
        {
          object: 'page',
          id: 'existing-page-id',
          url: 'https://notion.so/existing-page-id',
        },
      ],
    });
    MockedClient.mockImplementation(
      () => ({ dataSources: { query } }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    const result = await service.findRecordingPage('recording-uuid');

    expect(query).toHaveBeenCalledWith({
      data_source_id: 'data-source-id',
      filter: {
        property: 'Recording Id',
        rich_text: { equals: 'recording-uuid' },
      },
      page_size: 1,
    });
    expect(result).toEqual({
      pageId: 'existing-page-id',
      url: 'https://notion.so/existing-page-id',
    });
  });

  it('returns null when the recording page lookup fails', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('unknown property'), { status: 400 }),
      );
    MockedClient.mockImplementation(
      () => ({ dataSources: { query } }) as unknown as Client,
    );
    const service = new NotionService({
      notionToken: 'notion-token',
      notionTableDataSourceId: 'data-source-id',
      notionVersion: '2026-03-11',
    } as AppConfigService);

    await expect(service.findRecordingPage('recording-uuid')).resolves.toBeNull();
  });

  it('is exported from NotionModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotionModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({
        notionToken: undefined,
        notionTableDataSourceId: undefined,
        notionVersion: '2026-03-11',
      })
      .compile();

    expect(moduleRef.get(NotionService)).toBeInstanceOf(NotionService);

    await moduleRef.close();
  });
});
