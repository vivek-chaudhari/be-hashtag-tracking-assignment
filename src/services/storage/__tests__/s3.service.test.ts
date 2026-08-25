import { describe, it, expect, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import { S3StorageService } from '../s3.service.js';
import type { S3Client } from '@aws-sdk/client-s3';

describe('S3StorageService', () => {
  let mockS3Client: { send: ReturnType<typeof jest.fn> };
  let s3Service: S3StorageService;

  beforeEach(() => {
    mockS3Client = {
      send: jest.fn().mockResolvedValue({} as never),
    };
    s3Service = new S3StorageService(mockS3Client as unknown as S3Client, () => 'test-bucket-name');
  });

  it('uploads a buffer to S3 with correct PutObjectCommand parameters', async () => {
    const buffer = Buffer.from('fake image content');
    await s3Service.upload('hashtags/h1/m1.jpg', buffer, 'image/jpeg');

    expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    const sentCommand = mockS3Client.send.mock.calls[0]?.[0] as {
      input: { Bucket: string; Key: string; Body: Buffer; ContentType?: string };
    };

    expect(sentCommand.input).toMatchObject({
      Bucket: 'test-bucket-name',
      Key: 'hashtags/h1/m1.jpg',
      Body: buffer,
      ContentType: 'image/jpeg',
    });
  });

  it('throws an error if S3 bucket name is missing', async () => {
    const serviceWithoutBucket = new S3StorageService(
      mockS3Client as unknown as S3Client,
      () => '',
    );
    const buffer = Buffer.from('content');

    await expect(serviceWithoutBucket.upload('hashtags/h1/m1.jpg', buffer)).rejects.toThrow(
      'S3_BUCKET_NAME configuration is missing or empty.',
    );
    expect(mockS3Client.send).not.toHaveBeenCalled();
  });

  it('propagates S3 client send errors', async () => {
    mockS3Client.send.mockRejectedValue(new Error('S3 Access Denied'));
    const buffer = Buffer.from('content');

    await expect(s3Service.upload('hashtags/h1/m1.jpg', buffer)).rejects.toThrow(
      'S3 Access Denied',
    );
  });
});
