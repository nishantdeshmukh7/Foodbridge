import { Prisma } from '@prisma/client';
import prisma from '../models/prisma.js';
import { notificationService } from './notification.service.js';

type Db = Prisma.TransactionClient;

// The one and only PENDING -> ACCEPTED transition in the system. Both
// pickupService.acceptPickup() (a volunteer claiming their own pickup) and
// pickupService.assignVolunteer() (an admin assigning a specific volunteer)
// call this exact function - there is no second, parallel state machine.
// Whichever caller's write lands first wins the same way
// donationService.claim() resolves concurrent NGO claims: the conditional
// updateMany re-checks status/volunteerId at write time, so a losing caller
// gets a clean rejection instead of corrupting the row.
//
// Reassignment is deliberately NOT supported: once a PickupRequest has a
// volunteer, every further call here - self-serve or admin - fails with
// "already been accepted by another volunteer" (or, for any later status,
// "Cannot accept a pickup request with status ..."). There is no current
// product need for an admin to override an existing assignment, so this
// doesn't invent that behavior.
// initiatedBy distinguishes the two callers below only for notification
// purposes - the transition logic itself is identical either way. A
// volunteer who accepts their own pickup doesn't need to be told they did
// it; a volunteer an admin assigned does.
async function assignPickupToVolunteer(
  pickupRequestId: string,
  volunteerId: string,
  initiatedBy: 'SELF' | 'ADMIN'
) {
  return prisma.$transaction(async (tx) => {
    const pickupRequest = await tx.pickupRequest.findUnique({
      where: { id: pickupRequestId },
      select: { donationId: true },
    });

    if (!pickupRequest) {
      throw new Error('Pickup request not found');
    }

    const result = await tx.pickupRequest.updateMany({
      where: { id: pickupRequestId, status: 'PENDING', volunteerId: null },
      data: { status: 'ACCEPTED', volunteerId },
    });

    if (result.count === 0) {
      const current = await tx.pickupRequest.findUnique({
        where: { id: pickupRequestId },
        select: { status: true, volunteerId: true },
      });

      if (current?.volunteerId && current.volunteerId !== volunteerId) {
        throw new Error('This pickup has already been accepted by another volunteer');
      }

      throw new Error(`Cannot accept a pickup request with status ${current?.status ?? 'UNKNOWN'}`);
    }

    const donation = await tx.donation.update({
      where: { id: pickupRequest.donationId },
      data: { status: 'CLAIMED' },
    });

    const existingDelivery = await tx.delivery.findUnique({ where: { pickupRequestId } });
    if (!existingDelivery) {
      await tx.delivery.create({ data: { pickupRequestId, status: 'ASSIGNED' } });
    }

    // The NGO that claimed this donation is who has a pickup to track,
    // regardless of which of the two entry points landed the assignment.
    if (donation.claimedById) {
      await notificationService.create(
        {
          recipientId: donation.claimedById,
          type: 'PICKUP_ACCEPTED',
          title: 'A volunteer was assigned',
          message: `A volunteer will pick up your claimed ${donation.foodType} donation.`,
          donationId: donation.id,
          pickupRequestId,
        },
        tx
      );
    }

    // Only tell the volunteer when someone else made this decision for
    // them - self-accepting is not news to the person who just did it.
    if (initiatedBy === 'ADMIN') {
      await notificationService.create(
        {
          recipientId: volunteerId,
          type: 'PICKUP_ASSIGNED',
          title: 'You were assigned a pickup',
          message: `An administrator assigned you to pick up a ${donation.foodType} donation.`,
          donationId: donation.id,
          pickupRequestId,
        },
        tx
      );
    }

    const updated = await tx.pickupRequest.findUnique({ where: { id: pickupRequestId } });
    if (!updated) {
      throw new Error('Failed to load pickup request after accepting');
    }
    return updated;
  });
}

