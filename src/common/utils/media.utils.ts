/**
 * Resolves a deterministic file extension from a MIME content-type header.
 *
 * @param contentType - The raw Content-Type header string.
 * @returns The dot-prefixed file extension or an empty string.
 */
export function getExtensionFromContentType(contentType?: string): string {
  if (!contentType) return '';

  const mime = contentType.toLowerCase().split(';')[0]?.trim();
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'video/mp4':
      return '.mp4';
    case 'video/quicktime':
      return '.mov';
    default:
      return '';
  }
}

/**
 * Generates a deterministic S3 key for a media asset.
 *
 * Pattern: `hashtags/{hashtagId}/{metaMediaId}{extension}`
 *
 * @param hashtagId - The database UUID of the associated hashtag.
 * @param metaMediaId - The Meta media ID.
 * @param contentType - Optional Content-Type header to derive file extension.
 * @returns Deterministic S3 key.
 */
export function generateStorageKey(
  hashtagId: string,
  metaMediaId: string,
  contentType?: string,
): string {
  const ext = getExtensionFromContentType(contentType);
  return `hashtags/${hashtagId}/${metaMediaId}${ext}`;
}
