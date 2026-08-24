import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { configService } from '../config.service.js';
import type { QueueMessage } from '../../common/utils/queue.utils.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('SqsService');

/**
 * Service for interacting with Amazon SQS.
 */
export class SqsService {
  private readonly sqsClient: SQSClient;
  private readonly defaultQueueUrlFn: () => string;

  /**
   * @param sqsClient - Optional SQSClient instance (for testing).
   * @param defaultQueueUrlFn - Optional default queue URL resolution thunk (for testing).
   */
  constructor(sqsClient?: SQSClient, defaultQueueUrlFn?: () => string) {
    this.defaultQueueUrlFn = defaultQueueUrlFn ?? (() => configService.getAwsSqsQueueUrl());

    if (sqsClient) {
      this.sqsClient = sqsClient;
    } else {
      const region = configService.getAwsRegion();
      const accessKeyId = configService.getAwsAccessKey();
      const secretAccessKey = configService.getAwsSecretKey();

      const clientConfig: {
        region: string;
        credentials?: { accessKeyId: string; secretAccessKey: string };
      } = { region };

      if (accessKeyId && secretAccessKey) {
        clientConfig.credentials = { accessKeyId, secretAccessKey };
      }

      this.sqsClient = new SQSClient(clientConfig);
    }
  }

  /**
   * Sends a typed JSON payload to an SQS queue.
   *
   * @param message - The {@link QueueMessage} to enqueue.
   * @param queueUrlOverride - Optional target queue URL override.
   * @returns The SQS MessageId.
   * @throws {Error} If queue URL is missing or SQS send fails.
   */
  public async sendMessage(message: QueueMessage, queueUrlOverride?: string): Promise<string> {
    const queueUrl = this.getQueueUrl(queueUrlOverride);
    const identifier =
      'mediaId' in message ? `mediaId: ${message.mediaId}` : `hashtag: ${message.hashtag}`;
    logger.debug(`Sending message [type: ${message.type}, ${identifier}] to SQS`);

    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    });

    const response = await this.sqsClient.send(command);
    logger.info(`Message sent to SQS [type: ${message.type}, messageId: ${response.MessageId}]`);

    return response.MessageId ?? '';
  }

  /**
   * Polls SQS for messages using long polling.
   *
   * @param options - Configuration options for message retrieval.
   * @returns Array of received {@link Message} objects.
   */
  public async receiveMessages(
    options: {
      queueUrl?: string;
      maxMessages?: number;
      waitTimeSeconds?: number;
    } = {},
  ): Promise<Message[]> {
    const queueUrl = this.getQueueUrl(options.queueUrl);
    const maxMessages = options.maxMessages ?? 1;
    const waitTimeSeconds = options.waitTimeSeconds ?? 20;

    const command = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: waitTimeSeconds,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    });

    const response = await this.sqsClient.send(command);
    return response.Messages ?? [];
  }

  /**
   * Deletes a processed message from SQS using its receipt handle.
   *
   * @param receiptHandle - The receipt handle of the message to delete.
   * @param queueUrlOverride - Optional target queue URL override.
   */
  public async deleteMessage(receiptHandle: string, queueUrlOverride?: string): Promise<void> {
    const queueUrl = this.getQueueUrl(queueUrlOverride);
    logger.debug('Deleting processed message from SQS queue.');

    const command = new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    });

    await this.sqsClient.send(command);
    logger.debug('Successfully deleted message from SQS.');
  }

  /**
   * Retrieves and validates the queue URL.
   */
  private getQueueUrl(queueUrlOverride?: string): string {
    const queueUrl = queueUrlOverride || this.defaultQueueUrlFn();
    if (!queueUrl || queueUrl.trim() === '') {
      throw new Error('SQS queue URL configuration is missing or empty.');
    }
    return queueUrl;
  }
}

// ----------------------------------------------------------------
// Default singleton wired to configuration
// ----------------------------------------------------------------
export const sqsService = new SqsService();
