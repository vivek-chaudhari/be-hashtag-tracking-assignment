import type { MetaErrorBody } from './instagram.types.js';

/**
 * Thrown whenever the Meta Graph API returns a non-2xx status or an error body.
 * The access token is NEVER included in the message or any property.
 */
export class MetaApiError extends Error {
  /** HTTP status code of the response, if available. */
  public readonly statusCode: number | undefined;

  /** Meta-specific error code from the response body, if available. */
  public readonly metaCode: number | undefined;

  /** Meta's fb trace ID for debugging, if available. */
  public readonly metaFbTraceId: string | undefined;

  /**
   * @param message - Human-readable error description (must NOT contain access tokens).
   * @param statusCode - HTTP status code.
   * @param metaErrorBody - Parsed Meta error body, if available.
   */
  constructor(message: string, statusCode?: number, metaErrorBody?: MetaErrorBody['error']) {
    super(message);
    this.name = 'MetaApiError';
    this.statusCode = statusCode;
    this.metaCode = metaErrorBody?.code;
    this.metaFbTraceId = metaErrorBody?.fbtrace_id;

    // Maintains proper prototype chain in transpiled ES5+
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when required environment variables for Meta integration are missing.
 */
export class MetaConfigError extends Error {
  /**
   * @param variable - The name of the missing environment variable (never its value).
   */
  constructor(variable: string) {
    super(
      `Missing required Meta configuration: environment variable "${variable}" is not set or empty.`,
    );
    this.name = 'MetaConfigError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
