import { Request, Response, NextFunction } from 'express';
import { configService } from '../../services/config.service.js';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  res.status(statusCode).json({
    message: err.message || 'Internal Server Error',
    ...(configService.isDevelopment() && { stack: err.stack }),
  });
}
