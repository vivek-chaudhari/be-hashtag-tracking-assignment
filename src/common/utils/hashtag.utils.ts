/**
 * Normalizes a raw hashtag string for consistent storage and lookup.
 *
 * Rules applied in order:
 * 1. Trim surrounding whitespace.
 * 2. Strip a leading `#` character.
 * 3. Convert to lowercase.
 *
 * @param raw - The raw hashtag input (e.g. " #Matcha ").
 * @returns Normalized hashtag name (e.g. "matcha").
 *
 * @example
 * ```ts
 * normalizeHashtag(' #Matcha '); // → "matcha"
 * normalizeHashtag('MATCHA');    // → "matcha"
 * ```
 */
export function normalizeHashtag(raw: string): string {
  return raw.trim().replace(/^#/, '').toLowerCase();
}

/**
 * Returns `true` if the thrown value is a PostgreSQL unique-constraint violation
 * (error code `23505`).
 *
 * Works with the `pg` driver which attaches a `code` property directly to the
 * Error object.
 *
 * @param err - The caught error value (typed `unknown` for strict safety).
 * @returns Whether the error represents a unique-key violation.
 *
 * @example
 * ```ts
 * try {
 *   await db.insert(table).values(row);
 * } catch (err) {
 *   if (isUniqueViolation(err)) {
 *     // handle gracefully
 *   }
 *   throw err;
 * }
 * ```
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}
