import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MediaUploadService, generateMediaStorageKey } from '../media.upload.service.js';
import type { S3StorageService } from '../../../services/storage/s3.service.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../db/schema.js';

// ----------------------------------------------------------------
// Mock database builder
// ----------------------------------------------------------------
function createMockDb(existingMedia: any[] = []) {
  let mediaStore = [...existingMedia];

  const db = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockImplementation(() => {
          return {
            limit: jest.fn().mockImplementation((limitNum) => {
              return Promise.resolve(mediaStore.slice(0, Number(limitNum) || 1));
            }),
          };
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockImplementation((values: any) => ({
        where: jest.fn().mockImplementation(() => {
          // Update matching items in mediaStore
          mediaStore = mediaStore.map((m) => ({ ...m, ...values }));
          return Promise.resolve();
        }),
      })),
    }),
  } as unknown as NodePgDatabase<typeof schema>;

  return { db, getMediaStore: () => mediaStore };
}

describe('generateMediaStorageKey', () => {
  it('generates key with .jpg extension for image/jpeg', () => {
    const key = generateMediaStorageKey('media-123', 'image/jpeg');
    expect(key).toBe('media/media-123.jpg');
  });

  it('generates key with .mp4 extension for video/mp4', () => {
    const key = generateMediaStorageKey('media-456', 'video/mp4');
    expect(key).toBe('media/media-456.mp4');
  });

  it('generates key without extension when contentType is undefined', () => {
    const key = generateMediaStorageKey('media-789');
    expect(key).toBe('media/media-789');
  });
});

describe('MediaUploadService', () => {
  let s3Mock: {
    upload: ReturnType<typeof jest.fn>;
  };

  beforeEach(() => {
    s3Mock = {
      upload: jest.fn().mockResolvedValue(undefined as never),
    };
  });

  it('throws error when media record is not found', async () => {
    const { db } = createMockDb([]);
    const service = new MediaUploadService(s3Mock as unknown as S3StorageService, db);

    await expect(service.uploadMedia('non-existent-id')).rejects.toThrow(
      'Media with ID "non-existent-id" not found.',
    );
    expect(s3Mock.upload).not.toHaveBeenCalled();
  });

  it('skips upload and returns idempotent success when media is already COMPLETED', async () => {
    const existing = [
      {
        id: 'media-comp',
        metaMediaId: 'meta-123',
        mediaUrl: 'https://cdn.instagram.com/image.jpg',
        storageStatus: 'COMPLETED',
        storageKey: 'media/media-comp.jpg',
      },
    ];
    const { db } = createMockDb(existing);
    const service = new MediaUploadService(s3Mock as unknown as S3StorageService, db);

    const result = await service.uploadMedia('media-comp');

    expect(result).toEqual({
      success: true,
      mediaId: 'media-comp',
      storageKey: 'media/media-comp.jpg',
    });
    expect(s3Mock.upload).not.toHaveBeenCalled();
  });

  it('marks media as FAILED and throws error if mediaUrl is missing', async () => {
    const existing = [
      {
        id: 'media-no-url',
        metaMediaId: 'meta-123',
        mediaUrl: null,
        storageStatus: 'PENDING',
        storageKey: null,
      },
    ];
    const { db, getMediaStore } = createMockDb(existing);
    const service = new MediaUploadService(s3Mock as unknown as S3StorageService, db);

    await expect(service.uploadMedia('media-no-url')).rejects.toThrow(
      'Media with ID "media-no-url" has no mediaUrl.',
    );

    const store = getMediaStore();
    expect(store[0]?.storageStatus).toBe('FAILED');
    expect(s3Mock.upload).not.toHaveBeenCalled();
  });

  it('successfully downloads and uploads media, then marks COMPLETED with storageKey', async () => {
    const existing = [
      {
        id: 'media-valid',
        metaMediaId: 'meta-123',
        mediaUrl: 'https://cdn.instagram.com/photo.jpg',
        storageStatus: 'PENDING',
        storageKey: null,
      },
    ];
    const { db, getMediaStore } = createMockDb(existing);
    const service = new MediaUploadService(s3Mock as unknown as S3StorageService, db);

    const fakeImageBuffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: jest.fn().mockResolvedValue(fakeImageBuffer),
    }) as unknown as typeof fetch;

    const result = await service.uploadMedia('media-valid');

    expect(result).toEqual({
      success: true,
      mediaId: 'media-valid',
      storageKey: 'media/media-valid.jpg',
    });

    expect(s3Mock.upload).toHaveBeenCalledWith(
      'media/media-valid.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );

    const store = getMediaStore();
    expect(store[0]?.storageStatus).toBe('COMPLETED');
    expect(store[0]?.storageKey).toBe('media/media-valid.jpg');
  });

  it('marks media as FAILED and rethrows when S3 upload fails', async () => {
    const existing = [
      {
        id: 'media-s3-fail',
        metaMediaId: 'meta-123',
        mediaUrl: 'https://cdn.instagram.com/photo.jpg',
        storageStatus: 'PENDING',
        storageKey: null,
      },
    ];
    const { db, getMediaStore } = createMockDb(existing);
    s3Mock.upload.mockRejectedValue(new Error('S3 Access Denied'));
    const service = new MediaUploadService(s3Mock as unknown as S3StorageService, db);

    const fakeImageBuffer = new Uint8Array([0x01, 0x02]).buffer;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: jest.fn().mockResolvedValue(fakeImageBuffer),
    }) as unknown as typeof fetch;

    await expect(service.uploadMedia('media-s3-fail')).rejects.toThrow('S3 Access Denied');

    const store = getMediaStore();
    expect(store[0]?.storageStatus).toBe('FAILED');
  });

  it('marks media as FAILED when download returns empty buffer', async () => {
    const existing = [
      {
        id: 'media-empty-dl',
        metaMediaId: 'meta-123',
        mediaUrl: 'https://cdn.instagram.com/empty.jpg',
        storageStatus: 'PENDING',
        storageKey: null,
      },
    ];
    const { db, getMediaStore } = createMockDb(existing);
    const service = new MediaUploadService(s3Mock as unknown as S3StorageService, db);

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    }) as unknown as typeof fetch;

    await expect(service.uploadMedia('media-empty-dl')).rejects.toThrow(
      'Downloaded media asset for mediaId "media-empty-dl" is empty (0 bytes).',
    );

    const store = getMediaStore();
    expect(store[0]?.storageStatus).toBe('FAILED');
  });
});
