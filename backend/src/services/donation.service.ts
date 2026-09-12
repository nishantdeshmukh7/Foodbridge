import { DonationStatus } from '@prisma/client';
import prisma from '../models/prisma.js';
import { pickupService } from './pickup.service.js';
import { notificationService } from './notification.service.js';

export interface CreateDonationData {
  foodType: string;
  quantity: string;
  description?: string;
  expiryTime: Date;
  pickupLocation: string;
  imageUrl?: string;
  isUrgent?: boolean;
}

// Single authoritative Donation lifecycle. Each transition is owned by one
// specific operation - this map documents all of them, even though only
// "-> CANCELLED" and "-> AVAILABLE" (from CLAIMED) are actually driven
// through a generic status value (see cancel()/releaseClaim() below). The
// others are enforced by their own dedicated, role-specific functions and
// are listed here for reference:
//   AVAILABLE  -> CLAIMED    : donationService.claim()        (NGO)
//   CLAIMED    -> PICKED_UP  : pickupService.markPickedUp()   (VOLUNTEER)
//   PICKED_UP  -> DELIVERED  : pickupService.completeDelivery() (VOLUNTEER)
//   AVAILABLE/CLAIMED -> CANCELLED : donationService.cancel() (DONOR/ADMIN)
//   CLAIMED -> AVAILABLE     : donationService.releaseClaim() (NGO, Phase 12)
// DELIVERED, CANCELLED and EXPIRED are terminal - nothing transitions out of
// them. EXPIRED has no writer yet (no automatic expiry sweep exists).
const DONATION_TRANSITIONS: Record<DonationStatus, DonationStatus[]> = {
  AVAILABLE: ['CLAIMED', 'CANCELLED'],
  CLAIMED: ['PICKED_UP', 'CANCELLED', 'AVAILABLE'],
  PICKED_UP: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  EXPIRED: [],
};

// Contact-visibility policy (Phase 31 - closes a P2 finding from the
// Phase 30 independent audit). A donor's phone number requires an actual
// relationship to THIS SPECIFIC donation:
//   - the donor themselves
//   - the NGO that currently holds this donation's claim (not any NGO)
//   - the volunteer assigned to this donation's pickup
//   - ADMIN
// The prior policy (Phase 7) granted phone visibility to any approved
// NGO regardless of claim relationship, reasoned as supporting a
// "contact the donor before claiming" feature. Verified (Phase 31 audit,
// same as Phase 30's finding): nothing in this codebase or its frontend
// actually reads a donor's phone off a donation the caller hasn't
// claimed - narrowing to the claiming NGO only closes real, unnecessary
// PII exposure with no loss of any existing, working feature.
// Anonymous callers, and any authenticated user with no relationship to
// this donation (an unrelated donor/NGO/volunteer, or a pending/rejected/
// suspended NGO whose token still reaches optionalAuth-gated routes),
// never see it - `requestingUser` is only ever a currently-active,
// already-authenticated identity by the time it reaches here (see
// middleware/auth.ts), but that alone is not a relationship.
function canSeeDonorPhone(
  donation: {
    donorId: string;
    claimedById: string | null;
    pickupRequest?: { volunteerId: string | null } | null;
  },
  requestingUser?: { id: string; role: string }
): boolean {
  if (!requestingUser) {
    return false;
  }
  if (requestingUser.role === 'ADMIN') {
    return true;
  }
  if (requestingUser.id === donation.donorId) {
    return true;
  }
  if (donation.claimedById && requestingUser.id === donation.claimedById) {
    return true;
  }
  if (donation.pickupRequest?.volunteerId && requestingUser.id === donation.pickupRequest.volunteerId) {
    return true;
  }
  return false;
}

