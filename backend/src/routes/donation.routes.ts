import { Router } from 'express';
import { body } from 'express-validator';
import { donationController } from '../controllers/donation.controller.js';
import { authenticate, optionalAuth, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Public routes
router.get('/', optionalAuth, donationController.getAll);
router.get('/stats', donationController.getStats);

// Protected routes
router.get('/my-donations', authenticate, donationController.getMyDonations);
router.get('/:id', donationController.getById);

// Donor routes
router.post(
  '/',
  authenticate,
  authorize('DONOR'),
  validate([
    body('foodType').notEmpty().withMessage('Food type required'),
    body('quantity').notEmpty().withMessage('Quantity required'),
    body('expiryTime').isISO8601().withMessage('Valid expiry time required'),
    body('pickupLocation').notEmpty().withMessage('Pickup location required'),
  ]),
  donationController.create
);

router.put(
  '/:id/status',
  authenticate,
  authorize('ADMIN', 'DONOR'),
  donationController.updateStatus
);

router.delete(
  '/:id',
  authenticate,
  authorize('DONOR', 'ADMIN'),
  donationController.delete
);

// NGO: claim donation
router.post(
  '/:id/claim',
  authenticate,
  authorize('NGO'),
  donationController.claim
);

export default router;

