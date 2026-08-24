import type { Message } from '@aws-sdk/client-sqs';
import type { SqsService } from '../services/queue/sqs.service.js';
import type { MediaIngestionService } from '../modules/media/media.ingestion.service.js';
import type { HashtagService } from '../modules/hashtags/hashtag.service.js';
import { isHashtagSyncMessage, type HashtagSyncMessage } from '../services/queue/queue.types.js';
import { createLogger } from '../common/logger.js';
import { sanitizeErrorMessage } from '../modules/media/media.ingestion.service.js';

const logger = createLogger('HashtagSyncWorker');

/**
 * Worker responsible for polling SQS and dispatching Instagram hashtag sync jobs.
 */
export class HashtagSyncWorker {
  private isRunning: boolean = false;

  /**
   * @param sqsService - SQS service for receiving and deleting queue messages.
   * @param mediaIngestionService - Service executing media sync and ingestion.
   * @param hashtagService - Service resolving or initializing hashtag records.
   */
  constructor(
    private readonly sqsService: SqsService,
    private readonly mediaIngestionService: MediaIngestionService,
    private readonly hashtagService: HashtagService,
  ) {}

  /**
   * Starts the continuous SQS polling loop.
   */
  public async start(): Promise<void> {
    this.isRunning = true;
    logger.info('SQS Hashtag Sync Worker started.');

    while (this.isRunning) {
      try {
        logger.debug('Polling SQS for messages (WaitTimeSeconds: 20)...');
        const messages = await this.sqsService.receiveMessages({
          maxMessages: 1,
          waitTimeSeconds: 20,
        });

        if (messages.length === 0) {
          logger.debug('No messages in queue during polling cycle. Continuing...');
        }

        for (const message of messages) {
          await this.processMessage(message);
        }
      } catch (err) {
        if (!this.isRunning) break;
        const safeMessage = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
        logger.error(`Error in SQS polling cycle: ${safeMessage}`);

        // Brief delay before retrying polling on unexpected error
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    logger.info('SQS Hashtag Sync Worker stopped gracefully.');
  }

  /**
   * Signals the worker loop to stop.
   */
  public stop(): void {
    logger.info('Stopping SQS Hashtag Sync Worker...');
    this.isRunning = false;
  }

  /**
   * Processes a single SQS message with validation, execution, and conditional deletion.
   *
   * Flow:
   * 1. Validates message JSON against {@link QueueMessage}.
   *    - If unparseable or malformed, deletes it to prevent poison message loops.
   * 2. Resolves hashtag entity via {@link HashtagService.initializeHashtag}.
   * 3. Executes sync via {@link MediaIngestionService.syncMedia}.
   * 4. Deletes SQS message ONLY upon successful execution.
   *    - On failure, message is NOT deleted, allowing SQS visibility timeout / DLQ handling.
   *
   * @param message - The raw SQS message received.
   * @returns `true` if processed and deleted, `false` if failed or skipped.
   */
  public async processMessage(message: Message): Promise<boolean> {
    const messageId = message.MessageId || 'unknown';
    const receiptHandle = message.ReceiptHandle;

    logger.debug(`Received SQS message [id: ${messageId}]`);

    // ── Step 1: Parse and validate message body ───────────────────
    if (!message.Body) {
      logger.warn(`SQS message [id: ${messageId}] has empty body. Deleting poison message.`);
      if (receiptHandle) {
        await this.sqsService.deleteMessage(receiptHandle);
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
        await this.sqsService.deleteMessage(receiptHandle);
      }
      return false;
    }

    if (!isHashtagSyncMessage(parsed)) {
      logger.warn(
        `SQS message [id: ${messageId}] does not conform to HashtagSyncMessage schema. Deleting invalid message.`,
      );
      if (receiptHandle) {
        await this.sqsService.deleteMessage(receiptHandle);
      }
      return false;
    }

    const queueMessage: HashtagSyncMessage = parsed;
    const { type, hashtag: hashtagName } = queueMessage;

    logger.info(`Processing SQS job [id: ${messageId}, type: ${type}, hashtag: "${hashtagName}"]`);

    try {
      // ── Step 2: Resolve / initialize hashtag ──────────────────────
      const hashtag = await this.hashtagService.initializeHashtag(hashtagName);

      // ── Step 3: Execute media sync ────────────────────────────────
      const syncType = type === 'SYNC_TOP_HASHTAG_MEDIA' ? 'TOP' : 'RECENT';
      await this.mediaIngestionService.syncMedia(hashtag.id, syncType);

      logger.info(
        `Job succeeded for hashtag "${hashtagName}" [id: ${messageId}, type: ${type}]. Deleting message from queue.`,
      );

      // ── Step 4: Delete message from SQS on SUCCESS ────────────────
      if (receiptHandle) {
        await this.sqsService.deleteMessage(receiptHandle);
      }

      return true;
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeMessage = sanitizeErrorMessage(rawMessage);

      logger.error(
        `Job failed for hashtag "${hashtagName}" [id: ${messageId}, type: ${type}]: ${safeMessage}. Message left for SQS retry/DLQ.`,
      );

      // DO NOT delete message on error. Let SQS retry or move to DLQ.
      return false;
    }
  }
}

// ----------------------------------------------------------------
// Default singleton wired to production dependencies
// ----------------------------------------------------------------
import { sqsService } from '../services/queue/sqs.service.js';
import { mediaIngestionService } from '../modules/media/media.ingestion.service.js';
import { hashtagService } from '../modules/hashtags/hashtag.service.js';

export const hashtagSyncWorker = new HashtagSyncWorker(
  sqsService,
  mediaIngestionService,
  hashtagService,
);
