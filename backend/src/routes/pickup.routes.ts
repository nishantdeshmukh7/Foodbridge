import { Router } from 'express';
import { body } from 'express-validator';
import { pickupController } from '../controllers/pickup.controller.js';
import { authenticate, authorize, requireApproved } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { pickupMutationLimiter, adminActionLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Get available pickups (public)
router.get('/available', pickupController.getAvailablePickups);

// Get my pickups (volunteer)
router.get('/my-pickups', authenticate, requireApproved, authorize('VOLUNTEER'), pickupController.getMyPickups);

// NOTE: Specific routes must come BEFORE generic :pickupRequestId route

// Admin: assign volunteer
router.post(
  '/:pickupRequestId/assign',
  authenticate,
  adminActionLimiter,
  requireApproved,
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
  pickupMutationLimiter,
  requireApproved,
  authorize('VOLUNTEER'),
  pickupController.acceptPickup
);

// Volunteer: mark as picked up
router.post(
  '/:pickupRequestId/pickup',
  authenticate,
  pickupMutationLimiter,
  requireApproved,
  authorize('VOLUNTEER'),
  pickupController.markPickedUp
);

// Volunteer: complete delivery
router.post(
  '/:pickupRequestId/complete',
  authenticate,
  pickupMutationLimiter,
  requireApproved,
  authorize('VOLUNTEER'),
  validate([
    body('photoUrl').optional().isURL().withMessage('Valid photo URL required'),
  ]),
  pickupController.completeDelivery
);

// Phase 18: there used to be a standalone `POST /` here that let any
// approved NGO create a PickupRequest for an arbitrary donationId with no
// check that the donation was AVAILABLE or that the caller had claimed it.
// Because PickupRequest.donationId is @unique, that could permanently block
// the real claim flow for a donation, and accepting the resulting pickup
// would force ANY donation (including DELIVERED/CANCELLED ones) back to
// CLAIMED - see pickupService.assignPickupToVolunteer's unconditional
// donation update. The route had no legitimate caller (grepped the whole
// frontend and test suite - nothing called it) and has been removed rather
// than patched. The only correct way to create a PickupRequest is
// donationService.claim(), which does so atomically, in the same
// transaction as the AVAILABLE -> CLAIMED check, via
// pickupService.createPickupRequest(donationId, tx) - see donation.service.ts.

// Get pickup by ID - MUST be last. Requires authentication (unlike
// donations, this isn't a public listing) - the controller then checks the
// caller is actually a party to this pickup (donor, claiming NGO, assigned
// volunteer, or Admin) before returning anything.
router.get('/:pickupRequestId', authenticate, pickupController.getById);

export default router;

