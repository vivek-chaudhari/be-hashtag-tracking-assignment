import type { Request, Response, NextFunction } from 'express';
import { mediaService } from '../../modules/media/media.service.js';

/**
 * Handles GET /hashtags requests.
 * Returns paginated media records sorted by `createdAt` descending.
 *
 * Query parameters:
 * - `page` (default 1, minimum 1)
 * - `limit` (default 20, minimum 1, maximum 100)
 */
export async function getHashtags(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;

    const result = await mediaService.getMedia({ page, limit });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
