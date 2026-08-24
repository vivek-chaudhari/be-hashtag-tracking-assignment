import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { InstagramClient } from '../instagram/instagram.client.js';
import { MetaApiError } from '../instagram/instagram.errors.js';
import type { Hashtag } from '../../db/schema.js';
import { hashtags } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import { createLogger } from '../../common/logger.js';
import { normalizeHashtag, isUniqueViolation } from '../../common/utils/hashtag.utils.js';

const logger = createLogger('HashtagService');

/**
 * Handles all domain logic for hashtag initialization.
 *
 * Dependencies are injected so the class is easily unit-testable
 * without a live database or Meta API connection.
 */
export class HashtagService {
  /**
   * @param client - Meta Graph API client.
   * @param db     - Drizzle database instance.
   */
  constructor(
    private readonly client: InstagramClient,
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Idempotently initializes a hashtag record in the database.
   *
   * Steps:
   * 1. Normalize the input (trim, strip `#`, lowercase).
   * 2. Look up the hashtag by name in the local database.
   * 3. If found → return the existing record immediately (no Meta call).
   * 4. If not found → call Meta `ig_hashtag_search`, extract the ID,
   *    then insert the new row.
   * 5. On a concurrent-insert race condition (unique violation) →
   *    re-fetch and return the row inserted by the winning request.
   *
   * The operation is safe to call concurrently; it will never produce
   * duplicate rows thanks to the `uq_hashtags_name` constraint.
   *
   * @param name - Hashtag name, with or without a leading `#` (e.g. "matcha" or "#Matcha").
   * @returns The database `Hashtag` record.
   * @throws {Error}         If the normalized name is empty after stripping.
   * @throws {MetaApiError}  If Meta returns no ID for the hashtag.
   * @throws {MetaConfigError} If Meta credentials are not configured.
   */
  public async initializeHashtag(name: string): Promise<Hashtag> {
    const normalized = normalizeHashtag(name);

    if (!normalized) {
      throw new Error('Hashtag name must not be empty after normalization.');
    }

    logger.info(`Initializing hashtag: ${normalized}`);

    // ── Step 1: local cache check ──────────────────────────────────
    const existing = await this.findByName(normalized);
    if (existing) {
      logger.debug(
        `Hashtag "${normalized}" already exists locally (id: ${existing.id}). Returning cached record.`,
      );
      return existing;
    }

    // ── Step 2: call Meta API ──────────────────────────────────────
    logger.info(`Hashtag "${normalized}" not in database. Searching Meta API.`);
    const metaHashtagId = await this.fetchMetaHashtagId(normalized);

    // ── Step 3: insert (handling concurrent race conditions) ────────
    return this.insertWithRaceGuard(normalized, metaHashtagId);
  }

  /**
   * Fetches the Meta hashtag ID for the given name via the Graph API.
   *
   * @param name - Normalized hashtag name.
   * @returns The Meta hashtag ID string.
   * @throws {MetaApiError} If Meta returns no result for the hashtag.
   */
  private async fetchMetaHashtagId(name: string): Promise<string> {
    const response = await this.client.searchHashtag(name);
    const metaHashtagId = response.data[0]?.id;

    if (!metaHashtagId) {
      throw new MetaApiError(
        `Meta API returned no hashtag ID for "${name}". ` +
          'The hashtag may not exist or the Business Account may not have used it recently.',
      );
    }

    logger.debug(`Meta API returned ID for "${name}": ${metaHashtagId}`);
    return metaHashtagId;
  }

  /**
   * Inserts a hashtag row and gracefully handles a concurrent insert
   * race condition by catching the unique-constraint violation and
   * re-fetching the row inserted by the winning request.
   *
   * @param name          - Normalized hashtag name.
   * @param metaHashtagId - Meta hashtag ID to store.
   * @returns The inserted or concurrently-inserted `Hashtag` record.
   * @throws {Error} If the insert fails for a non-duplicate reason
   *                 or if the re-fetch still returns nothing.
   */
  private async insertWithRaceGuard(name: string, metaHashtagId: string): Promise<Hashtag> {
    try {
      const inserted = await this.db.insert(hashtags).values({ name, metaHashtagId }).returning();

      const record = inserted[0];
      if (!record) {
        throw new Error(`Insert succeeded but returned no record for hashtag "${name}".`);
      }

      logger.info(`Hashtag "${name}" created (id: ${record.id}).`);
      return record;
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }

      // Race condition: another request inserted the same row concurrently.
      logger.warn(
        `Unique constraint violation inserting "${name}". ` +
          'A concurrent request won the race. Re-fetching existing record.',
      );

      const existing = await this.findByName(name);
      if (!existing) {
        throw new Error(
          `Unique violation on "${name}" but subsequent SELECT returned no record. ` +
            'This is an unexpected database state.',
        );
      }

      return existing;
    }
  }

  /**
   * Looks up a hashtag by its normalized name.
   *
   * @param name - Normalized hashtag name.
   * @returns The matching `Hashtag` row, or `undefined` if not found.
   */
  private async findByName(name: string): Promise<Hashtag | undefined> {
    const rows = await this.db.select().from(hashtags).where(eq(hashtags.name, name)).limit(1);

    return rows[0];
  }
}

// ----------------------------------------------------------------
// Default singleton wired to production dependencies
// ----------------------------------------------------------------
import { db } from '../../db/connection.js';
import { instagramClient } from '../instagram/instagram.client.js';

export const hashtagService = new HashtagService(instagramClient, db);