export const pickupService = {
  // Phase 18: `db` is a required Prisma.TransactionClient, not merely an
  // optional convenience - deliberately, so this function can never be
  // called standalone outside a transaction. Its only caller is
  // donationService.claim(donationId, ngoId), which has already atomically
  // checked the donation was AVAILABLE and set claimedById in the very same
  // transaction before this runs. There used to be a second caller (a
  // standalone POST /pickups route) that called this with no such
  // precondition - that route has been removed (see pickup.routes.ts) and
  // this signature change makes it a compile-time error to reintroduce an
  // unsafe standalone caller by accident.
  async createPickupRequest(donationId: string, db: Db) {
    const donation = await db.donation.findUnique({
      where: { id: donationId },
    });

    if (!donation) {
      throw new Error('Donation not found');
    }

    try {
      const pickupRequest = await db.pickupRequest.create({
        data: {
          donationId,
          status: 'PENDING',
        },
        include: {
          donation: {
            include: {
              donor: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  location: true,
                },
              },
              claimedBy: {
                select: {
                  id: true,
                  name: true,
                  organization: true,
                  location: true,
                },
              },
            },
          },
        },
      });

      return pickupRequest;
    } catch (error) {
      // PickupRequest.donationId is unique - a second attempt to create one
      // for the same donation hits this instead of a raw constraint error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Error('A pickup request already exists for this donation');
      }
      throw error;
    }
  },

  // Volunteer self-serve entry point: first VOLUNTEER to call this for a
  // given PickupRequest gets it. The caller's own JWT already proves their
  // identity and role, so no further eligibility check is needed here.
  async acceptPickup(pickupRequestId: string, volunteerId: string) {
    return assignPickupToVolunteer(pickupRequestId, volunteerId, 'SELF');
  },

  // Admin-driven entry point: assigns a *specific* volunteer, chosen by an
  // admin, to a pending pickup. Unlike acceptPickup(), the target user is
  // untrusted input (an id in the request body, not the caller's own
  // identity), so it must be validated before touching the pickup at all.
  async assignVolunteer(pickupRequestId: string, volunteerId: string) {
    const volunteer = await prisma.user.findUnique({
      where: { id: volunteerId },
      select: { id: true, role: true, isActive: true, isApproved: true },
    });

    if (!volunteer) {
      throw new Error('Volunteer not found');
    }
    if (volunteer.role !== 'VOLUNTEER') {
      throw new Error('Selected user is not a volunteer');
    }
    if (!volunteer.isActive || !volunteer.isApproved) {
      throw new Error('Selected volunteer is not eligible for assignment');
    }

    // Same atomic transition acceptPickup() uses - see its comment below.
    return assignPickupToVolunteer(pickupRequestId, volunteerId, 'ADMIN');
  },

  async markPickedUp(pickupRequestId: string, volunteerId: string) {
    return prisma.$transaction(async (tx) => {
      const pickupRequest = await tx.pickupRequest.findUnique({
        where: { id: pickupRequestId },
        select: { donationId: true, volunteerId: true },
      });

      if (!pickupRequest) {
        throw new Error('Pickup request not found');
      }

      if (pickupRequest.volunteerId !== volunteerId) {
        throw new Error('Not authorized to update this pickup');
      }

      const result = await tx.pickupRequest.updateMany({
        where: { id: pickupRequestId, status: 'ACCEPTED', volunteerId },
        data: { status: 'PICKED_UP', pickedUpAt: new Date() },
      });

      if (result.count === 0) {
        const current = await tx.pickupRequest.findUnique({
          where: { id: pickupRequestId },
          select: { status: true },
        });
        throw new Error(`Cannot mark as picked up from status ${current?.status ?? 'UNKNOWN'}`);
      }

      const donation = await tx.donation.update({
        where: { id: pickupRequest.donationId },
        data: { status: 'PICKED_UP' },
      });

      const existingDelivery = await tx.delivery.findUnique({ where: { pickupRequestId } });
      if (existingDelivery) {
        await tx.delivery.update({
          where: { pickupRequestId },
          data: { status: 'PICKED_UP', pickupTime: new Date() },
        });
      } else {
        await tx.delivery.create({
          data: { pickupRequestId, status: 'PICKED_UP', pickupTime: new Date() },
        });
      }

      // Both the donor and the claiming NGO have a stake in "it's on its
      // way now" - the donor because it's their food, the NGO because it's
      // the pickup they're waiting to receive.
      await notificationService.create(
        {
          recipientId: donation.donorId,
          type: 'PICKUP_STARTED',
          title: 'Your donation was picked up',
          message: `A volunteer has picked up your ${donation.foodType} donation.`,
          donationId: donation.id,
          pickupRequestId,
        },
        tx
      );

      if (donation.claimedById) {
        await notificationService.create(
          {
            recipientId: donation.claimedById,
            type: 'PICKUP_STARTED',
            title: 'Pickup in progress',
            message: `The volunteer has picked up the ${donation.foodType} donation you claimed.`,
            donationId: donation.id,
            pickupRequestId,
          },
          tx
        );
      }

      const updated = await tx.pickupRequest.findUnique({ where: { id: pickupRequestId } });
      if (!updated) {
        throw new Error('Failed to load pickup request after marking picked up');
      }
      return updated;
    });
  },

  async completeDelivery(pickupRequestId: string, volunteerId: string, photoUrl?: string) {
    return prisma.$transaction(async (tx) => {
      const pickupRequest = await tx.pickupRequest.findUnique({
        where: { id: pickupRequestId },
        select: { donationId: true, volunteerId: true },
      });

      if (!pickupRequest) {
        throw new Error('Pickup request not found');
      }

      if (pickupRequest.volunteerId !== volunteerId) {
        throw new Error('Not authorized to complete this delivery');
      }

      const result = await tx.pickupRequest.updateMany({
        where: { id: pickupRequestId, status: 'PICKED_UP', volunteerId },
        data: { status: 'COMPLETED', deliveredAt: new Date() },
      });

      if (result.count === 0) {
        const current = await tx.pickupRequest.findUnique({
          where: { id: pickupRequestId },
          select: { status: true },
        });
        throw new Error(`Cannot complete delivery from status ${current?.status ?? 'UNKNOWN'}`);
      }

      const donation = await tx.donation.update({
        where: { id: pickupRequest.donationId },
        data: { status: 'DELIVERED' },
      });

      const existingDelivery = await tx.delivery.findUnique({ where: { pickupRequestId } });
      if (existingDelivery) {
        await tx.delivery.update({
          where: { pickupRequestId },
          data: { status: 'COMPLETED', deliveryTime: new Date(), deliveryPhotoUrl: photoUrl },
        });
      } else {
        await tx.delivery.create({
          data: { pickupRequestId, status: 'COMPLETED', deliveryTime: new Date(), deliveryPhotoUrl: photoUrl },
        });
      }

      await notificationService.create(
        {
          recipientId: donation.donorId,
          type: 'DELIVERY_COMPLETED',
          title: 'Your donation was delivered',
          message: `Your ${donation.foodType} donation has been delivered. Thank you!`,
          donationId: donation.id,
          pickupRequestId,
        },
        tx
      );

      if (donation.claimedById) {
        await notificationService.create(
          {
            recipientId: donation.claimedById,
            type: 'DELIVERY_COMPLETED',
            title: 'Delivery completed',
            message: `The ${donation.foodType} donation you claimed has been delivered.`,
            donationId: donation.id,
            pickupRequestId,
          },
          tx
        );
      }

      const updated = await tx.pickupRequest.findUnique({ where: { id: pickupRequestId } });
      if (!updated) {
        throw new Error('Failed to load pickup request after completing delivery');
      }
      return updated;
    });
  },

  // Public browsing list (any volunteer deciding whether to accept, plus
  // Admin's assignment picker) - no phone here. Nothing currently displays
  // it at this stage, and unlike an NGO's pre-claim "Contact Donor" (see
  // donationService), there's no established product behaviour of sharing
  // a donor's number before a volunteer has actually committed to a
  // pickup. Once accepted, the assigned volunteer gets it via
  // getVolunteerPickups() below, which already has it and is safely
  // self-scoped (filtered to volunteerId = the caller).
  async getAvailablePickups() {
    const pickups = await prisma.pickupRequest.findMany({
      where: {
        status: 'PENDING',
        volunteer: null,
      },
      include: {
        donation: {
          include: {
            donor: {
              select: {
                id: true,
                name: true,
                location: true,
                organization: true,
              },
            },
            claimedBy: {
              select: {
                id: true,
                name: true,
                organization: true,
                location: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return pickups;
  },

  async getVolunteerPickups(volunteerId: string) {
    const pickups = await prisma.pickupRequest.findMany({
      where: { volunteerId },
      include: {
        donation: {
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
                location: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return pickups;
  },

  async getById(pickupRequestId: string) {
    const pickup = await prisma.pickupRequest.findUnique({
      where: { id: pickupRequestId },
      include: {
        donation: {
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
                location: true,
              },
            },
          },
        },
        volunteer: {
          select: {
            id: true,
            name: true,
            phone: true,
            location: true,
          },
        },
        delivery: true,
      },
    });

    return pickup;
  },
};

