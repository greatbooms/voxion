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
const CHUNKS_MARKER_TEXT = 'Voxion Chunks';
const RECORDING_ID_PROPERTY = 'Recording Id';
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 529]);
const MAX_NOTION_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

type AppendChildBlock = AppendBlockChildrenParameters['children'][number];
type ChildBlock = ListBlockChildrenResponse['results'][number];

export type TranscriptChunkSummary = {
  index: number;
  startSeconds: number;
  endSeconds: number;
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
  recordingId?: string;
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
  chunks?: TranscriptChunkSummary[];
};

type PageTranscriptState = {
  markerFound: boolean;
  chunksMarkerFound: boolean;
  transcriptTexts: string[];
  blockIdsAfterMarker: string[];
};

@Injectable()
export class NotionService {
  private sleepFn: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

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

    const notion = this.createClient(token);
    const uploadedAt = new Date().toISOString();
    const parameters = this.buildCreatePageParameters(
      input,
      dataSourceId,
      uploadedAt,
    );
    let page: CreatePageResponse;

    try {
      page = await this.callNotion(() => notion.pages.create(parameters));
    } catch (error) {
      // The Recording Id property enables duplicate-page detection but is
      // optional in the user's data source schema; fall back without it.
      if (!input.recordingId || !isValidationError(error)) {
        throw error;
      }

      const fallback = this.buildCreatePageParameters(
        { ...input, recordingId: undefined },
        dataSourceId,
        uploadedAt,
      );
      page = await this.callNotion(() => notion.pages.create(fallback));
    }

    return { pageId: page.id, url: getPageUrl(page) };
  }

  async findRecordingPage(
    recordingId: string,
  ): Promise<CreateRecordingPageResult | null> {
    const token = this.config.notionToken;
    const dataSourceId = this.config.notionDataSourceId;

    if (!token || !dataSourceId) {
      return null;
    }

    const notion = this.createClient(token);

    try {
      const response = await this.callNotion(() =>
        notion.dataSources.query({
          data_source_id: dataSourceId,
          filter: {
            property: RECORDING_ID_PROPERTY,
            rich_text: { equals: recordingId },
          },
          page_size: 1,
        }),
      );
      const page = response.results.find(
        (result) => result.object === 'page',
      );

      return page ? { pageId: page.id, url: getPageUrl(page) } : null;
    } catch {
      // The data source may not define the Recording Id property; duplicate
      // detection then degrades to page creation.
      return null;
    }
  }

  async appendTranscriptToPage(
    input: AppendTranscriptToPageInput,
  ): Promise<void> {
    const token = this.config.notionToken;

    if (!token) {
      throw new PreconditionFailedException(
        'Notion environment is not configured.',
      );
    }

    const notion = this.createClient(token);
    const transcriptBlocks = splitTranscriptIntoParagraphBlocks(
      input.transcript,
    );
    const state = await this.getPageTranscriptState(notion, input.pageId);
    const blocksToAppend = this.planBlocksToAppend(
      transcriptBlocks,
      input.chunks,
      state,
    );

    if (blocksToAppend.needsReset) {
      await this.deleteBlocks(notion, state.blockIdsAfterMarker);
    }

    for (const batch of batchBlocks(blocksToAppend.blocks, 100)) {
      await this.callNotion(() =>
        notion.blocks.children.append({
          block_id: input.pageId,
          children: batch,
        }),
      );
    }
  }

  private planBlocksToAppend(
    transcriptBlocks: ReturnType<typeof splitTranscriptIntoParagraphBlocks>,
    chunks: TranscriptChunkSummary[] | undefined,
    state: PageTranscriptState,
  ): { blocks: AppendChildBlock[]; needsReset: boolean } {
    const chunkBlocks = chunks?.length
      ? [createChunksMarkerBlock(), ...createChunkSummaryBlocks(chunks)]
      : [];

    if (!state.markerFound) {
      return {
        blocks: [
          createTranscriptMarkerBlock(),
          ...transcriptBlocks,
          ...chunkBlocks,
        ],
        needsReset: false,
      };
    }

    const expectedTexts = transcriptBlocks.map(
      (block) => block.paragraph.rich_text[0].text.content,
    );
    const appendedMatchesExpected =
      state.transcriptTexts.length <= expectedTexts.length &&
      state.transcriptTexts.every(
        (text, index) => text === expectedTexts[index],
      );
    const transcriptComplete =
      state.transcriptTexts.length === expectedTexts.length;

    // A chunks marker must only ever exist after a fully appended
    // transcript; anything else is stale content from an earlier attempt
    // whose transcript has since changed.
    const consistent =
      appendedMatchesExpected &&
      (!state.chunksMarkerFound || transcriptComplete);

    if (!consistent) {
      return {
        blocks: [...transcriptBlocks, ...chunkBlocks],
        needsReset: true,
      };
    }

    const missingTranscriptBlocks = transcriptBlocks.slice(
      state.transcriptTexts.length,
    );
    const missingChunkBlocks = state.chunksMarkerFound ? [] : chunkBlocks;

    return {
      blocks: [...missingTranscriptBlocks, ...missingChunkBlocks],
      needsReset: false,
    };
  }

  private createClient(token: string): Client {
    return new Client({
      auth: token,
      notionVersion: this.config.notionVersion,
    });
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
        ...(input.recordingId
          ? {
              [RECORDING_ID_PROPERTY]: {
                rich_text: [{ text: { content: input.recordingId } }],
              },
            }
          : {}),
      },
    };
  }

  private async getPageTranscriptState(
    notion: Client,
    pageId: string,
  ): Promise<PageTranscriptState> {
    let startCursor: string | undefined;
    const state: PageTranscriptState = {
      markerFound: false,
      chunksMarkerFound: false,
      transcriptTexts: [],
      blockIdsAfterMarker: [],
    };

    do {
      const request: ListBlockChildrenParameters = {
        block_id: pageId,
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      };
      const response = await this.callNotion(() =>
        notion.blocks.children.list(request),
      );

      for (const block of response.results) {
        if (!state.markerFound) {
          state.markerFound = isMarkerBlock(block, TRANSCRIPT_MARKER_TEXT);
          continue;
        }

        state.blockIdsAfterMarker.push(block.id);

        if (isMarkerBlock(block, CHUNKS_MARKER_TEXT)) {
          state.chunksMarkerFound = true;
          continue;
        }

        if (!state.chunksMarkerFound && isParagraphBlock(block)) {
          state.transcriptTexts.push(paragraphText(block));
        }
      }

      startCursor =
        response.has_more && response.next_cursor
          ? response.next_cursor
          : undefined;
    } while (startCursor);

    return state;
  }

  private async deleteBlocks(
    notion: Client,
    blockIds: string[],
  ): Promise<void> {
    for (const blockId of blockIds) {
      await this.callNotion(() => notion.blocks.delete({ block_id: blockId }));
    }
  }

  private async callNotion<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;

    for (;;) {
      try {
        return await operation();
      } catch (error) {
        attempt += 1;

        if (attempt >= MAX_NOTION_ATTEMPTS || !isRetryableError(error)) {
          throw error;
        }

        await this.sleepFn(retryDelayMs(error, attempt));
      }
    }
  }
}

