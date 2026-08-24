import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.APP_ENV || 'development',
  databaseUrl:
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hashtag-tracking',
  isDev: process.env.APP_ENV !== 'production',
  isProd: process.env.APP_ENV === 'production',
} as const;
