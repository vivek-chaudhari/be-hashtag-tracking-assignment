import { Router } from 'express';
import { getHashtags } from '../controllers/hashtag.controller.js';

const router = Router();

/**
 * @route GET /hashtags
 * @desc Retrieve paginated media records ordered by createdAt descending
 */
router.get('/', getHashtags);

export default router;