function retryDelayMs(error: unknown, attempt: number): number {
  const retryAfter = retryAfterMs(error);

  if (retryAfter !== undefined) {
    return Math.min(retryAfter, MAX_RETRY_DELAY_MS);
  }

  return Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

function retryAfterMs(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const headers = (error as { headers?: unknown }).headers;
  let raw: unknown;

  if (headers instanceof Headers) {
    raw = headers.get('retry-after');
  } else if (typeof headers === 'object' && headers !== null) {
    raw = (headers as Record<string, unknown>)['retry-after'];
  }

  const seconds = Number(raw);

  return raw != null && Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1_000
    : undefined;
}

function isRetryableError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    RETRYABLE_STATUS_CODES.has(error.status)
  );
}

function isValidationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  const status = (error as { status?: unknown }).status;

  return code === 'validation_error' || status === 400;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function getPageUrl(page: { id: string; [key: string]: unknown }): string {
  return 'url' in page && typeof page.url === 'string' ? page.url : '';
}

function isParagraphBlock(
  block: ChildBlock,
): block is ChildBlock & {
  type: 'paragraph';
  paragraph: { rich_text: Array<Record<string, unknown>> };
} {
  return 'type' in block && block.type === 'paragraph';
}

function paragraphText(block: {
  paragraph: { rich_text: Array<Record<string, unknown>> };
}): string {
  return block.paragraph.rich_text
    .map((richText) => {
      if (typeof richText.plain_text === 'string') {
        return richText.plain_text;
      }

      const text = richText.text;

      return typeof text === 'object' &&
        text !== null &&
        typeof (text as { content?: unknown }).content === 'string'
        ? (text as { content: string }).content
        : '';
    })
    .join('');
}

function createTranscriptMarkerBlock(): AppendChildBlock {
  return createMarkerBlock(TRANSCRIPT_MARKER_TEXT);
}

function createChunksMarkerBlock(): AppendChildBlock {
  return createMarkerBlock(CHUNKS_MARKER_TEXT);
}

function createMarkerBlock(markerText: string): AppendChildBlock {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [
        {
          type: 'text',
          text: { content: markerText },
        },
      ],
    },
  };
}

function createChunkSummaryBlocks(
  chunks: TranscriptChunkSummary[],
): AppendChildBlock[] {
  return [...chunks]
    .sort((left, right) => left.index - right.index)
    .map((chunk) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: `Chunk ${chunk.index + 1}: ${formatTimestamp(
                chunk.startSeconds,
              )} - ${formatTimestamp(chunk.endSeconds)}`,
            },
          },
        ],
      },
    }));
}

function formatTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(clamped / 3_600);
  const minutes = Math.floor((clamped % 3_600) / 60);
  const seconds = clamped % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function isMarkerBlock(block: ChildBlock, markerText: string): boolean {
  if (!('type' in block) || block.type !== 'heading_2') {
    return false;
  }

  return block.heading_2.rich_text.some((richText) => {
    if ('plain_text' in richText && richText.plain_text === markerText) {
      return true;
    }

    return (
      richText.type === 'text' &&
      'text' in richText &&
      richText.text.content === markerText
    );
  });
}
