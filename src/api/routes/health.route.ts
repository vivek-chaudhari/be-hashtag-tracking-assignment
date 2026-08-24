import { Router } from 'express';
import { healthCheckController } from '../controllers/health.controller.js';

const router = Router();

router.get('/', healthCheckController);

export default router;
