/**
 * Supported application log levels.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Optional metadata object attached to log entries.
 */
export type LogMetadata = Record<string, unknown>;
