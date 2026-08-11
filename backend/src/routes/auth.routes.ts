import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// ---------------------------------------------------------------------------
// Rate limiting for sensitive auth endpoints
// 10 attempts per 15-minute window per IP address.
// Prevents brute-force login and registration abuse.
// ---------------------------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,   // Return RateLimit-* headers (RFC 6585)
  legacyHeaders: false,     // Disable X-RateLimit-* headers
  message: { error: 'Too many requests from this IP, please try again in 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test', // Don't rate-limit during automated tests
});

router.post(
  '/register',
  authLimiter,
  validate([
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('name').notEmpty().withMessage('Name required'),
    body('role').isIn(['ADMIN', 'DONOR', 'NGO', 'VOLUNTEER']).withMessage('Valid role required'),
  ]),
  authController.register
);

router.post(
  '/login',
  authLimiter,
  validate([
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ]),
  authController.login
);

router.get('/profile', authenticate, authController.getProfile);

router.put(
  '/profile',
  authenticate,
  validate([
    body('name').optional().notEmpty(),
    body('phone').optional(),
    body('location').optional(),
    body('organization').optional(),
  ]),
  authController.updateProfile
);

export default router;

