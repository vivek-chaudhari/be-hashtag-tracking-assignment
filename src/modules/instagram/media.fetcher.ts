import type { InstagramClient } from './instagram.client.js';
import type { MetaMediaItem, MediaListResponse, FetchMediaOptions } from './instagram.types.js';
import { MetaApiError } from './instagram.errors.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('MediaFetcher');

/** Maximum number of media items fetched across all pages in a single run. */
export const MEDIA_FETCH_LIMIT = 500;

/** Media type selector: top performing or most recent. */
export type MediaFeedType = 'top' | 'recent';

/**
 * Result returned by {@link MediaFetcher.fetchMedia}.
 */
export interface MediaFetchResult {
  /** All collected media items, capped at {@link MEDIA_FETCH_LIMIT}. */
  items: MetaMediaItem[];
  /** Number of pages retrieved from the Meta API. */
  pagesFetched: number;
}

/**
 * Orchestrates paginated media retrieval from the Meta Graph API for a hashtag,
 * stopping when either:
 * - Meta returns no `paging.next` (end of results), or
 * - {@link MEDIA_FETCH_LIMIT} (500) items have been collected.
 *
 * Responsibilities:
 * - Selecting top / recent feed endpoint via `InstagramClient`.
 * - Pagination control and page aggregation.
 * - Enforcing the 500-item cap (truncating the final page if necessary).
 * - Pagination loop protection (detecting repeated `paging.next` URLs).
 *
 * HTTP communication is strictly delegated to {@link InstagramClient}.
 * The access token and full next-page URLs are NEVER logged.
 */
export class MediaFetcher {
  /**
   * @param client - The Meta Graph API client handling HTTP communication.
   */
  constructor(private readonly client: InstagramClient) {}

  /**
   * Fetches up to {@link MEDIA_FETCH_LIMIT} media items for a hashtag.
   *
   * @param hashtagId  - The Meta hashtag ID.
   * @param feedType   - `'top'` or `'recent'`.
   * @param options    - Optional fields / page-size overrides for the first page.
   * @returns A {@link MediaFetchResult} containing the collected items and page count.
   * @throws {MetaApiError} On API errors, network failures, or repeated pagination URLs.
   */
  public async fetchMedia(
    hashtagId: string,
    feedType: MediaFeedType,
    options: FetchMediaOptions = {},
  ): Promise<MediaFetchResult> {
    logger.info(`Starting ${feedType}_media fetch for hashtag ID: ${hashtagId}`);

    // ── Page 1: delegate to the client ────────────────────────────
    const firstPage =
      feedType === 'top'
        ? await this.client.getTopMedia(hashtagId, options)
        : await this.client.getRecentMedia(hashtagId, options);

    const items: MetaMediaItem[] = [];
    const visitedUrls = new Set<string>();
    let pagesFetched = 0;

    // ── Collect pages ─────────────────────────────────────────────
    let current: MediaListResponse = firstPage;

    while (true) {
      const available = MEDIA_FETCH_LIMIT - items.length;

      if (current.data.length <= available) {
        items.push(...current.data);
      } else {
        // Final page would push us over the cap — truncate
        items.push(...current.data.slice(0, available));
      }

      pagesFetched += 1;

      logger.debug(
        `Page ${pagesFetched} fetched: ${current.data.length} items ` +
          `(total so far: ${items.length}/${MEDIA_FETCH_LIMIT})`,
      );

      // ── Stop conditions ────────────────────────────────────────
      if (items.length >= MEDIA_FETCH_LIMIT) {
        logger.info(
          `Reached ${MEDIA_FETCH_LIMIT}-item limit after ${pagesFetched} page(s). Stopping.`,
        );
        break;
      }

      const nextUrl = current.paging?.next;
      if (!nextUrl) {
        logger.info(`No paging.next on page ${pagesFetched}. All pages fetched.`);
        break;
      }

      // ── Pagination loop protection ─────────────────────────────
      if (visitedUrls.has(nextUrl)) {
        throw new MetaApiError('Meta pagination returned a previously visited next URL.');
      }
      visitedUrls.add(nextUrl);

      // ── Fetch next page via InstagramClient ────────────────────
      current = await this.client.fetchNextPage<MediaListResponse>(nextUrl);
    }

    logger.info(
      `${feedType}_media fetch complete: ${items.length} items across ${pagesFetched} page(s).`,
    );

    return { items, pagesFetched };
  }
}

// ----------------------------------------------------------------
// Default singleton wired to the production client
// ----------------------------------------------------------------
import { instagramClient } from './instagram.client.js';

export const mediaFetcher = new MediaFetcher(instagramClient);
