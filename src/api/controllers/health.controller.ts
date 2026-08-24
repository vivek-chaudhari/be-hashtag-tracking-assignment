import { Request, Response, NextFunction } from 'express';
import { getHealthStatus } from '../../services/health.service.js';

export async function healthCheckController(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const health = await getHealthStatus();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    next(error);
  }
}
