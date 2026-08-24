import { createApp } from './app.js';
import { config } from './config/env.js';
import { pool, checkDatabaseConnection } from './db/connection.js';

const app = createApp();

const server = app.listen(config.port, async () => {
  console.log(`Server running in ${config.nodeEnv} mode on http://localhost:${config.port}`);

  const isDbReady = await checkDatabaseConnection();
  if (isDbReady) {
    console.log('Connected to PostgreSQL database successfully via Drizzle ORM');
  } else {
    console.warn('Warning: Database connection could not be established');
  }
});

// Graceful Shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  server.close(async () => {
    console.log('HTTP server closed.');
    try {
      await pool.end();
      console.log('PostgreSQL connection pool closed.');
      process.exit(0);
    } catch (err) {
      console.error('Error during database teardown:', err);
      process.exit(1);
    }
  });

  // Force close if graceful shutdown hangs
  setTimeout(() => {
    console.error('Forced shutdown after 10s timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
