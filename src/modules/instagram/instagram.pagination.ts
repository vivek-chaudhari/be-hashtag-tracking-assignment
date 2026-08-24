import type { MediaListResponse, MetaMediaItem } from './instagram.types.js';

/**
 * Async generator that fetches all pages of a Meta media list endpoint.
 * Yields one page at a time (an array of `MetaMediaItem`) and follows
 * `paging.next` until there are no more pages.
 *
 * The ingestion limit (e.g. 500 items) is intentionally NOT enforced here —
 * callers control how many items they consume from the generator.
 *
 * @example
 * ```ts
 * const fetcher = (url: string) => fetch(url).then(r => r.json());
 * for await (const page of fetchAllPages(firstResponse, fetcher)) {
 *   processPage(page);
 * }
 * ```
 *
 * @param firstPageResponse - The already-fetched first page response.
 * @param fetchNextPage - A function that fetches the next page given its URL.
 *                        The URL already contains all required query params (incl. token).
 * @yields Arrays of `MetaMediaItem` for each page.
 */
export async function* fetchAllPages(
  firstPageResponse: MediaListResponse,
  fetchNextPage: (nextUrl: string) => Promise<MediaListResponse>,
): AsyncGenerator<MetaMediaItem[], void, undefined> {
  let current: MediaListResponse = firstPageResponse;

  while (true) {
    yield current.data;

    const nextUrl = current.paging?.next;
    if (!nextUrl) {
      break;
    }

    current = await fetchNextPage(nextUrl);
  }
}

/**
 * Convenience helper that collects all pages into a single flat array.
 * Use only when you know the result set is bounded; prefer the generator
 * for large or unknown result sets.
 *
 * @param firstPageResponse - The already-fetched first page response.
 * @param fetchNextPage - A function that fetches the next page given its URL.
 * @returns A flat array of all `MetaMediaItem` objects across all pages.
 */
export async function collectAllPages(
  firstPageResponse: MediaListResponse,
  fetchNextPage: (nextUrl: string) => Promise<MediaListResponse>,
): Promise<MetaMediaItem[]> {
  const all: MetaMediaItem[] = [];
  for await (const page of fetchAllPages(firstPageResponse, fetchNextPage)) {
    all.push(...page);
  }
  return all;
}
