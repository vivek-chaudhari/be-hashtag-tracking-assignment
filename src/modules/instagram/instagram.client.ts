import type {
  HashtagSearchResponse,
  MediaListResponse,
  MetaErrorBody,
  FetchMediaOptions,
} from './instagram.types.js';
import { MetaApiError, MetaConfigError } from './instagram.errors.js';

/** Default fields requested for media objects. */
const DEFAULT_MEDIA_FIELDS =
  'id,media_type,timestamp,permalink,media_url,caption,like_count,comments_count';

/** Default page size for media requests. */
const DEFAULT_MEDIA_LIMIT = 25;

/**
 * Thin HTTP client for the Meta (Instagram) Graph API.
 * All methods use native `fetch`.
 *
 * Access token and user ID are read lazily from config so that
 * `MetaConfigError` is thrown at call-time rather than at import-time,
 * enabling easier unit testing with environment overrides.
 */
export class InstagramClient {
  private readonly baseUrl: string;

  /**
   * @param accessTokenFn - Thunk that returns the Meta access token.
   * @param userIdFn - Thunk that returns the Meta user ID.
   * @param apiVersion - Graph API version string (e.g. "v24.0").
   */
  constructor(
    private readonly accessTokenFn: () => string,
    private readonly userIdFn: () => string,
    apiVersion: string = 'v24.0',
    apiUrl: string = 'https://graph.facebook.com',
  ) {
    this.baseUrl = `${apiUrl}/${apiVersion}`;
  }

  // ----------------------------------------------------------------
  // Public API methods
  // ----------------------------------------------------------------

  /**
   * Search for a hashtag by name and return the Meta hashtag ID.
   *
   * @param query - The hashtag to search for (without leading `#`).
   * @returns Parsed hashtag search response containing the Meta hashtag ID.
   * @throws {MetaConfigError} If access token or user ID is missing.
   * @throws {MetaApiError} If the API returns an error or non-2xx status.
   */
  public async searchHashtag(query: string): Promise<HashtagSearchResponse> {
    const params: Record<string, string> = {
      user_id: this.requireUserId(),
      q: query,
    };

    return this.request<HashtagSearchResponse>(`${this.baseUrl}/ig_hashtag_search`, params);
  }

  /**
   * Fetch the top media for a given hashtag.
   *
   * @param hashtagId - The Meta hashtag ID (from `searchHashtag`).
   * @param options - Optional pagination / field overrides.
   * @returns The first page of top media items with paging info.
   * @throws {MetaConfigError} If access token or user ID is missing.
   * @throws {MetaApiError} If the API returns an error or non-2xx status.
   */
  public async getTopMedia(
    hashtagId: string,
    options: FetchMediaOptions = {},
  ): Promise<MediaListResponse> {
    const params: Record<string, string> = {
      user_id: this.requireUserId(),
      fields: options.fields ?? DEFAULT_MEDIA_FIELDS,
      limit: String(options.limit ?? DEFAULT_MEDIA_LIMIT),
    };

    return this.request<MediaListResponse>(`${this.baseUrl}/${hashtagId}/top_media`, params);
  }

  /**
   * Fetch the most recent media for a given hashtag.
   *
   * @param hashtagId - The Meta hashtag ID (from `searchHashtag`).
   * @param options - Optional pagination / field overrides.
   * @returns The first page of recent media items with paging info.
   * @throws {MetaConfigError} If access token or user ID is missing.
   * @throws {MetaApiError} If the API returns an error or non-2xx status.
   */
  public async getRecentMedia(
    hashtagId: string,
    options: FetchMediaOptions = {},
  ): Promise<MediaListResponse> {
    const params: Record<string, string> = {
      user_id: this.requireUserId(),
      fields: options.fields ?? DEFAULT_MEDIA_FIELDS,
      limit: String(options.limit ?? DEFAULT_MEDIA_LIMIT),
    };

    return this.request<MediaListResponse>(`${this.baseUrl}/${hashtagId}/recent_media`, params);
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  /**
   * Core HTTP fetch wrapper. Appends `access_token` as a query parameter,
   * parses the response as JSON, and surfaces Meta API errors as `MetaApiError`.
   *
   * The full URL (which contains the token) is NEVER included in thrown errors.
   *
   * @param baseEndpoint - The endpoint URL without query parameters.
   * @param params - Query parameters to append (access_token is added internally).
   * @returns Parsed JSON response body typed as T.
   * @throws {MetaApiError} On HTTP errors or Meta error response bodies.
   */
  private async request<T>(baseEndpoint: string, params: Record<string, string>): Promise<T> {
    const accessToken = this.requireAccessToken();

    const url = new URL(baseEndpoint);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    // Append token last so it doesn't appear in params we log
    url.searchParams.set('access_token', accessToken);

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch (networkError) {
      throw new MetaApiError(
        `Network error calling Meta API endpoint "${baseEndpoint}": ${String(networkError)}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new MetaApiError(
        `Meta API returned a non-JSON response for endpoint "${baseEndpoint}" (HTTP ${response.status}).`,
        response.status,
      );
    }

    // Meta may return HTTP 200 with an error body — check for it first
    if (isMetaErrorBody(body)) {
      throw new MetaApiError(
        `Meta API error [${body.error.type}]: ${body.error.message}`,
        response.status,
        body.error,
      );
    }

    if (!response.ok) {
      throw new MetaApiError(
        `Meta API returned HTTP ${response.status} for endpoint "${baseEndpoint}".`,
        response.status,
      );
    }

    return body as T;
  }

  /**
   * Returns the access token or throws `MetaConfigError`.
   * @returns The Meta access token string.
   * @throws {MetaConfigError} If token is empty or not configured.
   */
  private requireAccessToken(): string {
    const token = this.accessTokenFn();
    if (!token) {
      throw new MetaConfigError('META_ACCESS_TOKEN');
    }
    return token;
  }

  /**
   * Returns the Meta user ID or throws `MetaConfigError`.
   * @returns The Meta user ID string.
   * @throws {MetaConfigError} If user ID is empty or not configured.
   */
  private requireUserId(): string {
    const userId = this.userIdFn();
    if (!userId) {
      throw new MetaConfigError('META_USER_ID');
    }
    return userId;
  }
}

// ----------------------------------------------------------------
// Type guard
// ----------------------------------------------------------------

/**
 * Type guard to check if an unknown value is a Meta error response body.
 *
 * @param value - The value to check.
 * @returns True if the value matches the MetaErrorBody shape.
 */
function isMetaErrorBody(value: unknown): value is MetaErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as MetaErrorBody).error === 'object'
  );
}

// ----------------------------------------------------------------
// Default singleton wired to configService
// ----------------------------------------------------------------
import { configService } from '../../services/config.service.js';

export const instagramClient = new InstagramClient(
  () => configService.getMetaAccessToken(),
  () => configService.getMetaUserId(),
  configService.getMetaGraphApiVersion(),
  configService.getMetaGraphApiBaseUrl(),
);
