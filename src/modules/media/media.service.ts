import { desc, count } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { media } from '../../db/schema.js';
import type { Media } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import { db } from '../../db/connection.js';

/**
 * Options accepted when querying paginated media records.
 */
export interface PaginationOptions {
  /** Page number (1-indexed, default 1). */
  page?: number;
  /** Number of records per page (default 20, max 100). */
  limit?: number;
}

/**
 * Pagination metadata returned in the API response.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Paginated media response shape.
 */
export interface PaginatedMediaResult {
  data: Media[];
  pagination: PaginationMeta;
}

/**
 * Service for querying and retrieving media records.
 */
export class MediaService {
  /**
   * @param dbClient - Drizzle database client instance.
   */
  constructor(private readonly dbClient: NodePgDatabase<typeof schema> = db) {}

  /**
   * Retrieves paginated media records ordered by `createdAt` in descending order.
   *
   * @param options - Pagination options (page and limit).
   * @returns Paginated media records with total and totalPages metadata.
   */
  public async getMedia(options: PaginationOptions = {}): Promise<PaginatedMediaResult> {
    // ── 1. Sanitize & validate pagination params ──────────────────
    const rawPage = Number(options.page);
    const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

    const rawLimit = Number(options.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 100) : 20;

    const offset = (page - 1) * limit;

    // ── 2. Count total records in media table ─────────────────────
    const countResult = await this.dbClient.select({ count: count() }).from(media);

    const total = Number(countResult[0]?.count ?? 0);
    const totalPages = Math.ceil(total / limit);

    // ── 3. Fetch paginated records ordered by createdAt DESC ──────
    const data = await this.dbClient
      .select()
      .from(media)
      .orderBy(desc(media.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }
}

// ----------------------------------------------------------------
// Default singleton wired to production database
// ----------------------------------------------------------------
export const mediaService = new MediaService(db);
