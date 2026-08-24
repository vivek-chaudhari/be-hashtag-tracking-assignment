import { describe, it, expect, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import { SqsService } from '../sqs.service.js';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { QueueMessage } from '../../../common/utils/queue.utils.js';

describe('SqsService', () => {
  let mockSqsClient: { send: ReturnType<typeof jest.fn> };
  let sqsService: SqsService;

  beforeEach(() => {
    mockSqsClient = {
      send: jest.fn().mockResolvedValue({ MessageId: 'msg-123', Messages: [] }),
    };
    sqsService = new SqsService(
      mockSqsClient as unknown as SQSClient,
      () => 'https://sqs.ap-south-1.amazonaws.com/123456789012/matcha-hashtag-sync',
    );
  });

  describe('sendMessage', () => {
    it('sends JSON stringified QueueMessage to SQS and returns MessageId', async () => {
      const message: QueueMessage = {
        type: 'SYNC_RECENT_HASHTAG_MEDIA',
        hashtag: 'matcha',
      };

      const result = await sqsService.sendMessage(message);

      expect(result).toBe('msg-123');
      expect(mockSqsClient.send).toHaveBeenCalledTimes(1);
      const sentCommand = mockSqsClient.send.mock.calls[0]?.[0] as {
        input: { QueueUrl: string; MessageBody: string };
      };

      expect(sentCommand.input).toMatchObject({
        QueueUrl: 'https://sqs.ap-south-1.amazonaws.com/123456789012/matcha-hashtag-sync',
        MessageBody: JSON.stringify(message),
      });
    });

    it('throws an error if SQS queue URL is not configured', async () => {
      const serviceWithoutQueue = new SqsService(mockSqsClient as unknown as SQSClient, () => '');

      await expect(
        serviceWithoutQueue.sendMessage({ type: 'SYNC_RECENT_HASHTAG_MEDIA', hashtag: 'matcha' }),
      ).rejects.toThrow('SQS queue URL configuration is missing or empty.');
      expect(mockSqsClient.send).not.toHaveBeenCalled();
    });
  });

  describe('receiveMessages', () => {
    it('receives messages from SQS with long polling options', async () => {
      const fakeMessages = [
        {
          MessageId: 'm1',
          ReceiptHandle: 'rh-1',
          Body: '{"type":"SYNC_RECENT_HASHTAG_MEDIA","hashtag":"matcha"}',
        },
      ];
      mockSqsClient.send.mockResolvedValue({ Messages: fakeMessages });

      const messages = await sqsService.receiveMessages({ maxMessages: 1, waitTimeSeconds: 20 });

      expect(messages).toEqual(fakeMessages);
      expect(mockSqsClient.send).toHaveBeenCalledTimes(1);
      const receiveCommand = mockSqsClient.send.mock.calls[0]?.[0] as {
        input: { QueueUrl: string; MaxNumberOfMessages: number; WaitTimeSeconds: number };
      };

      expect(receiveCommand.input).toMatchObject({
        QueueUrl: 'https://sqs.ap-south-1.amazonaws.com/123456789012/matcha-hashtag-sync',
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
      });
    });
  });

  describe('deleteMessage', () => {
    it('deletes message from SQS using ReceiptHandle', async () => {
      await sqsService.deleteMessage('rh-12345');

      expect(mockSqsClient.send).toHaveBeenCalledTimes(1);
      const deleteCommand = mockSqsClient.send.mock.calls[0]?.[0] as {
        input: { QueueUrl: string; ReceiptHandle: string };
      };

      expect(deleteCommand.input).toMatchObject({
        QueueUrl: 'https://sqs.ap-south-1.amazonaws.com/123456789012/matcha-hashtag-sync',
        ReceiptHandle: 'rh-12345',
      });
    });
  });
});
