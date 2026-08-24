import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { configService } from '../config.service.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('S3StorageService');

/**
 * Service for managing file storage operations on AWS S3.
 */
export class S3StorageService {
  private readonly s3Client: S3Client;
  private readonly bucketNameFn: () => string;

  /**
   * @param s3Client - Optional pre-configured S3Client instance (for testing).
   * @param bucketNameFn - Optional bucket name resolution thunk (for testing).
   */
  constructor(s3Client?: S3Client, bucketNameFn?: () => string) {
    this.bucketNameFn = bucketNameFn ?? (() => configService.getAwsS3Bucket());

    if (s3Client) {
      this.s3Client = s3Client;
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

      this.s3Client = new S3Client(clientConfig);
    }
  }

  /**
   * Uploads a binary buffer to S3 with the given key and optional content type.
   *
   * @param key - The S3 object key.
   * @param body - The binary Buffer to upload.
   * @param contentType - Optional MIME Content-Type.
   * @throws {Error} If the bucket name is missing or the S3 upload fails.
   */
  public async upload(key: string, body: Buffer, contentType?: string): Promise<void> {
    const bucket = this.bucketNameFn();
    if (!bucket) {
      throw new Error('S3_BUCKET_NAME configuration is missing or empty.');
    }

    logger.debug(
      `Uploading asset to S3 [bucket: ${bucket}, key: ${key}, size: ${body.length} bytes]`,
    );

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await this.s3Client.send(command);

    logger.debug(`Successfully uploaded asset to S3 [key: ${key}]`);
  }
}

// ----------------------------------------------------------------
// Default singleton wired to configuration
// ----------------------------------------------------------------
export const s3StorageService = new S3StorageService();
