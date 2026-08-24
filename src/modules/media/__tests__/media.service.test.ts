import { describe, it, expect, jest } from '@jest/globals';
import { MediaService } from '../media.service.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../db/schema.js';

// ----------------------------------------------------------------
// Mock database builder
// ----------------------------------------------------------------
function createMockDb(totalCount = 125, returnedItems: any[] = []) {
  const selectMock = jest.fn().mockImplementation(() => ({
    from: jest.fn().mockImplementation(() => {
      // Return count query result or chain for data query
      return {
        // If it's a count query
        then: (resolve: any) => Promise.resolve([{ count: totalCount }]).then(resolve),
        // If it's a paginated data query
        orderBy: jest.fn().mockReturnValue({
          limit: jest.fn().mockImplementation((limitVal) => ({
            offset: jest.fn().mockImplementation((offsetVal) => {
              return Promise.resolve(
                returnedItems.slice(Number(offsetVal), Number(offsetVal) + Number(limitVal)),
              );
            }),
          })),
        }),
      };
    }),
  }));

  const db = {
    select: selectMock,
  } as unknown as NodePgDatabase<typeof schema>;

  return { db, selectMock };
}

describe('MediaService.getMedia', () => {
  const fakeItems = Array.from({ length: 50 }, (_, i) => ({
    id: `media-id-${i}`,
    metaMediaId: `meta-${i}`,
    caption: `Caption ${i}`,
    mediaType: 'IMAGE',
    mediaUrl: `https://cdn.example.com/img-${i}.jpg`,
    storageStatus: 'COMPLETED',
    createdAt: new Date(`2024-01-01T${String(i % 24).padStart(2, '0')}:00:00Z`),
  }));

  it('uses default page=1 and limit=20 and calculates totalPages accurately', async () => {
    const { db } = createMockDb(125, fakeItems);
    const service = new MediaService(db);

    const result = await service.getMedia();

    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 125,
      totalPages: 7, // Math.ceil(125 / 20) = 7
    });
    expect(result.data.length).toBe(20);
    expect(result.data[0]?.id).toBe('media-id-0');
  });

  it('handles custom page and limit with correct offset and totalPages calculation', async () => {
    const { db } = createMockDb(125, fakeItems);
    const service = new MediaService(db);

    const result = await service.getMedia({ page: 2, limit: 10 });

    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 125,
      totalPages: 13, // Math.ceil(125 / 10) = 13
    });
    expect(result.data.length).toBe(10);
    expect(result.data[0]?.id).toBe('media-id-10');
  });

  it('caps limit at 100 when requested limit exceeds 100', async () => {
    const { db } = createMockDb(250, fakeItems);
    const service = new MediaService(db);

    const result = await service.getMedia({ page: 1, limit: 500 });

    expect(result.pagination.limit).toBe(100);
    expect(result.pagination.totalPages).toBe(3); // Math.ceil(250 / 100) = 3
  });

  it('sanitizes invalid or non-integer page and limit to defaults', async () => {
    const { db } = createMockDb(40, fakeItems);
    const service = new MediaService(db);

    const result = await service.getMedia({ page: -5, limit: 0 });

    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 40,
      totalPages: 2,
    });
  });

  it('returns 0 totalPages when media table is empty (total = 0)', async () => {
    const { db } = createMockDb(0, []);
    const service = new MediaService(db);

    const result = await service.getMedia({ page: 1, limit: 20 });

    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    expect(result.data).toEqual([]);
  });
});
