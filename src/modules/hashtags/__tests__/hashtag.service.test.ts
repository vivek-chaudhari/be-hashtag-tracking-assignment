import { describe, it, expect, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import { HashtagService } from '../hashtag.service.js';
import { normalizeHashtag } from '../../../common/utils/hashtag.utils.js';
import type { InstagramClient } from '../../instagram/instagram.client.js';
import { MetaApiError } from '../../instagram/instagram.errors.js';
import type { Hashtag } from '../../../db/schema.js';

// ----------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------

const FAKE_HASHTAG: Hashtag = {
  id: 'uuid-1',
  name: 'matcha',
  metaHashtagId: '17841583865247128',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

// ----------------------------------------------------------------
// Factories
// ----------------------------------------------------------------

function makeClient(overrides: Partial<InstagramClient> = {}): InstagramClient {
  return {
    searchHashtag: jest.fn().mockResolvedValue({ data: [{ id: '17841583865247128' }] }),
    getTopMedia: jest.fn(),
    getRecentMedia: jest.fn(),
    ...overrides,
  } as unknown as InstagramClient;
}

/** Builds a fluent Drizzle db mock. */
function makeDbMock(
  opts: {
    selectResult?: Hashtag[];
    insertResult?: Hashtag[];
    insertThrow?: unknown;
  } = {},
) {
  const db = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(opts.selectResult ?? []),
        }),
      }),
    }),
    insert: opts.insertThrow
      ? jest.fn().mockReturnValue({
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockRejectedValue(opts.insertThrow),
          }),
        })
      : jest.fn().mockReturnValue({
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue(opts.insertResult ?? [FAKE_HASHTAG]),
          }),
        }),
  };
  return db;
}

// ----------------------------------------------------------------
// normalizeHashtag unit tests
// ----------------------------------------------------------------

describe('normalizeHashtag', () => {
  it('strips leading # and lowercases', () => {
    expect(normalizeHashtag('#Matcha')).toBe('matcha');
  });

  it('trims whitespace', () => {
    expect(normalizeHashtag('  matcha  ')).toBe('matcha');
  });

  it('handles # combined with whitespace', () => {
    expect(normalizeHashtag('  #MATCHA  ')).toBe('matcha');
  });

  it('returns empty string for input that is only #', () => {
    expect(normalizeHashtag('#')).toBe('');
  });

  it('leaves already-normalized strings unchanged', () => {
    expect(normalizeHashtag('matcha')).toBe('matcha');
  });
});

// ----------------------------------------------------------------
// HashtagService.initializeHashtag tests
// ----------------------------------------------------------------

describe('HashtagService.initializeHashtag', () => {
  let client: InstagramClient;

  beforeEach(() => {
    client = makeClient();
  });

  // ── creates a new hashtag ──────────────────────────────────────

  it('creates a new hashtag when it does not exist in the database', async () => {
    const db = makeDbMock({ selectResult: [] });
    const service = new HashtagService(client, db as any);

    const result = await service.initializeHashtag('matcha');

    expect(client.searchHashtag).toHaveBeenCalledWith('matcha');
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(result).toEqual(FAKE_HASHTAG);
  });

  // ── returns existing record without calling Meta ───────────────

  it('returns existing hashtag without calling Meta API', async () => {
    const db = makeDbMock({ selectResult: [FAKE_HASHTAG] });
    const service = new HashtagService(client, db as any);

    const result = await service.initializeHashtag('matcha');

    expect(client.searchHashtag).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(result).toEqual(FAKE_HASHTAG);
  });

  // ── normalizes "#matcha" to "matcha" ──────────────────────────

  it('normalizes "#Matcha" to "matcha" before lookup and insert', async () => {
    const db = makeDbMock({ selectResult: [] });
    const service = new HashtagService(client, db as any);

    await service.initializeHashtag('#Matcha');

    // Lookup and insert must both use the normalized name
    expect(client.searchHashtag).toHaveBeenCalledWith('matcha');

    const insertValuesArg = (db.insert as any)().values;
    expect(insertValuesArg).toHaveBeenCalledWith(expect.objectContaining({ name: 'matcha' }));
  });

  // ── rejects empty name after normalization ────────────────────

  it('throws an error if the hashtag name is empty after normalization', async () => {
    const db = makeDbMock();
    const service = new HashtagService(client, db as any);

    await expect(service.initializeHashtag('#')).rejects.toThrow(
      'Hashtag name must not be empty after normalization.',
    );
    expect(client.searchHashtag).not.toHaveBeenCalled();
  });

  // ── handles Meta returning no hashtag ID ──────────────────────

  it('throws MetaApiError when Meta returns no hashtag ID', async () => {
    const noResultClient = makeClient({
      searchHashtag: jest.fn().mockResolvedValue({ data: [] }),
    });
    const db = makeDbMock({ selectResult: [] });
    const service = new HashtagService(noResultClient, db as any);

    await expect(service.initializeHashtag('matcha')).rejects.toThrow(MetaApiError);
    await expect(service.initializeHashtag('matcha')).rejects.toMatchObject({
      message: expect.stringContaining('"matcha"'),
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  // ── race condition / unique violation ─────────────────────────

  it('handles a concurrent-insert race condition by re-fetching the existing row', async () => {
    // Simulate: first SELECT misses, INSERT throws unique-violation,
    // then second SELECT succeeds (the row was inserted by the winner).
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });

    // SELECT: first call returns [], second call (after the race) returns the row
    const selectLimitMock = jest
      .fn()
      .mockResolvedValueOnce([]) // initial lookup → not found
      .mockResolvedValueOnce([FAKE_HASHTAG]); // post-race re-fetch → found

    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: selectLimitMock,
          }),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockRejectedValue(uniqueViolation),
        }),
      }),
    };

    const service = new HashtagService(client, db as any);
    const result = await service.initializeHashtag('matcha');

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(selectLimitMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(FAKE_HASHTAG);
  });

  // ── non-unique DB errors propagate ────────────────────────────

  it('re-throws non-unique-violation database errors', async () => {
    const connectionError = new Error('connection refused');
    const db = makeDbMock({ selectResult: [], insertThrow: connectionError });
    const service = new HashtagService(client, db as any);

    await expect(service.initializeHashtag('matcha')).rejects.toThrow('connection refused');
  });
});
