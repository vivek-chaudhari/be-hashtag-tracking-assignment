import { describe, it, expect, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import { MediaIngestionService, sanitizeErrorMessage } from '../ingestion.service.js';
import type { MediaFetcher } from '../../instagram/media.fetcher.js';
import type { Hashtag, Media, SyncRun } from '../../../db/schema.js';
import type { MetaMediaItem } from '../../../common/interfaces/instagram.interface.js';
import { MetaApiError } from '../../instagram/instagram.errors.js';

// ----------------------------------------------------------------
// Fixtures & Helpers
// ----------------------------------------------------------------

const FAKE_HASHTAG: Hashtag = {
  id: 'hashtag-uuid-1',
  name: 'matcha',
  metaHashtagId: '17841583865247128',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

const FAKE_SYNC_RUN: SyncRun = {
  id: 'sync-run-uuid-1',
  hashtagId: FAKE_HASHTAG.id,
  syncType: 'TOP',
  status: 'RUNNING',
  itemsFetched: 0,
  itemsCreated: 0,
  itemsSkipped: 0,
  startedAt: new Date('2024-01-01T00:00:00Z'),
  completedAt: null,
  error: null,
};

/** Generates `count` test MetaMediaItems. */
function generateMetaItems(count: number, start = 0): MetaMediaItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `meta-media-${start + i}`,
    media_type: 'IMAGE',
    caption: `Sample caption ${start + i}`,
    permalink: `https://instagram.com/p/post-${start + i}`,
    media_url: `https://scontent.cdninstagram.com/v/img-${start + i}.jpg`,
    timestamp: '2024-01-01T12:00:00.000Z',
    like_count: 10 + i,
    comments_count: 2 + i,
  }));
}

/** Generates mock Media rows returned by .returning(). */
function generateMediaRows(metaItems: MetaMediaItem[], hashtagId = FAKE_HASHTAG.id): Media[] {
  return metaItems.map((item, idx) => ({
    id: `media-db-uuid-${idx}`,
    hashtagId,
    metaMediaId: item.id,
    mediaType: item.media_type ?? 'IMAGE',
    caption: item.caption ?? null,
    mediaUrl: item.media_url ?? null,
    permalink: item.permalink ?? null,
    publishedAt: item.timestamp ? new Date(item.timestamp) : null,
    likeCount: item.like_count ?? null,
    commentsCount: item.comments_count ?? null,
    storageKey: null,
    storageStatus: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

/** Creates a mock MediaFetcher. */
function makeMediaFetcher(overrides: Record<string, unknown> = {}): MediaFetcher {
  return {
    fetchMedia: jest.fn().mockResolvedValue({
      items: generateMetaItems(10),
      pagesFetched: 1,
    } as never),
    ...overrides,
  } as unknown as MediaFetcher;
}

/** Creates a mock Drizzle database with configurable chain methods. */
function makeDbMock(
  opts: {
    hashtagResult?: Hashtag[];
    syncRunResult?: SyncRun[];
    mediaInsertResult?: Media[];
    insertMediaThrow?: unknown;
  } = {},
) {
  const selectWhereLimit = jest
    .fn()
    .mockResolvedValue((opts.hashtagResult ?? [FAKE_HASHTAG]) as never);
  const syncRunReturning = jest
    .fn()
    .mockResolvedValue((opts.syncRunResult ?? [FAKE_SYNC_RUN]) as never);
  const mediaReturning = opts.insertMediaThrow
    ? jest.fn().mockRejectedValue(opts.insertMediaThrow as never)
    : jest
        .fn()
        .mockResolvedValue(
          (opts.mediaInsertResult ?? generateMediaRows(generateMetaItems(10))) as never,
        );
  const updateSetWhere = jest.fn().mockResolvedValue([] as never);

  const db = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: selectWhereLimit,
        }),
      }),
    }),
    insert: jest.fn().mockImplementation(() => {
      return {
        values: jest.fn().mockReturnValue({
          returning: syncRunReturning,
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: mediaReturning,
          }),
        }),
      };
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: updateSetWhere,
      }),
    }),
  };

  return {
    db,
    mocks: {
      selectWhereLimit,
      syncRunReturning,
      mediaReturning,
      updateSetWhere,
    },
  };
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('sanitizeErrorMessage', () => {
  it('redacts access_token parameters from plain text messages', () => {
    const raw = 'Request failed with access_token=EAABwz12345 secret and more text';
    const sanitized = sanitizeErrorMessage(raw);

    expect(sanitized).not.toContain('EAABwz12345');
    expect(sanitized).toBe('Request failed with access_token=[REDACTED] secret and more text');
  });

  it('redacts access_token from full URLs in error messages', () => {
    const raw =
      'Failed to fetch https://graph.facebook.com/v24.0/media?access_token=secretToken123&limit=25';
    const sanitized = sanitizeErrorMessage(raw);

    expect(sanitized).not.toContain('secretToken123');
    expect(sanitized).toContain('access_token=%5BREDACTED%5D');
  });
});

