import { Router } from 'express';
import { body } from 'express-validator';
import { pickupController } from '../controllers/pickup.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Get available pickups (public)
router.get('/available', pickupController.getAvailablePickups);

// Get my pickups (volunteer)
router.get('/my-pickups', authenticate, authorize('VOLUNTEER'), pickupController.getMyPickups);

// NOTE: Specific routes must come BEFORE generic :pickupRequestId route

// Admin: assign volunteer
router.post(
  '/:pickupRequestId/assign',
  authenticate,
  authorize('ADMIN'),
  validate([
    body('volunteerId').notEmpty().withMessage('Volunteer ID required'),
  ]),
  pickupController.assignVolunteer
);

// Volunteer: accept pickup
router.post(
  '/:pickupRequestId/accept',
  authenticate,
  authorize('VOLUNTEER'),
  pickupController.acceptPickup
);

// Volunteer: mark as picked up
router.post(
  '/:pickupRequestId/pickup',
  authenticate,
  authorize('VOLUNTEER'),
  pickupController.markPickedUp
);

// Volunteer: complete delivery
router.post(
  '/:pickupRequestId/complete',
  authenticate,
  authorize('VOLUNTEER'),
  validate([
    body('photoUrl').optional().isURL().withMessage('Valid photo URL required'),
  ]),
  pickupController.completeDelivery
);

// Create pickup request
router.post(
  '/',
  authenticate,
  authorize('NGO'),
  validate([
    body('donationId').notEmpty().withMessage('Donation ID required'),
  ]),
  pickupController.createPickupRequest
);

// Get pickup by ID - MUST be last
router.get('/:pickupRequestId', pickupController.getById);

export default router;

