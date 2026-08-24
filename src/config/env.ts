import { configService } from '../services/config.service.js';

export const config = {
  port: configService.getPort(),
  nodeEnv: configService.getAppEnv(),
  databaseUrl: configService.getDatabaseUrl(),
  isDev: configService.isDevelopment(),
  isProd: configService.isProduction(),
  aws: configService.getAwsConfig(),
  meta: configService.getMetaConfig(),
} as const;

export { configService };
