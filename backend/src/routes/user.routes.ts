import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Get all users (admin only)
router.get('/', authenticate, authorize('ADMIN'), userController.getAll);

// Get user stats (admin only)
router.get('/stats', authenticate, authorize('ADMIN'), userController.getStats);

// Get pending approvals (admin only)
router.get('/pending', authenticate, authorize('ADMIN'), userController.getPendingApprovals);

// Get user by ID
router.get('/:id', authenticate, userController.getById);

// Approve user (admin only)
router.post('/:id/approve', authenticate, authorize('ADMIN'), userController.approveUser);

// Reject user (admin only)
router.post('/:id/reject', authenticate, authorize('ADMIN'), userController.rejectUser);

// Suspend user (admin only)
router.post('/:id/suspend', authenticate, authorize('ADMIN'), userController.suspendUser);

// Activate user (admin only)
router.post('/:id/activate', authenticate, authorize('ADMIN'), userController.activateUser);

export default router;

