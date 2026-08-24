import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { MediaFetcher, MediaFeedType } from '../instagram/media.fetcher.js';
import type { MetaMediaItem } from '../instagram/instagram.types.js';
import type { SqsService } from '../../services/queue/sqs.service.js';
import type { Hashtag, NewMedia, SyncRun, SyncType, SyncStatus } from '../../db/schema.js';
import { hashtags, media, syncRuns } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import { createLogger } from '../../common/logger.js';
import { configService } from '../../services/config.service.js';

const logger = createLogger('MediaIngestionService');

/**
 * Result returned after a media sync execution.
 */
export interface SyncResult {
  syncRunId: string;
  hashtagId: string;
  syncType: SyncType;
  status: SyncStatus;
  itemsFetched: number;
  itemsCreated: number;
  itemsSkipped: number;
  error?: string | null;
}

/**
 * Sanitizes an error message by stripping access tokens or sensitive URL parameters.
 *
 * @param message - The raw error string.
 * @returns The sanitized error message safe for logging and storage.
 */
export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/access_token=[^&\s"']+/gi, 'access_token=[REDACTED]')
    .replace(/https?:\/\/[^\s"']+/gi, (url) => {
      try {
        const parsed = new URL(url);
        if (parsed.searchParams.has('access_token')) {
          parsed.searchParams.set('access_token', '[REDACTED]');
          return parsed.toString();
        }
        return url;
      } catch {
        return '[URL]';
      }
    });
}

/**
 * Service responsible for orchestrating Instagram media ingestion into PostgreSQL
 * and dispatching S3 asset upload jobs to SQS.
 *
 * Workflow:
 * 1. Validates the hashtag exists in the local database by UUID.
 * 2. Records a `sync_runs` entry with status `RUNNING`.
 * 3. Fetches media pages using `MediaFetcher` (up to 500 items) for the specified feed type (TOP / RECENT).
 * 4. Ingests media items in a single batch into the `media` table with `ON CONFLICT (meta_media_id) DO NOTHING`.
 * 5. Accurately computes `itemsFetched`, `itemsCreated`, and `itemsSkipped`.
 * 6. Dispatches `UPLOAD_MEDIA` SQS messages for newly created items to the media upload queue.
 * 7. Marks the `sync_runs` record as `COMPLETED` on success or `FAILED` on error.
 */
export class MediaIngestionService {
  /**
   * @param mediaFetcher - Paginated Meta media fetcher.
   * @param db - Drizzle database client.
   * @param sqsService - Optional SQS service for dispatching asset upload messages.
   */
  constructor(
    private readonly mediaFetcher: MediaFetcher,
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly sqsService?: SqsService,
  ) {}

  /**
   * Syncs media items for an initialized hashtag.
   *
   * @param hashtagId - The database UUID of the hashtag.
   * @param syncType - The type of sync: `'TOP'` or `'RECENT'`.
   * @returns A {@link SyncResult} describing the outcome.
   * @throws {Error} If the hashtag does not exist or if media fetching/ingestion fails.
   */
  public async syncMedia(hashtagId: string, syncType: SyncType): Promise<SyncResult> {
    const hashtag = await this.requireHashtag(hashtagId);

    logger.info(
      `Starting ${syncType} sync for hashtag "${hashtag.name}" (id: ${hashtag.id}, metaId: ${hashtag.metaHashtagId})`,
    );

    // ── Step 1: Create sync_run record with RUNNING status ─────────
    const syncRun = await this.createSyncRun(hashtag.id, syncType);

    try {
      // ── Step 2: Fetch media from Meta via MediaFetcher ───────────
      const feedType: MediaFeedType = syncType === 'TOP' ? 'top' : 'recent';
      const { items } = await this.mediaFetcher.fetchMedia(hashtag.metaHashtagId, feedType);

      // ── Step 3: Ingest media into PostgreSQL in batch ───────────
      const { itemsCreated, itemsSkipped } = await this.ingestMediaBatch(hashtag.id, items);
      const itemsFetched = items.length;

      // ── Step 4: Mark sync_run as COMPLETED ───────────────────────
      await this.completeSyncRun(syncRun.id, itemsFetched, itemsCreated, itemsSkipped);

      logger.info(
        `Sync run ${syncRun.id} completed: ${itemsFetched} fetched, ${itemsCreated} created, ${itemsSkipped} skipped.`,
      );

      return {
        syncRunId: syncRun.id,
        hashtagId: hashtag.id,
        syncType,
        status: 'COMPLETED',
        itemsFetched,
        itemsCreated,
        itemsSkipped,
      };
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeErrorMessage = sanitizeErrorMessage(rawMessage);

      logger.error(`Sync run ${syncRun.id} failed: ${safeErrorMessage}`);

      await this.failSyncRun(syncRun.id, safeErrorMessage);

      throw err;
    }
  }

  // ----------------------------------------------------------------
  // Private Helpers
  // ----------------------------------------------------------------

  /**
   * Looks up a hashtag by database UUID or throws if not found.
   *
   * @param hashtagId - The database UUID of the hashtag.
   * @returns The matching {@link Hashtag} record.
   * @throws {Error} If no hashtag exists with the given ID.
   */
  private async requireHashtag(hashtagId: string): Promise<Hashtag> {
    const rows = await this.db.select().from(hashtags).where(eq(hashtags.id, hashtagId)).limit(1);

    const record = rows[0];
    if (!record) {
      throw new Error(`Hashtag with ID "${hashtagId}" not found.`);
    }

    return record;
  }

