import { Router } from 'express';
import { query } from 'express-validator';
import { UserRole } from '@prisma/client';
import { userController } from '../controllers/user.controller.js';
import { authenticate, authorize, requireSelfOrAdmin } from '../middleware/auth.js';
import { adminActionLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Sourced from the generated Prisma client - always exactly matches the
// real UserRole enum in schema.prisma.
const USER_ROLE_VALUES = Object.values(UserRole);

// Get all users (admin only). Phase 22: previously `role`/`isApproved`/
// `search` were read from req.query with no validation - `role` went
// straight into a Prisma `where.role` filter as whatever string the
// client sent (garbage would reach Prisma's query builder rather than a
// clean 400); `isApproved` silently treated anything other than the exact
// strings "true"/"false" as "no filter" instead of rejecting it; `search`
// had no length bound at all.
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  validate([
    query('role').optional().isIn(USER_ROLE_VALUES).withMessage('Invalid role filter'),
    query('isApproved').optional().isIn(['true', 'false']).withMessage('isApproved must be "true" or "false"'),
    query('search').optional().isString().trim().isLength({ max: 200 }).withMessage('search filter too long'),
  ]),
  userController.getAll
);

// Get user stats (admin only)
router.get('/stats', authenticate, authorize('ADMIN'), userController.getStats);

// Get pending approvals (admin only)
router.get('/pending', authenticate, authorize('ADMIN'), userController.getPendingApprovals);

// Get user by ID - only the user themselves, or an ADMIN, may view a
// profile. Not currently called by any frontend page, but was reachable by
// any authenticated user regardless of role before this guard (the
// discovered IDOR this phase fixes).
router.get('/:id', authenticate, requireSelfOrAdmin(), userController.getById);

// Approve user (admin only)
router.post('/:id/approve', authenticate, adminActionLimiter, authorize('ADMIN'), userController.approveUser);

// Reject user (admin only)
router.post('/:id/reject', authenticate, adminActionLimiter, authorize('ADMIN'), userController.rejectUser);

// Suspend user (admin only)
router.post('/:id/suspend', authenticate, adminActionLimiter, authorize('ADMIN'), userController.suspendUser);

// Activate user (admin only)
router.post('/:id/activate', authenticate, adminActionLimiter, authorize('ADMIN'), userController.activateUser);

export default router;

