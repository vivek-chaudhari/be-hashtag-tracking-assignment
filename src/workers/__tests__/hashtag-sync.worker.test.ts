import { describe, it, expect, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import { HashtagSyncWorker } from '../hashtag-sync.worker.js';
import type { SqsService } from '../../services/queue/sqs.service.js';
import type { MediaIngestionService } from '../../modules/media/ingestion.service.js';
import type { HashtagService } from '../../modules/hashtags/hashtag.service.js';
import type { Hashtag } from '../../db/schema.js';
import type { Message } from '@aws-sdk/client-sqs';

// ----------------------------------------------------------------
// Fixtures & Mocks
// ----------------------------------------------------------------

const FAKE_HASHTAG: Hashtag = {
  id: 'hashtag-uuid-1',
  name: 'matcha',
  metaHashtagId: '17841583865247128',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

function makeSqsMock(): SqsService {
  return {
    sendMessage: jest.fn().mockResolvedValue('msg-id-1' as never),
    receiveMessages: jest.fn().mockResolvedValue([] as never),
    deleteMessage: jest.fn().mockResolvedValue(undefined as never),
  } as unknown as SqsService;
}

function makeMediaIngestionMock(): MediaIngestionService {
  return {
    syncMedia: jest.fn().mockResolvedValue({
      syncRunId: 'sr-1',
      hashtagId: FAKE_HASHTAG.id,
      syncType: 'RECENT',
      status: 'COMPLETED',
      itemsFetched: 10,
      itemsCreated: 10,
      itemsSkipped: 0,
    } as never),
  } as unknown as MediaIngestionService;
}

function makeHashtagServiceMock(): HashtagService {
  return {
    initializeHashtag: jest.fn().mockResolvedValue(FAKE_HASHTAG as never),
  } as unknown as HashtagService;
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('HashtagSyncWorker', () => {
  let sqsMock: SqsService;
  let mediaIngestionMock: MediaIngestionService;
  let hashtagServiceMock: HashtagService;
  let worker: HashtagSyncWorker;

  beforeEach(() => {
    sqsMock = makeSqsMock();
    mediaIngestionMock = makeMediaIngestionMock();
    hashtagServiceMock = makeHashtagServiceMock();

    worker = new HashtagSyncWorker(sqsMock, mediaIngestionMock, hashtagServiceMock);
  });

  // ── 1. Process SYNC_RECENT_HASHTAG_MEDIA ──────────────────────

  it('processes valid SYNC_RECENT_HASHTAG_MEDIA and deletes SQS message on success', async () => {
    const sqsMessage: Message = {
      MessageId: 'sqs-msg-1',
      ReceiptHandle: 'receipt-handle-1',
      Body: JSON.stringify({
        type: 'SYNC_RECENT_HASHTAG_MEDIA',
        hashtag: 'matcha',
      }),
    };

    const result = await worker.processMessage(sqsMessage);

    expect(result).toBe(true);
    expect(hashtagServiceMock.initializeHashtag).toHaveBeenCalledWith('matcha');
    expect(mediaIngestionMock.syncMedia).toHaveBeenCalledWith(FAKE_HASHTAG.id, 'RECENT');
    expect(sqsMock.deleteMessage).toHaveBeenCalledWith('receipt-handle-1');
  });

  // ── 2. Process SYNC_TOP_HASHTAG_MEDIA ─────────────────────────

  it('processes valid SYNC_TOP_HASHTAG_MEDIA and calls syncMedia with TOP', async () => {
    const sqsMessage: Message = {
      MessageId: 'sqs-msg-2',
      ReceiptHandle: 'receipt-handle-2',
      Body: JSON.stringify({
        type: 'SYNC_TOP_HASHTAG_MEDIA',
        hashtag: 'matcha',
      }),
    };

    const result = await worker.processMessage(sqsMessage);

    expect(result).toBe(true);
    expect(hashtagServiceMock.initializeHashtag).toHaveBeenCalledWith('matcha');
    expect(mediaIngestionMock.syncMedia).toHaveBeenCalledWith(FAKE_HASHTAG.id, 'TOP');
    expect(sqsMock.deleteMessage).toHaveBeenCalledWith('receipt-handle-2');
  });

  // ── 3. Failed syncMedia does NOT delete message ────────────────

  it('does NOT delete message from SQS when media sync fails, allowing retry/DLQ', async () => {
    (mediaIngestionMock.syncMedia as ReturnType<typeof jest.fn>).mockRejectedValue(
      new Error('Meta Graph API rate limit reached'),
    );

    const sqsMessage: Message = {
      MessageId: 'sqs-msg-3',
      ReceiptHandle: 'receipt-handle-3',
      Body: JSON.stringify({
        type: 'SYNC_RECENT_HASHTAG_MEDIA',
        hashtag: 'matcha',
      }),
    };

    const result = await worker.processMessage(sqsMessage);

    expect(result).toBe(false);
    expect(mediaIngestionMock.syncMedia).toHaveBeenCalled();
    // CRITICAL: message must NOT be deleted so visibility timeout / DLQ applies
    expect(sqsMock.deleteMessage).not.toHaveBeenCalled();
  });

  // ── 4. Failed hashtag resolution does NOT delete message ───────

  it('does NOT delete message if hashtag resolution fails', async () => {
    (hashtagServiceMock.initializeHashtag as ReturnType<typeof jest.fn>).mockRejectedValue(
      new Error('Database connection failed'),
    );

    const sqsMessage: Message = {
      MessageId: 'sqs-msg-4',
      ReceiptHandle: 'receipt-handle-4',
      Body: JSON.stringify({
        type: 'SYNC_RECENT_HASHTAG_MEDIA',
        hashtag: 'matcha',
      }),
    };

    const result = await worker.processMessage(sqsMessage);

    expect(result).toBe(false);
    expect(mediaIngestionMock.syncMedia).not.toHaveBeenCalled();
    expect(sqsMock.deleteMessage).not.toHaveBeenCalled();
  });

  // ── 5. Empty message body handled safely ───────────────────────

  it('deletes poison message when message Body is missing or empty', async () => {
    const emptyMessage: Message = {
      MessageId: 'sqs-msg-empty',
      ReceiptHandle: 'receipt-handle-empty',
      Body: '',
    };

    const result = await worker.processMessage(emptyMessage);

    expect(result).toBe(false);
    expect(hashtagServiceMock.initializeHashtag).not.toHaveBeenCalled();
    expect(sqsMock.deleteMessage).toHaveBeenCalledWith('receipt-handle-empty');
  });

  // ── 6. Unparseable JSON handled safely ─────────────────────────

  it('deletes unparseable non-JSON message to prevent endless error loop', async () => {
    const invalidJsonMessage: Message = {
      MessageId: 'sqs-msg-bad-json',
      ReceiptHandle: 'receipt-handle-bad-json',
      Body: 'NOT_VALID_JSON{::: broken',
    };

    const result = await worker.processMessage(invalidJsonMessage);

    expect(result).toBe(false);
    expect(hashtagServiceMock.initializeHashtag).not.toHaveBeenCalled();
    expect(sqsMock.deleteMessage).toHaveBeenCalledWith('receipt-handle-bad-json');
  });

  // ── 7. Invalid schema payload handled safely ───────────────────

  it('deletes message that does not match QueueMessage schema', async () => {
    const invalidSchemaMessage: Message = {
      MessageId: 'sqs-msg-invalid-schema',
      ReceiptHandle: 'receipt-handle-invalid-schema',
      Body: JSON.stringify({
        unknownAction: 'DO_SOMETHING_ELSE',
      }),
    };

    const result = await worker.processMessage(invalidSchemaMessage);

    expect(result).toBe(false);
    expect(hashtagServiceMock.initializeHashtag).not.toHaveBeenCalled();
    expect(sqsMock.deleteMessage).toHaveBeenCalledWith('receipt-handle-invalid-schema');
  });

  // ── 8. Start and stop loop handling ────────────────────────────

  it('stops polling when stop() is called', async () => {
    const validMessage: Message = {
      MessageId: 'sqs-msg-loop',
      ReceiptHandle: 'rh-loop',
      Body: JSON.stringify({
        type: 'SYNC_RECENT_HASHTAG_MEDIA',
        hashtag: 'matcha',
      }),
    };

    (sqsMock.receiveMessages as ReturnType<typeof jest.fn>).mockImplementation(async () => {
      // After returning one batch, stop the worker
      worker.stop();
      return [validMessage];
    });

    await worker.start();

    expect(sqsMock.receiveMessages).toHaveBeenCalled();
    expect(hashtagServiceMock.initializeHashtag).toHaveBeenCalledWith('matcha');
    expect(sqsMock.deleteMessage).toHaveBeenCalledWith('rh-loop');
  });
});
