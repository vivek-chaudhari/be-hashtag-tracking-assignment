import { describe, it, expect, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import {
  MediaAssetService,
  generateStorageKey,
  getExtensionFromContentType,
} from '../media.asset.service.js';
import type { S3StorageService } from '../../../services/storage/s3.service.js';
import type { Media } from '../../../db/schema.js';

// ----------------------------------------------------------------
// Fixtures & Helpers
// ----------------------------------------------------------------

const FAKE_MEDIA: Media = {
  id: 'media-uuid-1',
  hashtagId: 'hashtag-uuid-1',
  metaMediaId: '17841583865247128',
  mediaType: 'IMAGE',
  caption: 'Sample matcha latte',
  mediaUrl: 'https://scontent.cdninstagram.com/v/img-123.jpg?token=secret123',
  permalink: 'https://instagram.com/p/post-123',
  publishedAt: new Date('2024-01-01T12:00:00Z'),
  likeCount: 50,
  commentsCount: 5,
  storageKey: null,
  storageStatus: 'PENDING',
  createdAt: new Date('2024-01-01T12:00:00Z'),
  updatedAt: new Date('2024-01-01T12:00:00Z'),
};

/** Builds mock S3StorageService. */
function makeS3Mock(overrides: Partial<S3StorageService> = {}): S3StorageService {
  return {
    upload: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as S3StorageService;
}

/** Builds mock Drizzle database for media asset service tests. */
function makeDbMock() {
  const updateSetWhere = jest.fn().mockResolvedValue([]);
  const selectWhereOrderByLimit = jest.fn().mockResolvedValue([FAKE_MEDIA]);

  const db = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            limit: selectWhereOrderByLimit,
          }),
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: updateSetWhere,
      }),
    }),
  };

  return {
    db,
    mocks: {
      updateSetWhere,
      selectWhereOrderByLimit,
    },
  };
}

/** Builds a mock Response for fetch containing a binary image buffer. */
function makeFetchOk(
  content: string = 'fake image binary data',
  contentType: string = 'image/jpeg',
  status: number = 200,
) {
  const buffer = Buffer.from(content);
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: jest.fn().mockImplementation((name: string) => {
        if (name.toLowerCase() === 'content-type') return contentType;
        return null;
      }),
    },
    arrayBuffer: jest.fn().mockResolvedValue(buffer.buffer),
  });
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('MediaAssetService utility functions', () => {
  describe('getExtensionFromContentType', () => {
    it('returns .jpg for image/jpeg and image/jpg', () => {
      expect(getExtensionFromContentType('image/jpeg')).toBe('.jpg');
      expect(getExtensionFromContentType('image/jpg')).toBe('.jpg');
      expect(getExtensionFromContentType('IMAGE/JPEG; charset=utf-8')).toBe('.jpg');
    });

    it('returns .png for image/png', () => {
      expect(getExtensionFromContentType('image/png')).toBe('.png');
    });

    it('returns .webp for image/webp', () => {
      expect(getExtensionFromContentType('image/webp')).toBe('.webp');
    });

    it('returns .mp4 for video/mp4', () => {
      expect(getExtensionFromContentType('video/mp4')).toBe('.mp4');
    });

    it('returns empty string for unknown or undefined MIME types', () => {
      expect(getExtensionFromContentType(undefined)).toBe('');
      expect(getExtensionFromContentType('application/octet-stream')).toBe('');
    });
  });

  describe('generateStorageKey', () => {
    it('generates a deterministic S3 key with correct hashtagId and metaMediaId', () => {
      const key1 = generateStorageKey('hashtag-1', 'meta-100', 'image/jpeg');
      const key2 = generateStorageKey('hashtag-1', 'meta-100', 'image/jpeg');

      expect(key1).toBe('hashtags/hashtag-1/meta-100.jpg');
      expect(key1).toBe(key2); // strictly deterministic
    });
  });
});

