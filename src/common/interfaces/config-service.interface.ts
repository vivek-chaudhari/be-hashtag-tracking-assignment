export interface AwsConfig {
  region: string;
  s3Bucket: string;
  sqsQueueUrl: string;
  mediaUploadQueueUrl?: string;
  accessKey: string;
  secretKey: string;
}

export interface MetaConfig {
  graphApiVersion: string;
  graphApiBaseUrl: string;
  userId: string;
  accessToken: string;
  hashtag: string;
}

export interface AppConfig {
  port: number;
  appEnv: string;
  databaseUrl: string;
  aws: AwsConfig;
  meta: MetaConfig;
}
