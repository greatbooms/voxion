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

const TRANSCRIPT_MARKER_TEXT = 'Voxion Transcript';

type AppendChildBlock = AppendBlockChildrenParameters['children'][number];

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
    const appendState = await this.getTranscriptAppendState(
      notion,
      input.pageId,
    );
    const missingBlocks = transcriptBlocks.slice(
      appendState.appendedParagraphCount,
    );
    const blocksToAppend: AppendChildBlock[] = appendState.markerFound
      ? missingBlocks
      : [createTranscriptMarkerBlock(), ...missingBlocks];

    for (const batch of batchBlocks(blocksToAppend, 100)) {
      await notion.blocks.children.append({
        block_id: input.pageId,
        children: batch,
      });
    }
  }

  private buildCreatePageParameters(
    input: CreateRecordingPageMetadataInput,
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
    };
  }

  private async getTranscriptAppendState(
    notion: Client,
    pageId: string,
  ): Promise<{ markerFound: boolean; appendedParagraphCount: number }> {
    let startCursor: string | undefined;
    let markerFound = false;
    let appendedParagraphCount = 0;

    do {
      const request: ListBlockChildrenParameters = {
        block_id: pageId,
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      };
      const response = (await notion.blocks.children.list(
        request,
      )) as ListBlockChildrenResponse;

      for (const block of response.results) {
        if (!markerFound) {
          markerFound = isTranscriptMarkerBlock(block);
          continue;
        }

        if (isParagraphBlock(block)) {
          appendedParagraphCount += 1;
        }
      }

      startCursor =
        response.has_more && response.next_cursor
          ? response.next_cursor
          : undefined;
    } while (startCursor);

    return { markerFound, appendedParagraphCount };
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

function createTranscriptMarkerBlock(): AppendChildBlock {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [
        {
          type: 'text',
          text: { content: TRANSCRIPT_MARKER_TEXT },
        },
      ],
    },
  };
}

function isTranscriptMarkerBlock(
  block: ListBlockChildrenResponse['results'][number],
): boolean {
  if (!('type' in block) || block.type !== 'heading_2') {
    return false;
  }

  return block.heading_2.rich_text.some((richText) => {
    if (
      'plain_text' in richText &&
      richText.plain_text === TRANSCRIPT_MARKER_TEXT
    ) {
      return true;
    }

    return (
      richText.type === 'text' &&
      'text' in richText &&
      richText.text.content === TRANSCRIPT_MARKER_TEXT
    );
  });
}
