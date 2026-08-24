/**
 * Message payload for triggering a hashtag media sync job.
 */
export type HashtagSyncMessage =
  | {
      type: 'SYNC_RECENT_HASHTAG_MEDIA';
      hashtag: string;
    }
  | {
      type: 'SYNC_TOP_HASHTAG_MEDIA';
      hashtag: string;
    };

/**
 * Message payload for triggering an individual S3 media asset upload.
 */
export type UploadMediaMessage = {
  type: 'UPLOAD_MEDIA';
  mediaId: string;
};

/**
 * Union of all supported SQS message payload types.
 */
export type QueueMessage = HashtagSyncMessage | UploadMediaMessage;

/**
 * Type guard to validate whether an unknown object conforms to {@link HashtagSyncMessage}.
 */
export function isHashtagSyncMessage(value: unknown): value is HashtagSyncMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  const validTypes = ['SYNC_RECENT_HASHTAG_MEDIA', 'SYNC_TOP_HASHTAG_MEDIA'];

  return (
    typeof obj.type === 'string' &&
    validTypes.includes(obj.type) &&
    typeof obj.hashtag === 'string' &&
    obj.hashtag.trim().length > 0
  );
}

/**
 * Type guard to validate whether an unknown object conforms to {@link UploadMediaMessage}.
 */
export function isUploadMediaMessage(value: unknown): value is UploadMediaMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    obj.type === 'UPLOAD_MEDIA' && typeof obj.mediaId === 'string' && obj.mediaId.trim().length > 0
  );
}

/**
 * Type guard to validate whether an unknown object conforms to any {@link QueueMessage}.
 */
export function isQueueMessage(value: unknown): value is QueueMessage {
  return isHashtagSyncMessage(value) || isUploadMediaMessage(value);
}
