import type { Media, SyncType, SyncStatus } from '../../db/schema.js';

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
 * Result returned after a media sync execution.
 */
export interface SyncResult {
  syncRunId: string;
  hashtagId: string;
  syncType: SyncType;
  status: SyncStatus;
  itemsFetched: number;
  itemsCreated: number;
  itemsSkipped: number;
  error?: string | null;
}

/**
 * Result returned by batch S3 media upload operations.
 */
export interface BatchUploadResult {
  processed: number;
  uploaded: number;
  failed: number;
}

/**
 * Result returned by individual S3 media asset upload operations.
 */
export interface MediaUploadResult {
  success: boolean;
  mediaId: string;
  storageKey?: string;
}