  /**
   * Creates a new `sync_runs` record in the database with status `RUNNING`.
   *
   * @param hashtagId - The database UUID of the hashtag.
   * @param syncType - The sync type (`'TOP'` or `'RECENT'`).
   * @returns The newly created {@link SyncRun} record.
   */
  private async createSyncRun(hashtagId: string, syncType: SyncType): Promise<SyncRun> {
    const inserted = await this.db
      .insert(syncRuns)
      .values({
        hashtagId,
        syncType,
        status: 'RUNNING',
        itemsFetched: 0,
        itemsCreated: 0,
        itemsSkipped: 0,
        startedAt: new Date(),
      })
      .returning();

    const record = inserted[0];
    if (!record) {
      throw new Error('Failed to create sync_run record.');
    }

    return record;
  }

  /**
   * Batch inserts media items with duplicate handling via `ON CONFLICT (meta_media_id) DO NOTHING`
   * and enqueues `UPLOAD_MEDIA` jobs for newly created items.
   *
   * @param hashtagId - Database UUID of the hashtag.
   * @param items - Array of {@link MetaMediaItem} objects from Meta.
   * @returns The count of newly created and skipped items.
   */
  private async ingestMediaBatch(
    hashtagId: string,
    items: MetaMediaItem[],
  ): Promise<{ itemsCreated: number; itemsSkipped: number }> {
    if (items.length === 0) {
      return { itemsCreated: 0, itemsSkipped: 0 };
    }

    // Deduplicate in-memory by metaMediaId to avoid Postgres ON CONFLICT batch collision
    const uniqueMap = new Map<string, MetaMediaItem>();
    for (const item of items) {
      if (!uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      }
    }
    const deduplicatedItems = Array.from(uniqueMap.values());

    const mediaRows: NewMedia[] = deduplicatedItems.map((item) => ({
      hashtagId,
      metaMediaId: item.id,
      mediaType: item.media_type ?? 'UNKNOWN',
      caption: item.caption ?? null,
      mediaUrl: item.media_url ?? null,
      permalink: item.permalink ?? null,
      publishedAt: item.timestamp ? new Date(item.timestamp) : null,
      likeCount: item.like_count ?? null,
      commentsCount: item.comments_count ?? null,
      storageKey: null,
      storageStatus: 'PENDING',
    }));

    const inserted = await this.db
      .insert(media)
      .values(mediaRows)
      .onConflictDoNothing({ target: media.metaMediaId })
      .returning();

    const itemsCreated = inserted.length;
    const itemsSkipped = items.length - itemsCreated;

    // ── Dispatch UPLOAD_MEDIA SQS jobs for newly inserted rows ────
    if (this.sqsService && inserted.length > 0) {
      const mediaUploadQueueUrl = configService.getMediaUploadQueueUrl();
      if (mediaUploadQueueUrl) {
        logger.debug(`Dispatching ${inserted.length} UPLOAD_MEDIA messages to SQS queue`);
        for (const row of inserted) {
          try {
            await this.sqsService.sendMessage(
              { type: 'UPLOAD_MEDIA', mediaId: row.id },
              mediaUploadQueueUrl,
            );
          } catch (sqsErr) {
            logger.warn(
              `Failed to dispatch UPLOAD_MEDIA message for media ID ${row.id}: ${sanitizeErrorMessage(String(sqsErr))}`,
            );
          }
        }
      }
    }

    return { itemsCreated, itemsSkipped };
  }

  /**
   * Updates the `sync_runs` record with completed metrics and status `COMPLETED`.
   */
  private async completeSyncRun(
    syncRunId: string,
    itemsFetched: number,
    itemsCreated: number,
    itemsSkipped: number,
  ): Promise<void> {
    await this.db
      .update(syncRuns)
      .set({
        status: 'COMPLETED',
        itemsFetched,
        itemsCreated,
        itemsSkipped,
        completedAt: new Date(),
      })
      .where(eq(syncRuns.id, syncRunId));
  }

  /**
   * Safely updates the `sync_runs` record with status `FAILED` and a sanitized error message.
   */
  private async failSyncRun(syncRunId: string, errorMessage: string): Promise<void> {
    try {
      await this.db
        .update(syncRuns)
        .set({
          status: 'FAILED',
          error: sanitizeErrorMessage(errorMessage),
          completedAt: new Date(),
        })
        .where(eq(syncRuns.id, syncRunId));
    } catch (updateErr) {
      logger.error(
        `Failed to update sync_run ${syncRunId} to FAILED: ${sanitizeErrorMessage(String(updateErr))}`,
      );
    }
  }
}

// ----------------------------------------------------------------
// Default singleton wired to production dependencies
// ----------------------------------------------------------------
import { db } from '../../db/connection.js';
import { mediaFetcher } from '../instagram/media.fetcher.js';
import { sqsService } from '../../services/queue/sqs.service.js';

export const mediaIngestionService = new MediaIngestionService(mediaFetcher, db, sqsService);
