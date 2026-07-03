import { Injectable, PreconditionFailedException } from '@nestjs/common';
import { Client } from '@notionhq/client';
import type {
  AppendBlockChildrenParameters,
  CreatePageParameters,
  CreatePageResponse,
  ListBlockChildrenParameters,
  ListBlockChildrenResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { AppConfigService } from '../config/app-config.service';
import {
  batchBlocks,
  splitTranscriptIntoParagraphBlocks,
} from './notion-blocks';

type DataSourceParent = {
  data_source_id: string;
};

export type CreateRecordingPageInput = {
  title: string;
  status: string;
  language: string;
  model: string;
  durationSeconds?: number;
  originalFilename: string;
  fileSizeMb: number;
  chunkCount: number;
  transcript: string;
  recordedAt?: Date | string;
};

export type CreateRecordingPageResult = {
  pageId: string;
  url: string;
};

export type CreateRecordingPageMetadataInput = Omit<
  CreateRecordingPageInput,
  'transcript'
>;

export type AppendTranscriptToPageInput = {
  pageId: string;
  transcript: string;
};

@Injectable()
export class NotionService {
  constructor(private readonly config: AppConfigService) {}

  async createRecordingPage(
    input: CreateRecordingPageInput,
  ): Promise<CreateRecordingPageResult> {
    const page = await this.createRecordingPageMetadata(input);
    await this.appendTranscriptToPage({
      pageId: page.pageId,
      transcript: input.transcript,
    });

    return page;
  }

  async createRecordingPageMetadata(
    input: CreateRecordingPageMetadataInput,
  ): Promise<CreateRecordingPageResult> {
    const token = this.config.notionToken;
    const dataSourceId = this.config.notionDataSourceId;

    if (!token || !dataSourceId) {
      throw new PreconditionFailedException(
        'Notion environment is not configured.',
      );
    }

    const notion = new Client({
      auth: token,
      notionVersion: this.config.notionVersion,
    });
    const uploadedAt = new Date().toISOString();
    const page = await notion.pages.create(
      this.buildCreatePageParameters(input, dataSourceId, uploadedAt),
    );

    return { pageId: page.id, url: getPageUrl(page) };
  }

  async appendTranscriptToPage(input: AppendTranscriptToPageInput): Promise<void> {
    const token = this.config.notionToken;

    if (!token) {
      throw new PreconditionFailedException(
        'Notion environment is not configured.',
      );
    }

    const notion = new Client({
      auth: token,
      notionVersion: this.config.notionVersion,
    });
    const transcriptBlocks = splitTranscriptIntoParagraphBlocks(input.transcript);
    const existingParagraphCount = await this.countExistingParagraphChildren(
      notion,
      input.pageId,
    );
    const missingBlocks = transcriptBlocks.slice(existingParagraphCount);

    for (const batch of batchBlocks(missingBlocks, 100)) {
      await notion.blocks.children.append({
        block_id: input.pageId,
        children: batch as AppendBlockChildrenParameters['children'],
      });
    }
  }

  private buildCreatePageParameters(
    input: CreateRecordingPageMetadataInput,
    dataSourceId: string,
    uploadedAt: string,
  ): CreatePageParameters {
    const parent: DataSourceParent = { data_source_id: dataSourceId };

    return {
      // The Notion data-source API supports data_source_id, but the installed SDK types lag.
      parent: parent as unknown as CreatePageParameters['parent'],
      properties: {
        Name: {
          title: [{ text: { content: input.title } }],
        },
        Status: {
          select: { name: input.status },
        },
        Language: {
          rich_text: [{ text: { content: input.language } }],
        },
        Model: {
          rich_text: [{ text: { content: input.model } }],
        },
        'Duration Seconds': {
          number: input.durationSeconds ?? null,
        },
        'Original Filename': {
          rich_text: [{ text: { content: input.originalFilename } }],
        },
        'File Size MB': {
          number: input.fileSizeMb,
        },
        'Chunk Count': {
          number: input.chunkCount,
        },
        'Recorded At': {
          date: input.recordedAt
            ? { start: toIsoString(input.recordedAt) }
            : null,
        },
        'Uploaded At': {
          date: { start: uploadedAt },
        },
      },
    };
  }

  private async countExistingParagraphChildren(
    notion: Client,
    pageId: string,
  ): Promise<number> {
    let startCursor: string | undefined;
    let paragraphCount = 0;

    do {
      const request: ListBlockChildrenParameters = {
        block_id: pageId,
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      };
      const response = (await notion.blocks.children.list(
        request,
      )) as ListBlockChildrenResponse;

      paragraphCount += response.results.filter(isParagraphBlock).length;
      startCursor =
        response.has_more && response.next_cursor
          ? response.next_cursor
          : undefined;
    } while (startCursor);

    return paragraphCount;
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function getPageUrl(page: CreatePageResponse): string {
  return 'url' in page && typeof page.url === 'string' ? page.url : '';
}

function isParagraphBlock(block: ListBlockChildrenResponse['results'][number]) {
  return 'type' in block && block.type === 'paragraph';
}
