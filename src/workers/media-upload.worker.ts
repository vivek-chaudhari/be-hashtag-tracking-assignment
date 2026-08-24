import type { Message } from '@aws-sdk/client-sqs';
import type { SqsService } from '../services/queue/sqs.service.js';
import type { MediaUploadService } from '../modules/media/upload.service.js';
import { isUploadMediaMessage, type UploadMediaMessage } from '../common/utils/queue.utils.js';
import { createLogger } from '../common/logger.js';
import { sanitizeErrorMessage } from '../modules/media/ingestion.service.js';
import { configService } from '../services/config.service.js';

const logger = createLogger('MediaUploadWorker');

/**
 * SQS worker polling the media upload queue (`matcha-media-upload`)
 * and processing individual S3 asset uploads.
 */
export class MediaUploadWorker {
  private isRunning: boolean = false;
  private readonly queueUrlFn: () => string;

  /**
   * @param sqsService - SQS communication service.
   * @param mediaUploadService - Service executing media asset upload to S3.
   * @param queueUrlFn - Optional queue URL resolution thunk (defaults to configService.getMediaUploadQueueUrl).
   */
  constructor(
    private readonly sqsService: SqsService,
    private readonly mediaUploadService: MediaUploadService,
    queueUrlFn?: () => string,
  ) {
    this.queueUrlFn = queueUrlFn ?? (() => configService.getMediaUploadQueueUrl());
  }

  /**
   * Starts the continuous SQS polling loop for media uploads.
   */
  public async start(): Promise<void> {
    const queueUrl = this.getQueueUrl();
    this.isRunning = true;
    logger.info('SQS Media Upload Worker started.');

    while (this.isRunning) {
      try {
        logger.debug('Polling SQS media-upload queue (WaitTimeSeconds: 20)...');
        const messages = await this.sqsService.receiveMessages({
          queueUrl,
          maxMessages: 1,
          waitTimeSeconds: 20,
        });

        if (messages.length === 0) {
          logger.debug('No messages in media-upload queue during polling cycle. Continuing...');
        }

        for (const message of messages) {
          await this.processMessage(message);
        }
      } catch (err) {
        if (!this.isRunning) break;
        const safeMessage = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
        logger.error(`Error in SQS media upload polling cycle: ${safeMessage}`);

        // Brief backoff before next poll attempt on network/SQS failure
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    logger.info('SQS Media Upload Worker stopped gracefully.');
  }

  /**
   * Signals the worker loop to stop.
   */
  public stop(): void {
    logger.info('Stopping SQS Media Upload Worker...');
    this.isRunning = false;
  }

  /**
   * Processes a single SQS message with validation, S3 upload execution, and conditional deletion.
   *
   * @param message - The raw SQS message received from the queue.
   * @returns `true` if successfully uploaded and deleted, `false` if failed or skipped.
   */
  public async processMessage(message: Message): Promise<boolean> {
    const messageId = message.MessageId || 'unknown';
    const receiptHandle = message.ReceiptHandle;
    const queueUrl = this.getQueueUrl();

    logger.debug(`Received SQS media-upload message [id: ${messageId}]`);

    // ── Step 1: Validate message payload ──────────────────────────
    if (!message.Body) {
      logger.warn(`SQS message [id: ${messageId}] has empty body. Deleting poison message.`);
      if (receiptHandle) {
        await this.sqsService.deleteMessage(receiptHandle, queueUrl);
      }
      return false;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.Body);
    } catch {
      logger.warn(
        `SQS message [id: ${messageId}] contains invalid JSON. Deleting unparseable message.`,
      );
      if (receiptHandle) {
        await this.sqsService.deleteMessage(receiptHandle, queueUrl);
      }
      return false;
    }

    if (!isUploadMediaMessage(parsed)) {
      logger.warn(
        `SQS message [id: ${messageId}] does not conform to UploadMediaMessage schema. Deleting invalid message.`,
      );
      if (receiptHandle) {
        await this.sqsService.deleteMessage(receiptHandle, queueUrl);
      }
      return false;
    }

    const { mediaId }: UploadMediaMessage = parsed;
    logger.info(`Processing media upload job [id: ${messageId}, mediaId: ${mediaId}]`);

    try {
      // ── Step 2: Upload media asset to S3 ──────────────────────────
      await this.mediaUploadService.uploadMedia(mediaId);

      logger.info(
        `Upload succeeded for mediaId "${mediaId}" [id: ${messageId}]. Deleting message from queue.`,
      );

      // ── Step 3: Delete message from SQS on SUCCESS ────────────────
      if (receiptHandle) {
        await this.sqsService.deleteMessage(receiptHandle, queueUrl);
        logger.debug(`Deleted SQS message [id: ${messageId}]`);
      }

      return true;
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeMessage = sanitizeErrorMessage(rawMessage);

      logger.error(
        `Upload job failed for mediaId "${mediaId}" [id: ${messageId}]: ${safeMessage}. Message retained for SQS retry/DLQ.`,
      );

      // CRITICAL: Do NOT delete message on error. Let SQS retry or move to DLQ.
      return false;
    }
  }

  /**
   * Resolves the queue URL.
   */
  private getQueueUrl(): string {
    const queueUrl = this.queueUrlFn();
    if (!queueUrl || queueUrl.trim() === '') {
      throw new Error('MEDIA_UPLOAD_QUEUE_URL configuration is missing or empty.');
    }
    return queueUrl;
  }
}

// ----------------------------------------------------------------
// Default singleton wired to production dependencies
// ----------------------------------------------------------------
import { sqsService } from '../services/queue/sqs.service.js';
import { mediaUploadService } from '../modules/media/upload.service.js';

export const mediaUploadWorker = new MediaUploadWorker(sqsService, mediaUploadService);
