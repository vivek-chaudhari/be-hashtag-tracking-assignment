import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { InstagramClient } from './instagram.client.js';
import { MetaApiError } from './instagram.errors.js';
import type { Hashtag } from '../../db/schema.js';
import { hashtags } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('InstagramService');

/**
 * Service that handles all business logic for Instagram hashtag management.
 * Depends on the Meta API client and the Drizzle database instance via
 * constructor injection for easy testability.
 */
export class InstagramService {
  /**
   * @param client - The Meta Graph API HTTP client.
   * @param db - Drizzle database instance (injected for testability).
   */
  constructor(
    private readonly client: InstagramClient,
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // ----------------------------------------------------------------
  // Public methods
  // ----------------------------------------------------------------

  /**
   * Idempotently initializes a hashtag in the database.
   *
   * Behavior:
   * 1. Search Meta Graph API for the given hashtag name.
   * 2. Extract the Meta hashtag ID from the response.
   * 3. Check whether the hashtag already exists in the `hashtags` table.
   * 4. If it does not exist → insert it and return the new record.
   * 5. If it exists and the Meta hashtag ID matches → return the existing record.
   * 6. If it exists but the Meta hashtag ID has drifted → update and return.
   *
   * This operation is safe to call multiple times; it will never produce duplicate rows.
   *
   * @param name - The hashtag name to initialize (without leading `#`).
   * @returns The database `Hashtag` record (either existing or newly created).
   * @throws {MetaConfigError} If Meta credentials are not configured.
   * @throws {MetaApiError} If the Meta API returns an unexpected result.
   * @throws {Error} If the Meta API returns no hashtag ID for the given name.
   */
  public async initializeHashtag(name: string): Promise<Hashtag> {
    logger.info(`Searching Instagram hashtag: ${name}`);

    const searchResponse = await this.client.searchHashtag(name);

    const metaHashtagId = searchResponse.data[0]?.id;
    if (!metaHashtagId) {
      throw new MetaApiError(
        `Meta API returned no hashtag ID for hashtag "${name}". ` +
          'The hashtag may not exist or the account may not have used it recently.',
      );
    }

    logger.debug(`Meta returned hashtag ID for "${name}": ${metaHashtagId}`);

    // Check if this hashtag already exists in the database by name
    const existing = await this.findHashtagByName(name);

    if (!existing) {
      return this.insertHashtag(name, metaHashtagId);
    }

    // Hashtag exists — check if the Meta ID has drifted
    if (existing.metaHashtagId === metaHashtagId) {
      logger.debug(`Hashtag "${name}" already initialized (id: ${existing.id}).`);
      return existing;
    }

    // Meta ID has changed — update it
    logger.warn(`Meta hashtag ID for "${name}" has changed. Updating database record.`);
    return this.updateMetaHashtagId(existing.id, metaHashtagId);
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  /**
   * Queries the database for a hashtag by its name.
   *
   * @param name - The hashtag name to look up.
   * @returns The matching `Hashtag` record, or `undefined` if not found.
   */
  private async findHashtagByName(name: string): Promise<Hashtag | undefined> {
    const rows = await this.db.select().from(hashtags).where(eq(hashtags.name, name)).limit(1);

    return rows[0];
  }

  /**
   * Inserts a new hashtag record into the database.
   *
   * @param name - The hashtag name.
   * @param metaHashtagId - The Meta hashtag ID returned by the API.
   * @returns The newly inserted `Hashtag` record.
   * @throws {Error} If the insert does not return a record.
   */
  private async insertHashtag(name: string, metaHashtagId: string): Promise<Hashtag> {
    logger.debug(`Inserting new hashtag: ${name}`);

    const inserted = await this.db.insert(hashtags).values({ name, metaHashtagId }).returning();

    const record = inserted[0];
    if (!record) {
      throw new Error(`Failed to insert hashtag "${name}" — no record returned.`);
    }

    logger.info(`Hashtag initialized: ${name} (id: ${record.id})`);
    return record;
  }

  /**
   * Updates the `meta_hashtag_id` field for an existing hashtag record.
   *
   * @param id - The database UUID of the hashtag record.
   * @param metaHashtagId - The new Meta hashtag ID.
   * @returns The updated `Hashtag` record.
   * @throws {Error} If the update does not return a record.
   */
  private async updateMetaHashtagId(id: string, metaHashtagId: string): Promise<Hashtag> {
    const updated = await this.db
      .update(hashtags)
      .set({ metaHashtagId, updatedAt: new Date() })
      .where(eq(hashtags.id, id))
      .returning();

    const record = updated[0];
    if (!record) {
      throw new Error(`Failed to update hashtag id "${id}" — no record returned.`);
    }

    logger.info(`Hashtag updated: ${record.name} (id: ${record.id})`);
    return record;
  }
}

// ----------------------------------------------------------------
// Default singleton wired to production dependencies
// ----------------------------------------------------------------
import { db } from '../../db/connection.js';
import { instagramClient } from './instagram.client.js';

export const instagramService = new InstagramService(instagramClient, db);
