import { Router } from 'express';
import { adminController } from '../controllers/admin.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Aggregate operational data only - ADMIN-only, never exposed publicly.
router.get('/analytics', authenticate, authorize('ADMIN'), adminController.getAnalytics);
router.get('/activity', authenticate, authorize('ADMIN'), adminController.getActivity);

export default router;
