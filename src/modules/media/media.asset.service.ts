import { eq, inArray, asc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { S3StorageService } from '../../services/storage/s3.service.js';
import type { Media, StorageStatus } from '../../db/schema.js';
import { media } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import { createLogger } from '../../common/logger.js';
import { sanitizeErrorMessage } from './media.ingestion.service.js';

const logger = createLogger('MediaAssetService');

/**
 * Result returned by {@link MediaAssetService.uploadPendingMedia}.
 */
export interface BatchUploadResult {
  processed: number;
  uploaded: number;
  failed: number;
}

/**
 * Resolves a deterministic file extension from a MIME content-type header.
 *
 * @param contentType - The raw Content-Type header string.
 * @returns The dot-prefixed file extension or an empty string.
 */
export function getExtensionFromContentType(contentType?: string): string {
  if (!contentType) return '';

  const mime = contentType.toLowerCase().split(';')[0]?.trim();
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'video/mp4':
      return '.mp4';
    case 'video/quicktime':
      return '.mov';
    default:
      return '';
  }
}

/**
 * Generates a deterministic S3 key for a media asset.
 *
 * Pattern: `hashtags/{hashtagId}/{metaMediaId}{extension}`
 *
 * @param hashtagId - The database UUID of the associated hashtag.
 * @param metaMediaId - The Meta media ID.
 * @param contentType - Optional Content-Type header to derive file extension.
 * @returns Deterministic S3 key.
 */
export function generateStorageKey(
  hashtagId: string,
  metaMediaId: string,
  contentType?: string,
): string {
  const ext = getExtensionFromContentType(contentType);
  return `hashtags/${hashtagId}/${metaMediaId}${ext}`;
}

/**
 * Service for downloading Instagram media assets from Meta and uploading them to AWS S3.
 */
export class MediaAssetService {
  /**
   * @param s3Service - S3 storage service abstraction.
   * @param db - Drizzle database client.
   */
  constructor(
    private readonly s3Service: S3StorageService,
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Downloads a single media asset and uploads it to S3, updating the database status.
   *
   * Lifecycle:
   * - If already `COMPLETED` with a `storageKey`: skips upload (idempotent).
   * - Sets `storageStatus` = `'UPLOADING'`.
   * - Downloads binary content via native `fetch`.
   * - Uploads to S3 at `hashtags/{hashtagId}/{metaMediaId}{ext}`.
   * - Sets `storageStatus` = `'COMPLETED'`, `storageKey` = key.
   * - On failure: sets `storageStatus` = `'FAILED'`.
   *
   * @param mediaRecord - The database {@link Media} record.
   * @returns `true` if successfully uploaded or already completed, `false` if failed.
   */
  public async uploadMediaAsset(mediaRecord: Media): Promise<boolean> {
    // ── Idempotency: Skip if already uploaded ───────────────────────
    if (mediaRecord.storageStatus === 'COMPLETED' && mediaRecord.storageKey) {
      logger.debug(
        `Media asset ${mediaRecord.id} (${mediaRecord.metaMediaId}) already completed. Skipping upload.`,
      );
      return true;
    }

    // ── Validate mediaUrl existence ─────────────────────────────────
    if (!mediaRecord.mediaUrl || mediaRecord.mediaUrl.trim() === '') {
      logger.warn(
        `Media asset ${mediaRecord.id} (${mediaRecord.metaMediaId}) has no mediaUrl. Marking as FAILED.`,
      );
      await this.updateMediaStatus(mediaRecord.id, 'FAILED');
      return false;
    }

    // ── Step 1: Transition to UPLOADING ────────────────────────────
    await this.updateMediaStatus(mediaRecord.id, 'UPLOADING');

    try {
      // ── Step 2: Download media asset from Meta ─────────────────────
      let response: Response;
      try {
        response = await fetch(mediaRecord.mediaUrl);
      } catch (networkErr) {
        throw new Error(
          `Network error downloading media asset for metaMediaId "${mediaRecord.metaMediaId}": ${String(networkErr)}`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `HTTP error ${response.status} downloading media asset for metaMediaId "${mediaRecord.metaMediaId}".`,
        );
      }

      const contentType = response.headers.get('content-type') ?? undefined;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        throw new Error(
          `Downloaded media asset for metaMediaId "${mediaRecord.metaMediaId}" is empty (0 bytes).`,
        );
      }

      // ── Step 3: Generate deterministic S3 key and upload ───────────
      const storageKey = generateStorageKey(
        mediaRecord.hashtagId,
        mediaRecord.metaMediaId,
        contentType,
      );

      await this.s3Service.upload(storageKey, buffer, contentType);

      // ── Step 4: Mark COMPLETED with storageKey ─────────────────────
      await this.updateMediaStatus(mediaRecord.id, 'COMPLETED', storageKey);

      logger.info(
        `Media asset ${mediaRecord.id} (${mediaRecord.metaMediaId}) uploaded to S3 key: ${storageKey}`,
      );

      return true;
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeMessage = sanitizeErrorMessage(rawMessage);

      logger.error(
        `Failed to process media asset ${mediaRecord.id} (${mediaRecord.metaMediaId}): ${safeMessage}`,
      );

      await this.updateMediaStatus(mediaRecord.id, 'FAILED');
      return false;
    }
  }

  /**
   * Scans the database for pending or failed media assets and uploads them in batch.
   *
   * @param limit - Maximum number of records to process (default: 50).
   * @returns A {@link BatchUploadResult} summary.
   */
  public async uploadPendingMedia(limit: number = 50): Promise<BatchUploadResult> {
    logger.info(`Fetching up to ${limit} pending/failed media assets for S3 upload.`);

    const pendingMedia = await this.db
      .select()
      .from(media)
      .where(inArray(media.storageStatus, ['PENDING', 'FAILED', 'UPLOADING']))
      .orderBy(asc(media.createdAt))
      .limit(limit);

    logger.info(`Found ${pendingMedia.length} media assets to process.`);

    let uploaded = 0;
    let failed = 0;

    for (const record of pendingMedia) {
      const success = await this.uploadMediaAsset(record);
      if (success) {
        uploaded++;
      } else {
        failed++;
      }
    }

    logger.info(
      `Batch upload complete: ${pendingMedia.length} processed, ${uploaded} uploaded, ${failed} failed.`,
    );

    return {
      processed: pendingMedia.length,
      uploaded,
      failed,
    };
  }

  // ----------------------------------------------------------------
  // Private Helpers
  // ----------------------------------------------------------------

  /**
   * Updates the storageStatus and optional storageKey of a media record.
   *
   * @param mediaId - Database UUID of the media record.
   * @param storageStatus - The new {@link StorageStatus}.
   * @param storageKey - Optional S3 key to persist on completion.
   */
  private async updateMediaStatus(
    mediaId: string,
    storageStatus: StorageStatus,
    storageKey?: string,
  ): Promise<void> {
    const updateValues: {
      storageStatus: StorageStatus;
      updatedAt: Date;
      storageKey?: string;
    } = {
      storageStatus,
      updatedAt: new Date(),
    };

    if (storageKey !== undefined) {
      updateValues.storageKey = storageKey;
    }

    await this.db.update(media).set(updateValues).where(eq(media.id, mediaId));
  }
}

// ----------------------------------------------------------------
// Default singleton wired to production dependencies
// ----------------------------------------------------------------
import { db } from '../../db/connection.js';
import { s3StorageService } from '../../services/storage/s3.service.js';

export const mediaAssetService = new MediaAssetService(s3StorageService, db);
