/**
 * Represents a Meta Graph API error response body.
 */
export interface MetaErrorDetail {
  message: string;
  type?: string;
  code?: number;
  fbtrace_id?: string;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  is_transient?: boolean;
}

/**
 * Wrapper shape that Meta returns on API errors.
 */
export interface MetaErrorBody {
  error: MetaErrorDetail;
}

/**
 * Result of GET /ig_hashtag_search.
 */
export interface HashtagSearchResponse {
  data: Array<{ id: string }>;
}

/**
 * A single media item returned from top_media / recent_media.
 * All fields except `id` are optional because Meta may omit any of them.
 */
export interface MetaMediaItem {
  id: string;
  media_type?: string;
  timestamp?: string;
  permalink?: string;
  media_url?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
}

/**
 * Cursor-based pagination information returned alongside media lists.
 */
export interface MetaCursors {
  before?: string;
  after?: string;
}

/**
 * Paging metadata attached to list responses.
 */
export interface MetaPaging {
  cursors?: MetaCursors;
  next?: string;
  previous?: string;
}

/**
 * Response shape for top_media and recent_media endpoints.
 */
export interface MediaListResponse {
  data: MetaMediaItem[];
  paging?: MetaPaging;
}

/**
 * Options accepted when fetching media from Meta.
 */
export interface FetchMediaOptions {
  /** Number of items per page (default 25). */
  limit?: number;
  /** Comma-separated list of fields to request. */
  fields?: string;
}
