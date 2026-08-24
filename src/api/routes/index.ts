import { Router } from 'express';
import hashtagRouter from './hashtag.route.js';

const router = Router();

router.use('/hashtags', hashtagRouter);

export default router;
