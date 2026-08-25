import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { getHashtags } from '../hashtag.controller.js';
import { mediaService } from '../../../modules/media/media.service.js';
import { ApiResult } from '../../../common/classes/api-result.class.js';
import { MESSAGES } from '../../../common/constant/message.constant.js';

describe('getHashtags controller', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      query: {},
    };
    res = {
      status: jest.fn().mockReturnThis() as any,
      json: jest.fn().mockReturnThis() as any,
    };
    next = jest.fn();
  });

  it('calls mediaService.getMedia with query params and returns 200 JSON wrapped in ApiResult', async () => {
    req.query = { page: '2', limit: '10' };

    const mockResult = {
      data: [{ id: 'm1' } as any],
      pagination: {
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
      },
    };

    jest.spyOn(mediaService, 'getMedia').mockResolvedValue(mockResult);

    await getHashtags(req as Request, res as Response, next);

    expect(mediaService.getMedia).toHaveBeenCalledWith({ page: 2, limit: 10 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      new ApiResult(MESSAGES.GET_HASHTAG_SUCCESS, undefined, mockResult),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards database errors to next() for Express error middleware handling', async () => {
    const dbError = new Error('Database connection failed');
    jest.spyOn(mediaService, 'getMedia').mockRejectedValue(dbError);

    await getHashtags(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});
