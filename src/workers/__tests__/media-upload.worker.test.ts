import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MediaUploadWorker } from '../media-upload.worker.js';
import type { SqsService } from '../../services/queue/sqs.service.js';
import type { MediaUploadService } from '../../modules/media/upload.service.js';
import type { Message } from '@aws-sdk/client-sqs';

// ----------------------------------------------------------------
// Fixtures & Mocks
// ----------------------------------------------------------------

const FAKE_QUEUE_URL = 'https://sqs.ap-south-1.amazonaws.com/123456789012/matcha-media-upload';

function makeSqsMock(): SqsService {
  return {
    sendMessage: jest.fn().mockResolvedValue('msg-id-1' as never),
    receiveMessages: jest.fn().mockResolvedValue([] as never),
    deleteMessage: jest.fn().mockResolvedValue(undefined as never),
  } as unknown as SqsService;
}

function makeMediaUploadMock(): MediaUploadService {
  return {
    uploadMedia: jest.fn().mockResolvedValue({
      success: true,
      mediaId: 'media-uuid-1',
      storageKey: 'media/media-uuid-1.jpg',
    } as never),
  } as unknown as MediaUploadService;
}

describe('MediaUploadWorker', () => {
  let sqsMock: SqsService;
  let mediaUploadMock: MediaUploadService;
  let worker: MediaUploadWorker;

  beforeEach(() => {
    sqsMock = makeSqsMock();
    mediaUploadMock = makeMediaUploadMock();
    worker = new MediaUploadWorker(sqsMock, mediaUploadMock, () => FAKE_QUEUE_URL);
  });

  describe('processMessage', () => {
    it('successfully processes a valid UPLOAD_MEDIA message and deletes it from SQS', async () => {
      const message: Message = {
        MessageId: 'sqs-msg-1',
        ReceiptHandle: 'rh-token-1',
        Body: JSON.stringify({
          type: 'UPLOAD_MEDIA',
          mediaId: 'media-uuid-1',
        }),
      };

      const result = await worker.processMessage(message);

      expect(result).toBe(true);
      expect(mediaUploadMock.uploadMedia).toHaveBeenCalledWith('media-uuid-1');
      expect(sqsMock.deleteMessage).toHaveBeenCalledWith('rh-token-1', FAKE_QUEUE_URL);
    });

    it('deletes poison message when body is empty', async () => {
      const message: Message = {
        MessageId: 'sqs-msg-empty',
        ReceiptHandle: 'rh-empty',
        Body: '',
      };

      const result = await worker.processMessage(message);

      expect(result).toBe(false);
      expect(mediaUploadMock.uploadMedia).not.toHaveBeenCalled();
      expect(sqsMock.deleteMessage).toHaveBeenCalledWith('rh-empty', FAKE_QUEUE_URL);
    });

    it('deletes unparseable message when body is invalid JSON', async () => {
      const message: Message = {
        MessageId: 'sqs-msg-bad-json',
        ReceiptHandle: 'rh-bad-json',
        Body: '{ invalid json ]',
      };

      const result = await worker.processMessage(message);

      expect(result).toBe(false);
      expect(mediaUploadMock.uploadMedia).not.toHaveBeenCalled();
      expect(sqsMock.deleteMessage).toHaveBeenCalledWith('rh-bad-json', FAKE_QUEUE_URL);
    });

    it('deletes invalid message when schema does not match UploadMediaMessage', async () => {
      const message: Message = {
        MessageId: 'sqs-msg-bad-schema',
        ReceiptHandle: 'rh-bad-schema',
        Body: JSON.stringify({ type: 'UNKNOWN_TYPE', someId: 123 }),
      };

      const result = await worker.processMessage(message);

      expect(result).toBe(false);
      expect(mediaUploadMock.uploadMedia).not.toHaveBeenCalled();
      expect(sqsMock.deleteMessage).toHaveBeenCalledWith('rh-bad-schema', FAKE_QUEUE_URL);
    });

    it('deletes message if mediaId is empty string', async () => {
      const message: Message = {
        MessageId: 'sqs-msg-empty-id',
        ReceiptHandle: 'rh-empty-id',
        Body: JSON.stringify({ type: 'UPLOAD_MEDIA', mediaId: '   ' }),
      };

      const result = await worker.processMessage(message);

      expect(result).toBe(false);
      expect(mediaUploadMock.uploadMedia).not.toHaveBeenCalled();
      expect(sqsMock.deleteMessage).toHaveBeenCalledWith('rh-empty-id', FAKE_QUEUE_URL);
    });

    it('does NOT delete SQS message when media upload fails, allowing SQS retry/DLQ', async () => {
      (mediaUploadMock.uploadMedia as ReturnType<typeof jest.fn>).mockRejectedValue(
        new Error('S3 Connection Timed Out'),
      );

      const message: Message = {
        MessageId: 'sqs-msg-fail',
        ReceiptHandle: 'rh-fail',
        Body: JSON.stringify({
          type: 'UPLOAD_MEDIA',
          mediaId: 'media-uuid-fail',
        }),
      };

      const result = await worker.processMessage(message);

      expect(result).toBe(false);
      expect(mediaUploadMock.uploadMedia).toHaveBeenCalledWith('media-uuid-fail');
      // SQS deleteMessage must NOT be called on failure!
      expect(sqsMock.deleteMessage).not.toHaveBeenCalled();
    });
  });

  describe('start / stop lifecycle', () => {
    it('stops polling when stop() is called', async () => {
      const message: Message = {
        MessageId: 'sqs-loop-1',
        ReceiptHandle: 'rh-loop-1',
        Body: JSON.stringify({
          type: 'UPLOAD_MEDIA',
          mediaId: 'media-loop-1',
        }),
      };

      (sqsMock.receiveMessages as ReturnType<typeof jest.fn>)
        .mockImplementationOnce(async () => {
          worker.stop();
          return [message];
        })
        .mockResolvedValue([]);

      await worker.start();

      expect(sqsMock.receiveMessages).toHaveBeenCalled();
      expect(mediaUploadMock.uploadMedia).toHaveBeenCalledWith('media-loop-1');
      expect(sqsMock.deleteMessage).toHaveBeenCalledWith('rh-loop-1', FAKE_QUEUE_URL);
    });
  });
});