describe('MediaAssetService.uploadMediaAsset', () => {
  let s3Mock: S3StorageService;

  beforeEach(() => {
    s3Mock = makeS3Mock();
  });

  // ── 1. Successful download + S3 upload ─────────────────────────

  it('downloads asset from mediaUrl, uploads to S3, and transitions status PENDING -> UPLOADING -> COMPLETED', async () => {
    globalThis.fetch = makeFetchOk('image data', 'image/jpeg') as unknown as typeof fetch;
    const { db } = makeDbMock();

    const service = new MediaAssetService(s3Mock, db as any);
    const result = await service.uploadMediaAsset(FAKE_MEDIA);

    expect(result).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(FAKE_MEDIA.mediaUrl);
    expect(s3Mock.upload).toHaveBeenCalledWith(
      'hashtags/hashtag-uuid-1/17841583865247128.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );

    // Verify status updates: first UPLOADING, then COMPLETED
    expect(db.update).toHaveBeenCalledTimes(2);
    const firstUpdate = (db.update as any)().set.mock.calls[0]?.[0];
    const secondUpdate = (db.update as any)().set.mock.calls[1]?.[0];

    expect(firstUpdate).toMatchObject({ storageStatus: 'UPLOADING' });
    expect(secondUpdate).toMatchObject({
      storageStatus: 'COMPLETED',
      storageKey: 'hashtags/hashtag-uuid-1/17841583865247128.jpg',
    });
  });

  // ── 2. Missing mediaUrl ────────────────────────────────────────

  it('marks storageStatus as FAILED without attempting S3 upload if mediaUrl is missing', async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    const { db } = makeDbMock();
    const mediaWithoutUrl = { ...FAKE_MEDIA, mediaUrl: null };

    const service = new MediaAssetService(s3Mock, db as any);
    const result = await service.uploadMediaAsset(mediaWithoutUrl);

    expect(result).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(s3Mock.upload).not.toHaveBeenCalled();

    expect(db.update).toHaveBeenCalledTimes(1);
    const updateArg = (db.update as any)().set.mock.calls[0]?.[0];
    expect(updateArg).toMatchObject({ storageStatus: 'FAILED' });
  });

  // ── 3. Meta media URL returns HTTP error ───────────────────────

  it('marks storageStatus as FAILED when media download returns non-2xx HTTP status', async () => {
    globalThis.fetch = makeFetchOk('', 'text/html', 404) as unknown as typeof fetch;
    const { db } = makeDbMock();

    const service = new MediaAssetService(s3Mock, db as any);
    const result = await service.uploadMediaAsset(FAKE_MEDIA);

    expect(result).toBe(false);
    expect(s3Mock.upload).not.toHaveBeenCalled();

    // 1st update to UPLOADING, 2nd update to FAILED
    expect(db.update).toHaveBeenCalledTimes(2);
    const secondUpdate = (db.update as any)().set.mock.calls[1]?.[0];
    expect(secondUpdate).toMatchObject({ storageStatus: 'FAILED' });
  });

  // ── 4. S3 upload failure ───────────────────────────────────────

  it('marks storageStatus as FAILED when S3 upload rejects', async () => {
    globalThis.fetch = makeFetchOk('image data', 'image/jpeg') as unknown as typeof fetch;
    s3Mock = makeS3Mock({
      upload: jest.fn().mockRejectedValue(new Error('S3 Connection Timeout')),
    });
    const { db } = makeDbMock();

    const service = new MediaAssetService(s3Mock, db as any);
    const result = await service.uploadMediaAsset(FAKE_MEDIA);

    expect(result).toBe(false);
    expect(db.update).toHaveBeenCalledTimes(2);
    const secondUpdate = (db.update as any)().set.mock.calls[1]?.[0];
    expect(secondUpdate).toMatchObject({ storageStatus: 'FAILED' });
  });

  // ── 5. FAILED -> UPLOADING -> COMPLETED on retry ───────────────

  it('retries previously FAILED media and transitions FAILED -> UPLOADING -> COMPLETED', async () => {
    globalThis.fetch = makeFetchOk('retry image data', 'image/png') as unknown as typeof fetch;
    const { db } = makeDbMock();
    const previouslyFailedMedia: Media = {
      ...FAKE_MEDIA,
      storageStatus: 'FAILED',
      storageKey: null,
    };

    const service = new MediaAssetService(s3Mock, db as any);
    const result = await service.uploadMediaAsset(previouslyFailedMedia);

    expect(result).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(2);
    const firstUpdate = (db.update as any)().set.mock.calls[0]?.[0];
    const secondUpdate = (db.update as any)().set.mock.calls[1]?.[0];

    expect(firstUpdate).toMatchObject({ storageStatus: 'UPLOADING' });
    expect(secondUpdate).toMatchObject({
      storageStatus: 'COMPLETED',
      storageKey: 'hashtags/hashtag-uuid-1/17841583865247128.png',
    });
  });

  // ── 6. COMPLETED media is skipped (Idempotency) ────────────────

  it('skips uploading if media is already COMPLETED and has a storageKey', async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    const { db } = makeDbMock();
    const completedMedia: Media = {
      ...FAKE_MEDIA,
      storageStatus: 'COMPLETED',
      storageKey: 'hashtags/hashtag-uuid-1/17841583865247128.jpg',
    };

    const service = new MediaAssetService(s3Mock, db as any);
    const result = await service.uploadMediaAsset(completedMedia);

    expect(result).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(s3Mock.upload).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  // ── 7. Empty download body (0 bytes) ───────────────────────────

  it('marks storageStatus as FAILED if downloaded binary is 0 bytes', async () => {
    globalThis.fetch = makeFetchOk('', 'image/jpeg', 200) as unknown as typeof fetch;
    const { db } = makeDbMock();

    const service = new MediaAssetService(s3Mock, db as any);
    const result = await service.uploadMediaAsset(FAKE_MEDIA);

    expect(result).toBe(false);
    expect(s3Mock.upload).not.toHaveBeenCalled();
    const secondUpdate = (db.update as any)().set.mock.calls[1]?.[0];
    expect(secondUpdate).toMatchObject({ storageStatus: 'FAILED' });
  });

  // ── 8. Batch uploadPendingMedia ────────────────────────────────

  describe('uploadPendingMedia', () => {
    it('processes batch of pending records and returns summary counts', async () => {
      globalThis.fetch = makeFetchOk('image data', 'image/jpeg') as unknown as typeof fetch;
      const media1 = { ...FAKE_MEDIA, id: 'm1', metaMediaId: 'meta-1' };
      const media2 = { ...FAKE_MEDIA, id: 'm2', metaMediaId: 'meta-2', mediaUrl: null }; // will fail

      const { db, mocks } = makeDbMock();
      mocks.selectWhereOrderByLimit.mockResolvedValue([media1, media2]);

      const service = new MediaAssetService(s3Mock, db as any);
      const summary = await service.uploadPendingMedia(10);

      expect(summary).toEqual({
        processed: 2,
        uploaded: 1,
        failed: 1,
      });
    });
  });
});
