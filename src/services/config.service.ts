import 'dotenv/config';
import type {
  AwsConfig,
  MetaConfig,
  AppConfig,
} from '../common/interfaces/config-service.interface.js';

export class ConfigService {
  private static instance: ConfigService;

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  /**
   * Generic get method with optional fallback default value
   */
  public get<T = string>(key: string, defaultValue?: T): T {
    const value = process.env[key];
    if (value === undefined || value === '') {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      return '' as unknown as T;
    }
    return value as unknown as T;
  }

  /**
   * Generic get method that throws if key is not defined or empty
   */
  public getOrThrow(key: string): string {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      throw new Error(`Environment variable "${key}" is missing or empty.`);
    }
    return value;
  }

  /**
   * Helper to retrieve integer/number values
   */
  public getNumber(key: string, defaultValue?: number): number {
    const value = process.env[key];
    if (value === undefined || value === '') {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      return 0;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new Error(`Environment variable "${key}" is not a valid number: "${value}".`);
    }
    return parsed;
  }

  /**
   * Helper to retrieve boolean values
   */
  public getBoolean(key: string, defaultValue: boolean = false): boolean {
    const value = process.env[key];
    if (value === undefined || value === '') {
      return defaultValue;
    }
    return value.toLowerCase() === 'true' || value === '1';
  }

  // --- Server / App Environment Getters ---

  public getPort(): number {
    return this.getNumber('PORT', 5000);
  }

  public getAppEnv(): string {
    return this.get('APP_ENV', 'development');
  }

  public isDevelopment(): boolean {
    return this.getAppEnv() === 'development';
  }

  public isProduction(): boolean {
    return this.getAppEnv() === 'production';
  }

  public isTest(): boolean {
    return this.getAppEnv() === 'test';
  }

  // --- Database Getters ---

  public getDatabaseUrl(): string {
    return this.get(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/hashtag-tracking',
    );
  }

  // --- AWS Getters ---

  public getAwsRegion(): string {
    return this.get('AWS_REGION', 'ap-south-1');
  }

  public getAwsS3Bucket(): string {
    return this.get('S3_BUCKET_NAME') || this.get('AWS_S3_BUCKET', '');
  }

  public getAwsSqsQueueUrl(): string {
    return this.get('SQS_QUEUE_URL') || this.get('AWS_SQS_QUEUE_URL', '');
  }

  public getMediaUploadQueueUrl(): string {
    return this.get('MEDIA_UPLOAD_QUEUE_URL') || this.get('AWS_MEDIA_UPLOAD_QUEUE_URL', '');
  }

  public getAwsAccessKey(): string {
    return this.get('AWS_ACCESS_KEY_ID') || this.get('AWS_ACCESS_KEY', '');
  }

  public getAwsSecretKey(): string {
    return this.get('AWS_SECRET_ACCESS_KEY') || this.get('AWS_SECRET_KEY', '');
  }

  public getAwsConfig(): AwsConfig {
    return {
      region: this.getAwsRegion(),
      s3Bucket: this.getAwsS3Bucket(),
      sqsQueueUrl: this.getAwsSqsQueueUrl(),
      mediaUploadQueueUrl: this.getMediaUploadQueueUrl(),
      accessKey: this.getAwsAccessKey(),
      secretKey: this.getAwsSecretKey(),
    };
  }

  // --- Meta (Instagram Graph API) Getters ---

  public getMetaGraphApiVersion(): string {
    return this.get('META_GRAPH_API_VERSION', 'v24.0');
  }

  public getMetaGraphApiBaseUrl(): string {
    return this.get('META_GRAPH_API_BASE_URL', 'https://graph.facebook.com');
  }

  public getMetaUserId(): string {
    return this.get('META_USER_ID', '');
  }

  public getMetaAccessToken(): string {
    return this.get('META_ACCESS_TOKEN', '');
  }

  public getHashtag(): string {
    return this.get('HASHTAG', 'matcha');
  }

  public getMetaConfig(): MetaConfig {
    return {
      graphApiVersion: this.getMetaGraphApiVersion(),
      graphApiBaseUrl: this.getMetaGraphApiBaseUrl(),
      userId: this.getMetaUserId(),
      accessToken: this.getMetaAccessToken(),
      hashtag: this.getHashtag(),
    };
  }

  // --- Complete Config Snapshot ---

  public getAll(): AppConfig {
    return {
      port: this.getPort(),
      appEnv: this.getAppEnv(),
      databaseUrl: this.getDatabaseUrl(),
      aws: this.getAwsConfig(),
      meta: this.getMetaConfig(),
    };
  }
}

export const configService = ConfigService.getInstance();
