import { describe, it, expect } from '@jest/globals';
import { jest } from '@jest/globals';
import { MediaFetcher, MEDIA_FETCH_LIMIT } from '../media.fetcher.js';
import type { InstagramClient } from '../instagram.client.js';
import { MetaApiError } from '../instagram.errors.js';
import type { MediaListResponse, MetaMediaItem } from '../instagram.types.js';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/** Generates `count` fake MetaMediaItems starting at id offset `start`. */
function makeItems(count: number, start = 0): MetaMediaItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `media-${start + i}`,
    media_type: 'IMAGE',
  }));
}

/** Builds a MediaListResponse page. */
function makePage(items: MetaMediaItem[], nextUrl?: string): MediaListResponse {
  return {
    data: items,
    paging: nextUrl ? { next: nextUrl } : { cursors: { before: 'b', after: 'a' } },
  };
}

/** Creates a minimal InstagramClient mock with fetchNextPage support. */
function makeClient(overrides: Partial<InstagramClient> = {}): InstagramClient {
  return {
    searchHashtag: jest.fn(),
    getTopMedia: jest.fn().mockResolvedValue(makePage(makeItems(25), 'https://meta/page2')),
    getRecentMedia: jest.fn().mockResolvedValue(makePage(makeItems(25), 'https://meta/page2')),
    fetchNextPage: jest.fn().mockResolvedValue(makePage(makeItems(25))),
    ...overrides,
  } as unknown as InstagramClient;
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('MediaFetcher.fetchMedia', () => {
  // ── single page ────────────────────────────────────────────────

  it('returns items from a single-page response when paging.next is absent', async () => {
    const items = makeItems(10);
    const mockClient = makeClient({
      getTopMedia: jest.fn().mockResolvedValue(makePage(items)), // no nextUrl
    });
    const fetcher = new MediaFetcher(mockClient);

    const result = await fetcher.fetchMedia('hashtag-1', 'top');

    expect(result.items).toHaveLength(10);
    expect(result.pagesFetched).toBe(1);
    expect(mockClient.getTopMedia).toHaveBeenCalledTimes(1);
    expect(mockClient.fetchNextPage).not.toHaveBeenCalled();
  });

  // ── multiple pages ─────────────────────────────────────────────

  it('collects items across multiple pages using client.fetchNextPage', async () => {
    const page1Items = makeItems(25, 0);
    const page2Items = makeItems(25, 25);
    const page3Items = makeItems(15, 50);

    const mockClient = makeClient({
      getTopMedia: jest.fn().mockResolvedValue(makePage(page1Items, 'https://meta/page2')),
      fetchNextPage: jest
        .fn()
        .mockResolvedValueOnce(makePage(page2Items, 'https://meta/page3'))
        .mockResolvedValueOnce(makePage(page3Items)), // page 3 has no next
    });

    const fetcher = new MediaFetcher(mockClient);
    const result = await fetcher.fetchMedia('hashtag-1', 'top');

    expect(result.items).toHaveLength(65);
    expect(result.pagesFetched).toBe(3);
    expect(mockClient.getTopMedia).toHaveBeenCalledTimes(1);
    expect(mockClient.fetchNextPage).toHaveBeenCalledTimes(2);
    expect(mockClient.fetchNextPage).toHaveBeenNthCalledWith(1, 'https://meta/page2');
    expect(mockClient.fetchNextPage).toHaveBeenNthCalledWith(2, 'https://meta/page3');
  });

  // ── stops when paging.next is missing ──────────────────────────

  it('stops pagination when paging.next is absent', async () => {
    const mockClient = makeClient({
      getRecentMedia: jest.fn().mockResolvedValue(makePage(makeItems(5))), // no next
    });
    const fetcher = new MediaFetcher(mockClient);

    const result = await fetcher.fetchMedia('hashtag-1', 'recent');

    expect(result.items).toHaveLength(5);
    expect(result.pagesFetched).toBe(1);
    expect(mockClient.fetchNextPage).not.toHaveBeenCalled();
  });

  // ── stops at exactly 500 items ─────────────────────────────────

  it(`stops at exactly ${MEDIA_FETCH_LIMIT} items across 20 pages of 25`, async () => {
    let page = 2;
    const mockClient = makeClient({
      getTopMedia: jest.fn().mockResolvedValue(makePage(makeItems(25, 0), 'https://meta/page2')),
      fetchNextPage: jest.fn().mockImplementation(async () => {
        const isLast = page === 20;
        const startIdx = (page - 1) * 25;
        const responseBody = makePage(
          makeItems(25, startIdx),
          isLast ? undefined : `https://meta/page${page + 1}`,
        );
        page++;
        return responseBody;
      }),
    });

    const fetcher = new MediaFetcher(mockClient);
    const result = await fetcher.fetchMedia('hashtag-1', 'top');

    expect(result.items).toHaveLength(MEDIA_FETCH_LIMIT);
    expect(result.pagesFetched).toBe(20);
    expect(mockClient.fetchNextPage).toHaveBeenCalledTimes(19);
  });

  // ── final page truncated if it pushes total above 500 ──────────

  it('truncates the final page to stay within the 500-item cap', async () => {
    let page = 2;
    const mockClient = makeClient({
      getTopMedia: jest.fn().mockResolvedValue(makePage(makeItems(25, 0), 'https://meta/page2')),
      fetchNextPage: jest.fn().mockImplementation(async () => {
        const isLast = page === 20;
        const startIdx = (page - 1) * 25;
        // Last page returns 30 items (total would be 505 without truncation)
        const count = isLast ? 30 : 25;
        const responseBody = makePage(
          makeItems(count, startIdx),
          isLast ? undefined : `https://meta/page${page + 1}`,
        );
        page++;
        return responseBody;
      }),
    });

    const fetcher = new MediaFetcher(mockClient);
    const result = await fetcher.fetchMedia('hashtag-1', 'top');

    expect(result.items).toHaveLength(MEDIA_FETCH_LIMIT);
    expect(result.pagesFetched).toBe(20);
  });

  // ── first page with 500 items does not request next page ────────

  it('does not request subsequent pages if first page already contains 500 items', async () => {
    const mockClient = makeClient({
      getTopMedia: jest.fn().mockResolvedValue(makePage(makeItems(500, 0), 'https://meta/page2')),
    });

    const fetcher = new MediaFetcher(mockClient);
    const result = await fetcher.fetchMedia('hashtag-1', 'top');

    expect(result.items).toHaveLength(500);
    expect(result.pagesFetched).toBe(1);
    expect(mockClient.fetchNextPage).not.toHaveBeenCalled();
  });

  // ── pagination loop protection (repeated nextUrl) ───────────────

  it('detects repeated paging.next URL and throws MetaApiError without leaking the URL', async () => {
    const repeatedUrl = 'https://meta/loop-page?token=secret123';
    const mockClient = makeClient({
      getTopMedia: jest.fn().mockResolvedValue(makePage(makeItems(25, 0), repeatedUrl)),
      fetchNextPage: jest.fn().mockResolvedValue(makePage(makeItems(25, 25), repeatedUrl)), // loops back
    });

    const fetcher = new MediaFetcher(mockClient);

    await expect(fetcher.fetchMedia('hashtag-1', 'top')).rejects.toThrow(MetaApiError);
    await expect(fetcher.fetchMedia('hashtag-1', 'top')).rejects.toMatchObject({
      message: 'Meta pagination returned a previously visited next URL.',
    });

    // Ensure error message does not contain token or URL
    try {
      await fetcher.fetchMedia('hashtag-1', 'top');
    } catch (err) {
      expect((err as Error).message).not.toContain('secret123');
      expect((err as Error).message).not.toContain(repeatedUrl);
    }
  });

  // ── feed type selection ────────────────────────────────────────

  it('calls getRecentMedia when feedType is "recent"', async () => {
    const mockClient = makeClient({
      getRecentMedia: jest.fn().mockResolvedValue(makePage(makeItems(8))),
    });
    const fetcher = new MediaFetcher(mockClient);

    await fetcher.fetchMedia('hashtag-1', 'recent');

    expect(mockClient.getRecentMedia).toHaveBeenCalledTimes(1);
    expect(mockClient.getTopMedia).not.toHaveBeenCalled();
  });

  // ── error propagation from first page ──────────────────────────

  it('propagates MetaApiError from the first page request', async () => {
    const apiError = new MetaApiError('Rate limit exceeded', 429);
    const mockClient = makeClient({
      getTopMedia: jest.fn().mockRejectedValue(apiError),
    });
    const fetcher = new MediaFetcher(mockClient);

    await expect(fetcher.fetchMedia('hashtag-1', 'top')).rejects.toThrow(MetaApiError);
    await expect(fetcher.fetchMedia('hashtag-1', 'top')).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  // ── error propagation from fetchNextPage ───────────────────────

  it('propagates MetaApiError thrown by client.fetchNextPage', async () => {
    const apiError = new MetaApiError('OAuth token expired on paging', 190);
    const mockClient = makeClient({
      getTopMedia: jest.fn().mockResolvedValue(makePage(makeItems(25), 'https://meta/page2')),
      fetchNextPage: jest.fn().mockRejectedValue(apiError),
    });

    const fetcher = new MediaFetcher(mockClient);

    await expect(fetcher.fetchMedia('hashtag-1', 'top')).rejects.toThrow(MetaApiError);
    await expect(fetcher.fetchMedia('hashtag-1', 'top')).rejects.toMatchObject({
      statusCode: 190,
      message: 'OAuth token expired on paging',
    });
  });
});
