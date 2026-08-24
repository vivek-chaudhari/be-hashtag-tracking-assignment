import { describe, it, expect } from '@jest/globals';
import { jest } from '@jest/globals';
import { InstagramService } from '../instagram.service.js';
import { InstagramClient } from '../instagram.client.js';
import { MetaApiError } from '../instagram.errors.js';
import type { Hashtag } from '../../../db/schema.js';

// ---------------------------------------------------------------------------
// Helpers & fixtures
// ---------------------------------------------------------------------------

const FAKE_HASHTAG: Hashtag = {
  id: 'db-uuid-1',
  name: 'matcha',
  metaHashtagId: '17841583865247128',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

/** Creates a minimal mock of InstagramClient with overridable methods. */
function makeClientMock(overrides: Partial<InstagramClient> = {}): InstagramClient {
  return {
    searchHashtag: jest.fn().mockResolvedValue({ data: [{ id: '17841583865247128' }] }),
    getTopMedia: jest.fn(),
    getRecentMedia: jest.fn(),
    ...overrides,
  } as unknown as InstagramClient;
}

/** Creates a minimal mock Drizzle db whose builder chain is fluent. */
function makeDbMock() {
  const db = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  };
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstagramService.initializeHashtag', () => {
  // ── successful first-time initialization ──────────────────────────────────

  it('inserts a new hashtag when it does not exist and returns the record', async () => {
    const client = makeClientMock();
    const db = makeDbMock();

    // SELECT returns empty → hashtag doesn't exist yet
    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    // INSERT returns the new record
    db.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([FAKE_HASHTAG]),
      }),
    });

    const service = new InstagramService(client, db as any);
    const result = await service.initializeHashtag('matcha');

    expect(client.searchHashtag).toHaveBeenCalledWith('matcha');
    expect(db.insert).toHaveBeenCalled();
    expect(result).toEqual(FAKE_HASHTAG);
  });

  // ── idempotent second call ─────────────────────────────────────────────────

  it('returns the existing record without inserting when hashtag already exists', async () => {
    const client = makeClientMock();
    const db = makeDbMock();

    // SELECT returns the existing hashtag with matching metaHashtagId
    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([FAKE_HASHTAG]),
        }),
      }),
    });

    const service = new InstagramService(client, db as any);
    const result = await service.initializeHashtag('matcha');

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(result).toEqual(FAKE_HASHTAG);
  });

  // ── Meta hashtag ID drift ─────────────────────────────────────────────────

  it('updates the meta hashtag ID when it has drifted from the stored value', async () => {
    const newMetaId = '99999999999999';
    const client = makeClientMock({
      searchHashtag: jest.fn().mockResolvedValue({ data: [{ id: newMetaId }] }),
    });
    const db = makeDbMock();

    // SELECT returns the existing hashtag with the OLD metaHashtagId
    const existingWithOldId: Hashtag = { ...FAKE_HASHTAG, metaHashtagId: 'old-meta-id' };
    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([existingWithOldId]),
        }),
      }),
    });

    // UPDATE returns the refreshed record
    const updatedHashtag: Hashtag = { ...existingWithOldId, metaHashtagId: newMetaId };
    db.update.mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([updatedHashtag]),
        }),
      }),
    });

    const service = new InstagramService(client, db as any);
    const result = await service.initializeHashtag('matcha');

    expect(db.update).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(result.metaHashtagId).toBe(newMetaId);
  });

  // ── Meta returns no hashtag ID ─────────────────────────────────────────────

  it('throws MetaApiError when Meta API returns no hashtag ID', async () => {
    const client = makeClientMock({
      searchHashtag: jest.fn().mockResolvedValue({ data: [] }),
    });
    const db = makeDbMock();

    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    const service = new InstagramService(client, db as any);

    await expect(service.initializeHashtag('matcha')).rejects.toThrow(MetaApiError);
    await expect(service.initializeHashtag('matcha')).rejects.toMatchObject({
      message: expect.stringContaining('"matcha"'),
    });
  });

  // ── duplicate-safe initialization ─────────────────────────────────────────

  it('does not insert a duplicate when SELECT finds an exact match', async () => {
    const client = makeClientMock();
    const db = makeDbMock();

    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([FAKE_HASHTAG]),
        }),
      }),
    });

    const service = new InstagramService(client, db as any);

    const result1 = await service.initializeHashtag('matcha');
    const result2 = await service.initializeHashtag('matcha');

    expect(db.insert).not.toHaveBeenCalled();
    expect(result1).toEqual(FAKE_HASHTAG);
    expect(result2).toEqual(FAKE_HASHTAG);
  });

  // ── Meta API failure propagates ───────────────────────────────────────────

  it('propagates MetaApiError thrown by the client', async () => {
    const apiError = new MetaApiError('Rate limit exceeded', 429);
    const client = makeClientMock({
      searchHashtag: jest.fn().mockRejectedValue(apiError),
    });
    const db = makeDbMock();

    const service = new InstagramService(client, db as any);

    await expect(service.initializeHashtag('matcha')).rejects.toThrow(MetaApiError);
    await expect(service.initializeHashtag('matcha')).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
