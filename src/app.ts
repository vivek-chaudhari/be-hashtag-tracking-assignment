import express, { Express } from 'express';
import apiRouter from './api/routes/index.js';
import { notFoundHandler } from './api/middlewares/notFoundHandler.js';
import { errorHandler } from './api/middlewares/errorHandler.js';

export function createApp(): Express {
  const app = express();

  // Core Middlewares
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API Routes
  app.use('/api', apiRouter);

  // Error Handling Middlewares
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