export const donationService = {
  async create(donorId: string, data: CreateDonationData) {
    const donation = await prisma.donation.create({
      data: {
        foodType: data.foodType,
        quantity: data.quantity,
        description: data.description,
        expiryTime: data.expiryTime,
        pickupLocation: data.pickupLocation,
        imageUrl: data.imageUrl,
        isUrgent: data.isUrgent || false,
        donorId,
      },
      include: {
        donor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            location: true,
            organization: true,
          },
        },
      },
    });

    return donation;
  },

  async getAll(
    filters?: { status?: string; foodType?: string; location?: string },
    requestingUser?: { id: string; role: string }
  ) {
    const where: Record<string, unknown> = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.foodType) {
      where.foodType = { contains: filters.foodType, mode: 'insensitive' };
    }

    const donations = await prisma.donation.findMany({
      where,
      include: {
        donor: {
          select: {
            id: true,
            name: true,
            organization: true,
            location: true,
            phone: true,
          },
        },
        claimedBy: {
          select: {
            id: true,
            name: true,
            organization: true,
          },
        },
        // Phase 12: the NGO claims list needs to know whether a volunteer
        // is already involved, to decide whether "Release Claim" is
        // offered - deliberately not selecting the volunteer's own PII
        // here, since this list-level query has no per-donation
        // relationship check the way getById() does.
        pickupRequest: {
          select: {
            id: true,
            status: true,
            volunteerId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Per-donation, not list-wide: each row can have a different claimant
    // (or none), so whether phone is redacted is decided row by row, not
    // once for the whole result set - a caller who is the claiming NGO for
    // donation A but not donation B must see A's donor phone and not B's.
    return donations.map((d) =>
      canSeeDonorPhone(d, requestingUser) ? d : { ...d, donor: { ...d.donor, phone: null } }
    );
  },

  // GET /donations/:id has optionalAuth - it stays browsable without a
  // token (same reasoning as getAll), but donor/volunteer phone numbers are
  // redacted unless the caller is: ADMIN, the claiming NGO (see
  // canSeeDonorPhone), the donation's own donor, or (for the volunteer's
  // number specifically)
  // someone who actually needs it to coordinate the handoff - the donor,
  // the claiming NGO, or the assigned volunteer themself.
  async getById(id: string, requestingUser?: { id: string; role: string }) {
    const donation = await prisma.donation.findUnique({
      where: { id },
      include: {
        donor: {
          select: {
            id: true,
            name: true,
            phone: true,
            location: true,
            organization: true,
          },
        },
        claimedBy: {
          select: {
            id: true,
            name: true,
            organization: true,
          },
        },
        pickupRequest: {
          include: {
            volunteer: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    if (!donation) {
      return null;
    }

    const isOwnDonation = requestingUser?.id === donation.donorId;
    const isAssignedVolunteer =
      !!requestingUser && requestingUser.id === donation.pickupRequest?.volunteerId;
    const isClaimingNgo = !!requestingUser && requestingUser.id === donation.claimedById;

    if (!canSeeDonorPhone(donation, requestingUser)) {
      donation.donor = { ...donation.donor, phone: null };
    }

    const canSeeVolunteerContact =
      requestingUser?.role === 'ADMIN' || isOwnDonation || isClaimingNgo || isAssignedVolunteer;

    if (donation.pickupRequest?.volunteer && !canSeeVolunteerContact) {
      donation.pickupRequest.volunteer = { ...donation.pickupRequest.volunteer, phone: null };
    }

    return donation;
  },

  async getByDonor(donorId: string) {
    const donations = await prisma.donation.findMany({
      where: { donorId },
      include: {
        claimedBy: {
          select: {
            id: true,
            name: true,
            organization: true,
          },
        },
        pickupRequest: {
          include: {
            volunteer: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return donations;
  },

  // Phase 12.5: the NGO-side counterpart to getByDonor() - "my claims",
  // scoped server-side. Before this existed, the NGO dashboard's My
  // Claims/My Requests/Active Tracking views all called the public getAll()
  // with only a status filter, which has no ownership concept at all -
  // every NGO's CLAIMED donations came back to every NGO. claimedById is
  // always the authenticated caller's own id (see donation.controller.ts's
  // getMyClaims - never a client-supplied value), so this can't be used to
  // query anyone else's claims.
  async getByClaimant(ngoId: string, filters?: { status?: string }) {
    const where: Record<string, unknown> = { claimedById: ngoId };

    if (filters?.status) {
      where.status = filters.status;
    }

    const donations = await prisma.donation.findMany({
      where,
      include: {
        // The requester is by definition the claiming NGO for every row
        // this query can ever return (where: claimedById = ngoId, above),
        // so both donor and volunteer contact info are in-policy here
        // already under Phase 31's relationship-based rule too -
        // canSeeDonorPhone's claimedById branch and canSeeVolunteerContact's
        // isClaimingNgo branch both resolve true for every row this query
        // produces - see getById()'s redaction logic above for the
        // general-purpose rule this query doesn't need to duplicate, being
        // pre-scoped instead.
        donor: {
          select: {
            id: true,
            name: true,
            phone: true,
            location: true,
            organization: true,
          },
        },
        pickupRequest: {
          include: {
            volunteer: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return donations;
  },

  async claim(donationId: string, ngoId: string) {
    return prisma.$transaction(async (tx) => {
      // Conditional update: only claims the row if it is still AVAILABLE.
      // Under concurrent claims, Postgres serializes the two UPDATEs on the
      // same row - the second one re-evaluates this WHERE clause against the
      // first transaction's committed result and matches zero rows instead
      // of racing past the status check. That makes this safe without an
      // explicit lock or a higher isolation level.
      const result = await tx.donation.updateMany({
        where: { id: donationId, status: 'AVAILABLE' },
        data: { status: 'CLAIMED', claimedById: ngoId },
      });

      if (result.count === 0) {
        const existing = await tx.donation.findUnique({
          where: { id: donationId },
          select: { id: true },
        });

        if (!existing) {
          throw new Error('Donation not found');
        }

        throw new Error('Donation is not available');
      }

      // Creating the PickupRequest inside the same transaction as the claim
      // means a claim can never succeed without a matching pickup request -
      // and a failure here rolls the claim back too.
      await pickupService.createPickupRequest(donationId, tx);

      const claimed = await tx.donation.findUnique({
        where: { id: donationId },
        include: {
          donor: {
            select: {
              id: true,
              name: true,
              organization: true,
            },
          },
          claimedBy: {
            select: {
              id: true,
              name: true,
              organization: true,
            },
          },
        },
      });

      if (!claimed) {
        throw new Error('Failed to load donation after claim');
      }

      // Same transaction as the claim itself: if anything above rolled
      // back, this never runs, and a rollback here (it can't fail in
      // practice, but if it ever did) takes the claim back down with it -
      // a notification can never exist for a claim that didn't happen.
      const claimedByName = claimed.claimedBy?.organization || claimed.claimedBy?.name || 'An NGO';
      await notificationService.create(
        {
          recipientId: claimed.donorId,
          type: 'DONATION_CLAIMED',
          title: 'Your donation was claimed',
          message: `${claimedByName} claimed your ${claimed.foodType} donation.`,
          donationId: claimed.id,
        },
        tx
      );

      return claimed;
    });
  },

  // Cancels a donation. This is one of two transitions a DONOR or ADMIN can
  // drive directly out of CLAIMED (see also releaseClaim(), the NGO-facing
  // counterpart) - every other move through DONATION_TRANSITIONS belongs to
  // a dedicated operation (see the map above).
  //
  // Legal transitions (Phase 12.5):
  //   DONOR/ADMIN, AVAILABLE                       -> CANCELLED (DONOR: own donation only)
  //   DONOR/ADMIN, CLAIMED + PickupRequest PENDING -> CANCELLED (DONOR: own donation only)
  //   DONOR/ADMIN, CLAIMED + PickupRequest ACCEPTED+ -> rejected (a volunteer is already involved)
  // PICKED_UP, DELIVERED, EXPIRED, and already-CANCELLED donations are
  // never cancellable by either role. Note PICKED_UP/DELIVERED are already
  // unreachable here for a different reason too: pickupService's
  // markPickedUp()/completeDelivery() always move Donation.status to
  // PICKED_UP/DELIVERED in the same transaction as the matching
  // PickupRequest transition, so a CLAIMED donation can only ever coexist
  // with a PENDING or ACCEPTED PickupRequest - never PICKED_UP or beyond.
  //
  // Phase 12 originally gave ADMIN an unconditional override into CLAIMED
  // regardless of pickup progress (carried over from Phase 2's original
  // "administrative override" design). That allowed an admin to cancel a
  // donation whose PickupRequest was already ACCEPTED, producing an
  // inconsistent pair: Donation CANCELLED while PickupRequest stayed
  // ACCEPTED with a real volunteer and Delivery row still attached - a
  // volunteer could then still call markPickedUp/completeDelivery on a
  // donation that was supposedly cancelled. Phase 12.5 closes this by
  // applying the exact same PENDING-only reversibility window to ADMIN as
  // to DONOR: once a volunteer is involved, cancellation is no longer
  // available to either role through this endpoint. This is a deliberate,
  // minimal narrowing of ADMIN's prior scope, not a new capability -
  // force-removing an in-progress volunteer pickup remains a separate,
  // out-of-scope admin-moderation feature (not built in any phase so far).
  async cancel(
    donationId: string,
    requestingUser: { id: string; role: string; email?: string }
  ) {
    return prisma.$transaction(async (tx) => {
      const donation = await tx.donation.findUnique({ where: { id: donationId } });

      if (!donation) {
        throw new Error('Donation not found');
      }

      const isAdmin = requestingUser.role === 'ADMIN';

      if (!isAdmin && donation.donorId !== requestingUser.id) {
        throw new Error('You can only cancel your own donations');
      }

      const cancellableFrom: DonationStatus[] = ['AVAILABLE', 'CLAIMED'];

      if (
        !DONATION_TRANSITIONS[donation.status].includes('CANCELLED') ||
        !cancellableFrom.includes(donation.status)
      ) {
        throw new Error(`Cannot cancel a donation with status ${donation.status}`);
      }

      // A still-PENDING PickupRequest (no volunteer) can safely be deleted
      // along with the cancellation - deleting rather than marking it
      // CANCELLED is deliberate: PickupRequest.donationId is @unique, so a
      // lingering row of any status would permanently block this donation
      // from ever being claimed again, and nothing downstream needs to read
      // a cancelled pickup after the donation itself is terminal. This is
      // now the only reachable case for either role - see the comment above
      // the function for why ACCEPTED+ is rejected before reaching this
      // point, for both DONOR and ADMIN alike.
      let pickupRequest: { id: string; status: string; volunteerId: string | null } | null = null;
      if (donation.status === 'CLAIMED') {
        pickupRequest = await tx.pickupRequest.findUnique({
          where: { donationId },
          select: { id: true, status: true, volunteerId: true },
        });

        if (pickupRequest?.status !== 'PENDING') {
          throw new Error('This donation already has a volunteer assigned and can no longer be cancelled.');
        }
      }

      if (pickupRequest?.status === 'PENDING') {
        // Conditional delete, same row-level-serialization pattern the rest
        // of this codebase uses for concurrency safety (see claim()): if a
        // volunteer's accept or an admin assignment committed first, this
        // matches zero rows and the whole cancellation rolls back below.
        const deletedPickup = await tx.pickupRequest.deleteMany({
          where: { id: pickupRequest.id, status: 'PENDING', volunteerId: null },
        });

        if (deletedPickup.count === 0) {
          throw new Error('This donation already has a volunteer assigned and can no longer be cancelled.');
        }
      }

      // Conditional update, same pattern as claim(): re-checks status at
      // write time so a cancel racing a concurrent claim (or another
      // cancel) can't corrupt the row - exactly one of them wins.
      const result = await tx.donation.updateMany({
        where: { id: donationId, status: donation.status },
        data: { status: 'CANCELLED' },
      });

      if (result.count === 0) {
        throw new Error('Donation state changed - please refresh and try again');
      }

      const cancelled = await tx.donation.findUnique({ where: { id: donationId } });

      if (!cancelled) {
        throw new Error('Failed to load donation after cancellation');
      }

      // A donor cancelling their own donation is acting on themselves -
      // nothing to notify there. What's genuinely new information to
      // someone else:
      //   - an ADMIN override: the donor didn't initiate it, and if the
      //     donation was already CLAIMED, the claiming NGO's pickup just
      //     vanished out from under them (unchanged from Phase 11);
      //   - a DONOR cancelling their own CLAIMED donation: the claiming
      //     NGO's pickup just vanished, same as above, but the donor
      //     themselves initiated it and isn't notified of their own action.
      if (isAdmin) {
        await notificationService.create(
          {
            recipientId: cancelled.donorId,
            type: 'DONATION_CANCELLED',
            title: 'Your donation was cancelled',
            message: `An administrator cancelled your ${cancelled.foodType} donation.`,
            donationId: cancelled.id,
          },
          tx
        );

        if (donation.claimedById) {
          await notificationService.create(
            {
              recipientId: donation.claimedById,
              type: 'DONATION_CANCELLED',
              title: 'A claimed donation was cancelled',
              message: `The ${cancelled.foodType} donation you claimed was cancelled by an administrator.`,
              donationId: cancelled.id,
            },
            tx
          );
        }

        // Phase 14: admin moderation audit trail. AdminLog.userId means
        // "the subject this entry concerns" by the convention every
        // existing USER_* entry uses (userService's approve/reject/
        // suspend/activate all set it to the *target* user, not the
        // acting admin) - kept consistent here by pointing it at the
        // donation's donor. Phase 20: actorId is the real, structurally
        // queryable acting-admin reference - requestingUser.id comes from
        // the authenticated JWT/user context (donationController.cancel),
        // never client-supplied input. `details` still spells out the
        // admin's email too, for continuity with log entries written
        // before actorId existed. Only written on the admin path: a donor
        // cancelling their own donation is ordinary self-service, not
        // something requiring an admin audit entry.
        await tx.adminLog.create({
          data: {
            action: 'DONATION_CANCELLED',
            details: `Donation "${cancelled.foodType}" (${cancelled.id}) cancelled by admin ${
              requestingUser.email ?? requestingUser.id
            }. Previous status: ${donation.status}.`,
            level: 'warning',
            userId: cancelled.donorId,
            actorId: requestingUser.id,
          },
        });
      } else if (donation.claimedById) {
        await notificationService.create(
          {
            recipientId: donation.claimedById,
            type: 'DONATION_CANCELLED',
            title: 'A claimed donation was cancelled',
            message: `The donor cancelled the ${cancelled.foodType} donation you claimed.`,
            donationId: cancelled.id,
          },
          tx
        );
      }

      return cancelled;
    });
  },

  // NGO-facing counterpart to cancel(): releases a claim back onto the
  // market instead of terminating the donation. Legal only while the
  // pickup is still PENDING (no volunteer accepted/assigned) - identical
  // reversibility window to the DONOR path in cancel(), same reasoning for
  // deleting rather than retaining the PickupRequest (see cancel()'s
  // comment above; the @unique donationId constraint means a lingering row
  // of any status would block the donation from ever becoming claimable
  // again, which is the entire point of a release).
  async releaseClaim(donationId: string, ngoId: string) {
    return prisma.$transaction(async (tx) => {
      // claimedBy is captured now, before the update below nulls it out -
      // needed to name the releasing NGO in the donor's notification,
      // mirroring how claim()'s own notification names the claiming NGO.
      const donation = await tx.donation.findUnique({
        where: { id: donationId },
        include: { claimedBy: { select: { id: true, name: true, organization: true } } },
      });

      if (!donation) {
        throw new Error('Donation not found');
      }

      if (donation.claimedById !== ngoId) {
        throw new Error('You can only release your own claim');
      }

      if (donation.status !== 'CLAIMED') {
        throw new Error(`Cannot release a claim on a donation with status ${donation.status}`);
      }

      const pickupRequest = await tx.pickupRequest.findUnique({
        where: { donationId },
        select: { id: true, status: true, volunteerId: true },
      });

      if (!pickupRequest || pickupRequest.status !== 'PENDING' || pickupRequest.volunteerId) {
        throw new Error('This claim already has a volunteer assigned and can no longer be released.');
      }

      // Conditional delete first - same row-level-serialization pattern as
      // cancel()/claim(): if a volunteer's accept or an admin assignment
      // committed first, this matches zero rows and the whole release
      // rolls back before the donation row is ever touched.
      const deletedPickup = await tx.pickupRequest.deleteMany({
        where: { id: pickupRequest.id, status: 'PENDING', volunteerId: null },
      });

      if (deletedPickup.count === 0) {
        throw new Error('This claim already has a volunteer assigned and can no longer be released.');
      }

      const result = await tx.donation.updateMany({
        where: { id: donationId, status: 'CLAIMED', claimedById: ngoId },
        data: { status: 'AVAILABLE', claimedById: null },
      });

      if (result.count === 0) {
        throw new Error('Donation state changed - please refresh and try again');
      }

      const released = await tx.donation.findUnique({ where: { id: donationId } });

      if (!released) {
        throw new Error('Failed to load donation after releasing claim');
      }

      // The releasing NGO isn't notified of its own action. No volunteer
      // exists to notify (release is only legal before one is involved).
      // The donor is the only party with a genuine stake in "my donation
      // is back on the market" - and DONATION_RELEASED (not
      // DONATION_CANCELLED) keeps that distinction honest: the donation
      // itself was not terminated.
      const releasedByName = donation.claimedBy?.organization || donation.claimedBy?.name || 'An NGO';
      await notificationService.create(
        {
          recipientId: released.donorId,
          type: 'DONATION_RELEASED',
          title: 'Your donation is available again',
          message: `${releasedByName} released their claim on your ${released.foodType} donation - it is available for other NGOs to claim.`,
          donationId: released.id,
        },
        tx
      );

      return released;
    });
  },

  async getStats() {
    const [
      totalDonations,
      availableDonations,
      claimedDonations,
      deliveredDonations,
      urgentDonations,
    ] = await Promise.all([
      prisma.donation.count(),
      prisma.donation.count({ where: { status: 'AVAILABLE' } }),
      prisma.donation.count({ where: { status: 'CLAIMED' } }),
      prisma.donation.count({ where: { status: 'DELIVERED' } }),
      prisma.donation.count({ where: { isUrgent: true, status: 'AVAILABLE' } }),
    ]);

    return {
      total: totalDonations,
      available: availableDonations,
      claimed: claimedDonations,
      delivered: deliveredDonations,
      urgent: urgentDonations,
    };
  },
};

