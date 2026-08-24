import { configService } from '../services/config.service.js';
import type { LogLevel, LogMetadata } from './interfaces/logger.interface.js';

export type { LogLevel, LogMetadata };

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Returns the minimum log level to emit based on APP_ENV.
 * - production → info (suppress debug)
 * - test        → error (suppress everything except errors in test runs)
 * - development → debug (emit everything)
 */
function resolveMinLevel(): LogLevel {
  const env = configService.getAppEnv();
  if (env === 'production') return 'info';
  if (env === 'test') return 'error';
  return 'debug';
}

/**
 * Returns an ISO-8601 UTC timestamp string.
 * @returns Timestamp string.
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Formats a log line.
 *
 * @param level   - Log level label.
 * @param context - The context/module name emitting the log.
 * @param message - The log message.
 * @returns Formatted log string.
 */
function format(level: LogLevel, context: string, message: string): string {
  return `${timestamp()} [${level.toUpperCase().padEnd(5)}] [${context}] ${message}`;
}

/**
 * A lightweight structured logger.
 *
 * Create one per module/class using `createLogger('MyContext')`.
 * Outputs to the appropriate `console` method so log aggregators
 * (e.g., CloudWatch, Datadog) can capture severity correctly.
 *
 * Rules enforced by convention:
 * - NEVER pass secrets (tokens, passwords, keys) as the message or metadata.
 * - NEVER log full URLs that may contain access_token query params.
 */
export class Logger {
  private readonly minLevel: number;

  /**
   * @param context - A short label identifying the module (e.g. "Instagram", "Server").
   */
  constructor(private readonly context: string) {
    this.minLevel = LEVELS[resolveMinLevel()];
  }

  /**
   * Logs a debug-level message. Suppressed in production.
   *
   * @param message  - The log message.
   * @param metadata - Optional additional data to append (must not contain secrets).
   * @returns void
   */
  public debug(message: string, metadata?: unknown): void {
    this.emit('debug', message, metadata);
  }

  /**
   * Logs an info-level message.
   *
   * @param message  - The log message.
   * @param metadata - Optional additional data to append (must not contain secrets).
   * @returns void
   */
  public info(message: string, metadata?: unknown): void {
    this.emit('info', message, metadata);
  }

  /**
   * Logs a warning-level message.
   *
   * @param message  - The log message.
   * @param metadata - Optional additional data to append (must not contain secrets).
   * @returns void
   */
  public warn(message: string, metadata?: unknown): void {
    this.emit('warn', message, metadata);
  }

  /**
   * Logs an error-level message.
   *
   * @param message  - The log message.
   * @param error    - Optional `Error` instance or metadata to append.
   * @returns void
   */
  public error(message: string, error?: unknown): void {
    this.emit('error', message, error);
  }

  // ----------------------------------------------------------------
  // Private
  // ----------------------------------------------------------------

  /**
   * Writes the formatted log line to the appropriate console method.
   *
   * @param level    - Log level.
   * @param message  - Log message.
   * @param metadata - Optional additional context.
   * @returns void
   */
  private emit(level: LogLevel, message: string, metadata?: unknown): void {
    if (LEVELS[level] < this.minLevel) return;

    const line = format(level, this.context, message);

    switch (level) {
      case 'debug':
      case 'info':
        if (metadata !== undefined) {
          console.log(line, metadata);
        } else {
          console.log(line);
        }
        break;
      case 'warn':
        if (metadata !== undefined) {
          console.warn(line, metadata);
        } else {
          console.warn(line);
        }
        break;
      case 'error':
        if (metadata !== undefined) {
          console.error(line, metadata);
        } else {
          console.error(line);
        }
        break;
    }
  }
}

/**
 * Factory function — creates a `Logger` bound to the given context name.
 *
 * @param context - Module or class name to tag log lines with.
 * @returns A new `Logger` instance.
 *
 * @example
 * ```ts
 * const logger = createLogger('InstagramService');
 * logger.info('Hashtag initialized: matcha');
 * // → 2024-01-01T00:00:00.000Z [INFO ] [InstagramService] Hashtag initialized: matcha
 * ```
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}
