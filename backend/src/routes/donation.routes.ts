import { Router } from 'express';
import { body, query } from 'express-validator';
import { DonationStatus } from '@prisma/client';
import { donationController } from '../controllers/donation.controller.js';
import { authenticate, optionalAuth, authorize, requireApproved } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { donationMutationLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Sourced from the generated Prisma client, not hand-maintained - always
// exactly matches the real DonationStatus enum in schema.prisma.
const DONATION_STATUS_VALUES = Object.values(DonationStatus);

// Phase 22: the only place a donation's expiry window is ever actually set
// is DonorDashboard's "New Food Listing" form, which computes it as "N
// hours from now" from a fixed dropdown (1/2/4/6/12/24 hours - see
// DonorDashboard.tsx) and sends the resulting absolute ISO timestamp here.
// The API itself accepts a raw absolute timestamp, though, so nothing
// stops a non-UI client from sending an already-past timestamp (a
// donation that's "expired" the instant it's created - meaningless, since
// nothing ever transitions a donation to EXPIRED - see the Phase 22
// report) or an absurd one (a "surplus food" listing expiring in the year
// 2099). 7 days is deliberately far more generous than the UI's real
// 24-hour ceiling - perishable food never legitimately needs a longer
// window, but this avoids coupling the API's own contract too tightly to
// one dropdown's exact current options.
const MAX_EXPIRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isSensibleExpiryTime(value: string): boolean {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false; // defense in depth - isISO8601() above already guards this
  const msFromNow = parsed.getTime() - Date.now();
  return msFromNow > 0 && msFromNow <= MAX_EXPIRY_WINDOW_MS;
}

// Phase 22: previously `?status=` was passed straight into a Prisma
// `where.status` filter with no validation at all (donationService.getAll)
// - a garbage value would reach Prisma's own query builder and produce
// whatever error message that throws, rather than a clean, predictable
// 400. Also closes the one real "client attempts to reference EXPIRED"
// surface that exists today: EXPIRED is a real enum value (nothing writes
// it - see the Phase 22 report on why that's intentional), so filtering by
// it is legitimate and just returns zero rows, but a request for
// `?status=NOT_A_REAL_STATUS` is now cleanly rejected instead of reaching
// the database layer at all.
router.get(
  '/',
  optionalAuth,
  validate([
    query('status').optional().isIn(DONATION_STATUS_VALUES).withMessage('Invalid status filter'),
    query('foodType').optional().isString().trim().isLength({ max: 100 }).withMessage('foodType filter too long'),
    query('location').optional().isString().trim().isLength({ max: 300 }).withMessage('location filter too long'),
  ]),
  donationController.getAll
);
router.get('/stats', donationController.getStats);

// Protected routes
router.get('/my-donations', authenticate, requireApproved, donationController.getMyDonations);

// NGO: my claims, scoped server-side to claimedById = the authenticated
// NGO (Phase 12.5 - see donationService.getByClaimant for why this exists
// as its own endpoint rather than reusing the public getAll()). Phase 22:
// same unvalidated ?status= pass-through gap as the public list route
// above existed here too (donationService.getByClaimant) - found during
// this phase's own security-regression review, fixed the same way.
router.get(
  '/my-claims',
  authenticate,
  requireApproved,
  authorize('NGO'),
  validate([query('status').optional().isIn(DONATION_STATUS_VALUES).withMessage('Invalid status filter')]),
  donationController.getMyClaims
);
// optionalAuth - stays publicly browsable, but donationService.getById()
// uses req.user (when present) to decide whether donor/volunteer contact
// info belongs in the response. See donation.service.ts.
router.get('/:id', optionalAuth, donationController.getById);

// Donor routes
router.post(
  '/',
  authenticate,
  donationMutationLimiter,
  requireApproved,
  authorize('DONOR'),
  validate([
    // .trim() here is a sanitizer, not just a check - express-validator
    // mutates req.body in place, so the trimmed value is what actually
    // reaches the controller/service, not just what gets validated. Never
    // truncates content, only strips leading/trailing whitespace.
    body('foodType')
      .trim()
      .notEmpty()
      .withMessage('Food type required')
      .isLength({ max: 100 })
      .withMessage('Food type must be 100 characters or fewer'),
    body('quantity')
      .trim()
      .notEmpty()
      .withMessage('Quantity required')
      .isLength({ max: 50 })
      .withMessage('Quantity must be 50 characters or fewer'),
    body('expiryTime')
      .isISO8601()
      .withMessage('Valid expiry time required')
      .bail()
      .custom(isSensibleExpiryTime)
      .withMessage('Expiry time must be in the future and no more than 7 days from now'),
    body('pickupLocation')
      .trim()
      .notEmpty()
      .withMessage('Pickup location required')
      .isLength({ max: 300 })
      .withMessage('Pickup location must be 300 characters or fewer'),
    body('description')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Description must be 1000 characters or fewer'),
    body('imageUrl')
      .optional({ values: 'falsy' })
      .trim()
      .isURL()
      .withMessage('Image URL must be a valid URL')
      .isLength({ max: 2000 })
      .withMessage('Image URL is too long'),
    body('isUrgent').optional().isBoolean().withMessage('isUrgent must be true or false'),
  ]),
  donationController.create
);

// Cancel a donation (Phase 12; ADMIN's moderation use of this same
// endpoint is Phase 14). See donationService.cancel for the authoritative
// transition policy - both DONOR (own donation only) and ADMIN may cancel
// AVAILABLE, or CLAIMED while the pickup is still PENDING; once a
// volunteer has accepted, cancellation is rejected for both roles
// (Phase 12.5 - see that phase's report for the inconsistent-state bug
// this closed). Admin cancellations are also recorded to AdminLog.
router.post(
  '/:id/cancel',
  authenticate,
  donationMutationLimiter,
  requireApproved,
  authorize('ADMIN', 'DONOR'),
  donationController.cancel
);

// NGO: release a claim back onto the market (Phase 12). Only the claiming
// NGO, and only while the pickup is still PENDING - see
// donationService.releaseClaim.
router.post(
  '/:id/release',
  authenticate,
  donationMutationLimiter,
  requireApproved,
  authorize('NGO'),
  donationController.releaseClaim
);

// Phase 21: there used to be a `DELETE /:id` here (hard-delete, AVAILABLE
// donations only). Route allowed ADMIN, but donationService.delete() only
// ever checked `donation.donorId !== donorId` - an admin calling it on any
// donation they didn't personally own always got "Not authorized" (fails
// safe, not exploitable, but the advertised admin capability never
// worked). Audited and removed rather than fixed: no frontend page called
// it (its only caller, useDeleteDonation() in src/hooks/useApi.ts, was
// itself dead - that whole hooks file has zero importers anywhere in
// src/pages), no test covered it, and POST /:id/cancel above already
// does everything this endpoint was for and more - it's a soft-delete
// (preserves the row/history instead of hard-deleting it), already has a
// correctly-working admin override, and safely handles both AVAILABLE and
// CLAIMED-with-pending-pickup, not just AVAILABLE. Removing this avoided
// creating a second, competing moderation mechanism alongside cancel().

// NGO: claim donation
router.post(
  '/:id/claim',
  authenticate,
  donationMutationLimiter,
  requireApproved,
  authorize('NGO'),
  donationController.claim
);

export default router;

