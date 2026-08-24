import { describe, it, expect, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import { InstagramClient } from '../instagram.client.js';
import { MetaApiError, MetaConfigError } from '../instagram.errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a client whose config thunks return the given values. */
function makeClient(accessToken: string, userId: string): InstagramClient {
  return new InstagramClient(
    () => accessToken,
    () => userId,
    'v24.0',
  );
}

/** Builds a minimal fetch mock that resolves with the given body and status. */
function mockFetchOk(body: unknown, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

/** Builds a fetch mock that rejects at the network level. */
function mockFetchNetworkError(message = 'Network failure') {
  return jest.fn().mockRejectedValue(new Error(message));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstagramClient', () => {
  let client: InstagramClient;

  beforeEach(() => {
    client = makeClient('test-token', 'test-user-id');
  });

  // ── searchHashtag ─────────────────────────────────────────────────────────

  describe('searchHashtag', () => {
    it('returns parsed hashtag search response on success', async () => {
      const fakeResponse = { data: [{ id: '17841583865247128' }] };
      globalThis.fetch = mockFetchOk(fakeResponse) as unknown as typeof fetch;

      const result = await client.searchHashtag('matcha');

      expect(result).toEqual(fakeResponse);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Verify the URL shape (without checking the token value)
      const calledUrl = (globalThis.fetch as ReturnType<typeof jest.fn>).mock
        .calls[0]?.[0] as string;
      expect(calledUrl).toContain('ig_hashtag_search');
      expect(calledUrl).toContain('q=matcha');
    });

    it('throws MetaApiError when Meta returns an error body (HTTP 200)', async () => {
      const errorBody = {
        error: {
          message: 'Invalid OAuth access token.',
          type: 'OAuthException',
          code: 190,
          fbtrace_id: 'trace-abc',
        },
      };
      globalThis.fetch = mockFetchOk(errorBody, 200) as unknown as typeof fetch;

      await expect(client.searchHashtag('matcha')).rejects.toThrow(MetaApiError);
      await expect(client.searchHashtag('matcha')).rejects.toMatchObject({
        metaCode: 190,
        metaFbTraceId: 'trace-abc',
      });
    });

    it('throws MetaApiError on non-2xx HTTP with JSON error body', async () => {
      const errorBody = {
        error: {
          message: 'Unsupported request.',
          type: 'GraphMethodException',
          code: 100,
        },
      };
      globalThis.fetch = mockFetchOk(errorBody, 400) as unknown as typeof fetch;

      await expect(client.searchHashtag('matcha')).rejects.toThrow(MetaApiError);
    });

    it('throws MetaApiError when the response body is not valid JSON', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      }) as unknown as typeof fetch;

      await expect(client.searchHashtag('matcha')).rejects.toThrow(MetaApiError);
      await expect(client.searchHashtag('matcha')).rejects.toMatchObject({ statusCode: 500 });
    });

    it('throws MetaApiError on a network-level failure', async () => {
      globalThis.fetch = mockFetchNetworkError('ECONNREFUSED') as unknown as typeof fetch;

      await expect(client.searchHashtag('matcha')).rejects.toThrow(MetaApiError);
      await expect(client.searchHashtag('matcha')).rejects.toMatchObject({
        statusCode: undefined,
      });
    });
  });

  // ── missing configuration ──────────────────────────────────────────────────

  describe('configuration validation', () => {
    it('throws MetaConfigError when META_ACCESS_TOKEN is empty', async () => {
      const noTokenClient = makeClient('', 'some-user-id');
      const fetchMock = mockFetchOk({ data: [] });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(noTokenClient.searchHashtag('matcha')).rejects.toThrow(MetaConfigError);
      await expect(noTokenClient.searchHashtag('matcha')).rejects.toMatchObject({
        message: expect.stringContaining('META_ACCESS_TOKEN'),
      });
      // fetch must NOT have been called
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws MetaConfigError when META_USER_ID is empty', async () => {
      const noUserClient = makeClient('some-token', '');
      const fetchMock = mockFetchOk({ data: [] });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(noUserClient.searchHashtag('matcha')).rejects.toThrow(MetaConfigError);
      await expect(noUserClient.searchHashtag('matcha')).rejects.toMatchObject({
        message: expect.stringContaining('META_USER_ID'),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does NOT include the access token in thrown error messages', async () => {
      const errorBody = {
        error: { message: 'Token expired.', type: 'OAuthException', code: 190 },
      };
      globalThis.fetch = mockFetchOk(errorBody, 200) as unknown as typeof fetch;

      try {
        await client.searchHashtag('matcha');
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(MetaApiError);
        expect((err as Error).message).not.toContain('test-token');
      }
    });
  });

  // ── getTopMedia / getRecentMedia ──────────────────────────────────────────

  describe('getTopMedia', () => {
    it('calls the correct endpoint and returns media list', async () => {
      const fakeResponse = { data: [{ id: 'm1', media_type: 'IMAGE' }], paging: {} };
      globalThis.fetch = mockFetchOk(fakeResponse) as unknown as typeof fetch;

      const result = await client.getTopMedia('17841583865247128');

      expect(result).toEqual(fakeResponse);
      const calledUrl = (globalThis.fetch as ReturnType<typeof jest.fn>).mock
        .calls[0]?.[0] as string;
      expect(calledUrl).toContain('17841583865247128/top_media');
    });
  });

  describe('getRecentMedia', () => {
    it('calls the correct endpoint and returns media list', async () => {
      const fakeResponse = { data: [{ id: 'm2', media_type: 'VIDEO' }] };
      globalThis.fetch = mockFetchOk(fakeResponse) as unknown as typeof fetch;

      const result = await client.getRecentMedia('17841583865247128');

      expect(result).toEqual(fakeResponse);
      const calledUrl = (globalThis.fetch as ReturnType<typeof jest.fn>).mock
        .calls[0]?.[0] as string;
      expect(calledUrl).toContain('17841583865247128/recent_media');
    });
  });
});
