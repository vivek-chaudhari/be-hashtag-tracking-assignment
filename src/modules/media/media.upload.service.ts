import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { S3StorageService } from '../../services/storage/s3.service.js';
import type { Media, StorageStatus } from '../../db/schema.js';
import { media } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import { createLogger } from '../../common/logger.js';
import { sanitizeErrorMessage } from './media.ingestion.service.js';
import { getExtensionFromContentType } from './media.asset.service.js';

const logger = createLogger('MediaUploadService');

/**
 * Result returned by {@link MediaUploadService.uploadMedia}.
 */
export interface MediaUploadResult {
  success: boolean;
  mediaId: string;
  storageKey?: string;
}

/**
 * Generates a deterministic S3 key under the `media/` prefix using the media record's database UUID.
 *
 * Pattern: `media/{mediaId}{extension}`
 *
 * @param mediaId - Database UUID of the media record.
 * @param contentType - Optional Content-Type header string to determine extension.
 * @returns The formatted deterministic S3 key.
 */
export function generateMediaStorageKey(mediaId: string, contentType?: string): string {
  const ext = getExtensionFromContentType(contentType);
  return `media/${mediaId}${ext}`;
}

/**
 * Service dedicated to uploading individual media assets to AWS S3.
 */
export class MediaUploadService {
  /**
   * @param s3Service - S3 storage service client.
   * @param db - Drizzle database client.
   */
  constructor(
    private readonly s3Service: S3StorageService,
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Downloads a media asset from Meta and uploads it to AWS S3.
   *
   * Lifecycle & Idempotency:
   * 1. Fetches media record from PostgreSQL by ID.
   * 2. If `storageStatus === 'COMPLETED'` and `storageKey` exists: skips upload (idempotent).
   * 3. Validates `mediaUrl` presence; if absent, sets status to `FAILED` and throws.
   * 4. Transitions status to `UPLOADING`.
   * 5. Downloads content via native `fetch`, validates buffer size > 0.
   * 6. Generates deterministic S3 key (`media/{mediaId}{ext}`).
   * 7. Uploads to S3 via PutObjectCommand.
   * 8. On success: sets `storageKey` and status `COMPLETED`.
   * 9. On failure: sets status `FAILED` and rethrows error for SQS retry/DLQ handling.
   *
   * @param mediaId - Database UUID of the media record to upload.
   * @returns {@link MediaUploadResult} on completion.
   * @throws {Error} If media record is not found or download/upload fails.
   */
  public async uploadMedia(mediaId: string): Promise<MediaUploadResult> {
    const mediaRecord = await this.requireMedia(mediaId);

    // ── Step 1: Idempotency check ─────────────────────────────────
    if (mediaRecord.storageStatus === 'COMPLETED' && mediaRecord.storageKey) {
      logger.info(
        `Media [id: ${mediaId}] is already COMPLETED (storageKey: ${mediaRecord.storageKey}). Skipping.`,
      );
      return {
        success: true,
        mediaId,
        storageKey: mediaRecord.storageKey,
      };
    }

    // ── Step 2: Validate mediaUrl ─────────────────────────────────
    if (!mediaRecord.mediaUrl || mediaRecord.mediaUrl.trim() === '') {
      logger.warn(`Media [id: ${mediaId}] has no mediaUrl. Marking as FAILED.`);
      await this.updateMediaStatus(mediaId, 'FAILED');
      throw new Error(`Media with ID "${mediaId}" has no mediaUrl.`);
    }

    // ── Step 3: Transition to UPLOADING ────────────────────────────
    await this.updateMediaStatus(mediaId, 'UPLOADING');
    logger.info(
      `Starting asset upload for media [id: ${mediaId}, metaMediaId: ${mediaRecord.metaMediaId}]`,
    );

    try {
      // ── Step 4: Download binary content from Meta ──────────────────
      let response: Response;
      try {
        response = await fetch(mediaRecord.mediaUrl);
      } catch (networkErr) {
        throw new Error(
          `Network error downloading media asset for mediaId "${mediaId}": ${String(networkErr)}`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `HTTP error ${response.status} downloading media asset for mediaId "${mediaId}".`,
        );
      }

      const contentType = response.headers.get('content-type') ?? undefined;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        throw new Error(`Downloaded media asset for mediaId "${mediaId}" is empty (0 bytes).`);
      }

      // ── Step 5: Generate deterministic S3 key and upload ───────────
      const storageKey = generateMediaStorageKey(mediaId, contentType);

      await this.s3Service.upload(storageKey, buffer, contentType);

      // ── Step 6: Mark COMPLETED in PostgreSQL ───────────────────────
      await this.updateMediaStatus(mediaId, 'COMPLETED', storageKey);

      logger.info(`Media asset [id: ${mediaId}] successfully uploaded to S3 key: ${storageKey}`);

      return {
        success: true,
        mediaId,
        storageKey,
      };
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeMessage = sanitizeErrorMessage(rawMessage);

      logger.error(`Media upload failed for [id: ${mediaId}]: ${safeMessage}`);

      await this.updateMediaStatus(mediaId, 'FAILED');

      // Rethrow so SQS worker leaves message undeleted for visibility timeout / DLQ
      throw err;
    }
  }

  // ----------------------------------------------------------------
  // Private Helpers
  // ----------------------------------------------------------------

  /**
   * Looks up a media record by ID or throws if not found.
   */
  private async requireMedia(mediaId: string): Promise<Media> {
    const rows = await this.db.select().from(media).where(eq(media.id, mediaId)).limit(1);

    const record = rows[0];
    if (!record) {
      throw new Error(`Media with ID "${mediaId}" not found.`);
    }

    return record;
  }

  /**
   * Updates storageStatus and optional storageKey for a media record.
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

export const mediaUploadService = new MediaUploadService(s3StorageService, db);
