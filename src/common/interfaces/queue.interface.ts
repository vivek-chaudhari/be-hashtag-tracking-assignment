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
