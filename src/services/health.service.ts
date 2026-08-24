import { checkDatabaseConnection } from '../db/connection.js';

export async function getHealthStatus() {
  const isDbConnected = await checkDatabaseConnection();

  return {
    status: isDbConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: isDbConnected ? 'connected' : 'disconnected',
    },
  };
}