describe('MediaIngestionService.syncMedia', () => {
  let fetcher: MediaFetcher;

  beforeEach(() => {
    fetcher = makeMediaFetcher();
  });

  // ── 1. Successful TOP sync ─────────────────────────────────────

  it('successfully executes a TOP sync and calls MediaFetcher with "top"', async () => {
    const items = generateMetaItems(5);
    const { db } = makeDbMock({
      mediaInsertResult: generateMediaRows(items),
    });
    fetcher = makeMediaFetcher({
      fetchMedia: jest.fn().mockResolvedValue({ items, pagesFetched: 1 } as never),
    });

    const service = new MediaIngestionService(fetcher, db as any);
    const result = await service.syncMedia(FAKE_HASHTAG.id, 'TOP');

    expect(fetcher.fetchMedia).toHaveBeenCalledWith(FAKE_HASHTAG.metaHashtagId, 'top');
    expect(result).toMatchObject({
      syncRunId: FAKE_SYNC_RUN.id,
      hashtagId: FAKE_HASHTAG.id,
      syncType: 'TOP',
      status: 'COMPLETED',
      itemsFetched: 5,
      itemsCreated: 5,
      itemsSkipped: 0,
    });
  });

  // ── 2. Successful RECENT sync ──────────────────────────────────

  it('successfully executes a RECENT sync and calls MediaFetcher with "recent"', async () => {
    const items = generateMetaItems(5);
    const { db } = makeDbMock({
      mediaInsertResult: generateMediaRows(items),
    });
    fetcher = makeMediaFetcher({
      fetchMedia: jest.fn().mockResolvedValue({ items, pagesFetched: 1 } as never),
    });

    const service = new MediaIngestionService(fetcher, db as any);
    const result = await service.syncMedia(FAKE_HASHTAG.id, 'RECENT');

    expect(fetcher.fetchMedia).toHaveBeenCalledWith(FAKE_HASHTAG.metaHashtagId, 'recent');
    expect(result).toMatchObject({
      syncRunId: FAKE_SYNC_RUN.id,
      hashtagId: FAKE_HASHTAG.id,
      syncType: 'RECENT',
      status: 'COMPLETED',
      itemsFetched: 5,
      itemsCreated: 5,
      itemsSkipped: 0,
    });
  });

  // ── 3. 10 media fetched → 10 created ───────────────────────────

  it('creates 10 records when 10 new media items are fetched and performs batch insert in single query', async () => {
    const items = generateMetaItems(10);
    const { db } = makeDbMock({
      mediaInsertResult: generateMediaRows(items),
    });
    fetcher = makeMediaFetcher({
      fetchMedia: jest.fn().mockResolvedValue({ items, pagesFetched: 1 } as never),
    });

    const service = new MediaIngestionService(fetcher, db as any);
    const result = await service.syncMedia(FAKE_HASHTAG.id, 'TOP');

    expect(result.itemsFetched).toBe(10);
    expect(result.itemsCreated).toBe(10);
    expect(result.itemsSkipped).toBe(0);

    // 1 insert for sync_run + 1 batch insert for media = exactly 2 insert calls total (no per-row queries)
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  // ── 4. Existing media → skipped ────────────────────────────────

  it('skips existing media items when ON CONFLICT DO NOTHING returns fewer rows', async () => {
    const items = generateMetaItems(10);
    // 6 were already in the DB, so only 4 are newly inserted
    const insertedRows = generateMediaRows(items.slice(0, 4));

    const { db } = makeDbMock({
      mediaInsertResult: insertedRows,
    });
    fetcher = makeMediaFetcher({
      fetchMedia: jest.fn().mockResolvedValue({ items, pagesFetched: 1 } as never),
    });

    const service = new MediaIngestionService(fetcher, db as any);
    const result = await service.syncMedia(FAKE_HASHTAG.id, 'TOP');

    expect(result.itemsFetched).toBe(10);
    expect(result.itemsCreated).toBe(4);
    expect(result.itemsSkipped).toBe(6);
  });

  // ── 5. In-batch duplicate Meta media IDs ───────────────────────

  it('deduplicates identical media IDs in the same fetched batch without errors', async () => {
    const item1 = generateMetaItems(1, 0)[0]!;
    // Batch contains the same item ID twice
    const itemsWithDuplicates = [item1, item1];
    const insertedRows = generateMediaRows([item1]);

    const { db } = makeDbMock({
      mediaInsertResult: insertedRows,
    });
    fetcher = makeMediaFetcher({
      fetchMedia: jest
        .fn()
        .mockResolvedValue({ items: itemsWithDuplicates, pagesFetched: 1 } as never),
    });

    const service = new MediaIngestionService(fetcher, db as any);
    const result = await service.syncMedia(FAKE_HASHTAG.id, 'TOP');

    expect(result.itemsFetched).toBe(2);
    expect(result.itemsCreated).toBe(1);
    expect(result.itemsSkipped).toBe(1);
  });

  // ── 6. 500 media fetched → handles all 500 in single batch ─────

  it('handles 500 fetched items in a single batch insertion', async () => {
    const items500 = generateMetaItems(500);
    const insertedRows = generateMediaRows(items500);

    const { db } = makeDbMock({
      mediaInsertResult: insertedRows,
    });
    fetcher = makeMediaFetcher({
      fetchMedia: jest.fn().mockResolvedValue({ items: items500, pagesFetched: 20 } as never),
    });

    const service = new MediaIngestionService(fetcher, db as any);
    const result = await service.syncMedia(FAKE_HASHTAG.id, 'TOP');

    expect(result.itemsFetched).toBe(500);
    expect(result.itemsCreated).toBe(500);
    expect(result.itemsSkipped).toBe(0);
    expect(result.status).toBe('COMPLETED');
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  // ── 7. Missing hashtag → throws error ──────────────────────────

  it('throws an error if the hashtag does not exist and does not create sync_run', async () => {
    const { db } = makeDbMock({
      hashtagResult: [], // Not found
    });

    const service = new MediaIngestionService(fetcher, db as any);

    await expect(service.syncMedia('non-existent-id', 'TOP')).rejects.toThrow(
      'Hashtag with ID "non-existent-id" not found.',
    );
    expect(fetcher.fetchMedia).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  // ── 8. MediaFetcher failure → sync_runs marked FAILED & sanitized

  it('marks sync_runs as FAILED, sanitizes error, and rethrows when MediaFetcher fails', async () => {
    const apiError = new MetaApiError(
      'Meta rate limit exceeded on url https://meta.com?access_token=secret_token_abc',
      429,
    );
    fetcher = makeMediaFetcher({
      fetchMedia: jest.fn().mockRejectedValue(apiError as never),
    });

    const { db } = makeDbMock();

    const service = new MediaIngestionService(fetcher, db as any);

    await expect(service.syncMedia(FAKE_HASHTAG.id, 'TOP')).rejects.toThrow(MetaApiError);

    // Verify sync_runs update was called with FAILED status and sanitized message
    expect(db.update).toHaveBeenCalled();
    const updateSetArg = (db.update as any)().set.mock.calls[0]?.[0];
    expect(updateSetArg).toMatchObject({
      status: 'FAILED',
      error: expect.not.stringContaining('secret_token_abc'),
    });
  });

  // ── 9. Successful run → sync_runs marked COMPLETED ────────────

  it('marks sync_runs as COMPLETED with timestamps and item counts on success', async () => {
    const items = generateMetaItems(8);
    const { db } = makeDbMock({
      mediaInsertResult: generateMediaRows(items),
    });
    fetcher = makeMediaFetcher({
      fetchMedia: jest.fn().mockResolvedValue({ items, pagesFetched: 1 } as never),
    });

    const service = new MediaIngestionService(fetcher, db as any);
    await service.syncMedia(FAKE_HASHTAG.id, 'TOP');

    expect(db.update).toHaveBeenCalled();
    const updateSetArg = (db.update as any)().set.mock.calls[0]?.[0];
    expect(updateSetArg).toMatchObject({
      status: 'COMPLETED',
      itemsFetched: 8,
      itemsCreated: 8,
      itemsSkipped: 0,
      completedAt: expect.any(Date),
    });
  });

  // ── 10. Empty fetch results handled gracefully ─────────────────

  it('handles 0 fetched items gracefully without attempting batch insert', async () => {
    const { db } = makeDbMock();
    fetcher = makeMediaFetcher({
      fetchMedia: jest.fn().mockResolvedValue({ items: [], pagesFetched: 1 } as never),
    });

    const service = new MediaIngestionService(fetcher, db as any);
    const result = await service.syncMedia(FAKE_HASHTAG.id, 'TOP');

    expect(result).toMatchObject({
      itemsFetched: 0,
      itemsCreated: 0,
      itemsSkipped: 0,
      status: 'COMPLETED',
    });
  });

  // ── 11. SQS UPLOAD_MEDIA enqueueing ───────────────────────────

  it('dispatches UPLOAD_MEDIA messages for newly inserted media records only', async () => {
    const items = generateMetaItems(4);
    const createdRows = generateMediaRows(items.slice(0, 2)); // Only 2 newly created
    const { db } = makeDbMock({
      mediaInsertResult: createdRows,
    });
    fetcher = makeMediaFetcher({
      fetchMedia: jest.fn().mockResolvedValue({ items, pagesFetched: 1 } as never),
    });

    const sqsMock = {
      sendMessage: jest.fn().mockResolvedValue('msg-id-1' as never),
    } as any;

    process.env.MEDIA_UPLOAD_QUEUE_URL =
      'https://sqs.ap-south-1.amazonaws.com/123456789012/matcha-media-upload';

    const service = new MediaIngestionService(fetcher, db as any, sqsMock);
    const result = await service.syncMedia(FAKE_HASHTAG.id, 'RECENT');

    expect(result.itemsCreated).toBe(2);
    expect(result.itemsSkipped).toBe(2);
    expect(sqsMock.sendMessage).toHaveBeenCalledTimes(2);
    expect(sqsMock.sendMessage).toHaveBeenCalledWith(
      { type: 'UPLOAD_MEDIA', mediaId: 'media-db-uuid-0' },
      'https://sqs.ap-south-1.amazonaws.com/123456789012/matcha-media-upload',
    );
    expect(sqsMock.sendMessage).toHaveBeenCalledWith(
      { type: 'UPLOAD_MEDIA', mediaId: 'media-db-uuid-1' },
      'https://sqs.ap-south-1.amazonaws.com/123456789012/matcha-media-upload',
    );
  });
});
