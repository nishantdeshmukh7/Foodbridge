import { Router } from 'express';
import { body } from 'express-validator';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  profileUpdateLimiter,
} from '../middleware/rateLimit.js';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../config/index.js';

const router = Router();

// ADMIN is intentionally excluded - public self-registration must never be
// able to create a privileged account. See authService.register for the
// matching server-side (not just validator-level) enforcement, and
// prisma/seed.ts / Prisma Studio for how ADMIN accounts are actually
// provisioned today.
router.post(
  '/register',
  registerLimiter,
  validate([
    body('email').isEmail().withMessage('Valid email required').isLength({ max: 254 }).withMessage('Email is too long'),
    body('password')
      .isLength({ min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })
      .withMessage(`Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`),
    body('name').trim().notEmpty().withMessage('Name required').isLength({ max: 200 }).withMessage('Name is too long'),
    body('role').isIn(['DONOR', 'NGO', 'VOLUNTEER']).withMessage('Valid role required'),
    body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Phone is too long'),
    body('location').optional({ values: 'falsy' }).trim().isLength({ max: 300 }).withMessage('Location is too long'),
    body('organization').optional({ values: 'falsy' }).trim().isLength({ max: 200 }).withMessage('Organization is too long'),
  ]),
  authController.register
);

router.post(
  '/login',
  loginLimiter,
  validate([
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ]),
  authController.login
);

// Phase 13: password recovery. Neither route relies on an authenticated
// session - forgot-password is inherently pre-auth (that's the point),
// and reset-password's only credential is the token itself, never a JWT
// (see authService.resetPassword - the token is looked up on its own,
// with no requirement that the caller be logged in as anyone).
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate([
    body('email').isEmail().withMessage('Valid email required'),
  ]),
  authController.forgotPassword
);

router.post(
  '/reset-password',
  resetPasswordLimiter,
  validate([
    // Deliberately no length bound on the token itself - it's looked up
    // by exact hash match (authService.resetPassword), not parsed or
    // used as a query filter, so an oversized garbage value just fails
    // the lookup cleanly. Bounding it would add nothing.
    body('token').notEmpty().withMessage('Reset token required'),
    body('password')
      .isLength({ min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })
      .withMessage(`Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`),
  ]),
  authController.resetPassword
);

router.get('/profile', authenticate, authController.getProfile);

router.put(
  '/profile',
  authenticate,
  profileUpdateLimiter,
  validate([
    body('name').optional().trim().notEmpty().isLength({ max: 200 }).withMessage('Name is too long'),
    body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Phone is too long'),
    body('location').optional({ values: 'falsy' }).trim().isLength({ max: 300 }).withMessage('Location is too long'),
    body('organization').optional({ values: 'falsy' }).trim().isLength({ max: 200 }).withMessage('Organization is too long'),
  ]),
  authController.updateProfile
);

export default router;
