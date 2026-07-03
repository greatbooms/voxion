import { Injectable, PreconditionFailedException } from '@nestjs/common';
import { Client } from '@notionhq/client';
import type {
  AppendBlockChildrenParameters,
  CreatePageParameters,
  CreatePageResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { AppConfigService } from '../config/app-config.service';
import {
  batchBlocks,
  splitTranscriptIntoParagraphBlocks,
} from './notion-blocks';

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

@Injectable()
export class NotionService {
  constructor(private readonly config: AppConfigService) {}

  async createRecordingPage(
    input: CreateRecordingPageInput,
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

    for (const batch of batchBlocks(
      splitTranscriptIntoParagraphBlocks(input.transcript),
      100,
    )) {
      await notion.blocks.children.append({
        block_id: page.id,
        children: batch,
      } as AppendBlockChildrenParameters);
    }

    return { pageId: page.id, url: getPageUrl(page) };
  }

  private buildCreatePageParameters(
    input: CreateRecordingPageInput,
    dataSourceId: string,
    uploadedAt: string,
  ): CreatePageParameters {
    return {
      parent: { data_source_id: dataSourceId },
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
    } as unknown as CreatePageParameters;
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function getPageUrl(page: CreatePageResponse): string {
  return 'url' in page && typeof page.url === 'string' ? page.url : '';
}
