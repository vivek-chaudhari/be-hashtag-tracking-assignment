import { mediaUploadWorker } from './media-upload.worker.js';
import { createLogger } from '../common/logger.js';
import { pool, checkDatabaseConnection } from '../db/connection.js';

const logger = createLogger('MediaUploadWorkerBootstrap');

async function bootstrap() {
  logger.info('Checking database connection before starting Media Upload Worker...');
  const isDbReady = await checkDatabaseConnection();
  if (!isDbReady) {
    logger.warn(
      'Warning: Database connection could not be established. Worker will still attempt to run.',
    );
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down Media Upload Worker gracefully...`);
    mediaUploadWorker.stop();

    try {
      await pool.end();
      logger.info('Database pool closed.');
    } catch (err) {
      logger.error('Error closing database pool during shutdown', err);
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start polling media upload queue
  await mediaUploadWorker.start();
}

bootstrap().catch((err) => {
  logger.error('Fatal error starting Media Upload Worker bootstrap', err);
  process.exit(1);
});
