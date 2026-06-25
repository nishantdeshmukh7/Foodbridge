import prisma from '../models/prisma.js';

export const pickupService = {
  async createPickupRequest(donationId: string) {
    const donation = await prisma.donation.findUnique({
      where: { id: donationId },
    });

    if (!donation) {
      throw new Error('Donation not found');
    }

    const pickupRequest = await prisma.pickupRequest.create({
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
  },

  async assignVolunteer(pickupRequestId: string, volunteerId: string) {
    const pickupRequest = await prisma.pickupRequest.findUnique({
      where: { id: pickupRequestId },
    });

    if (!pickupRequest) {
      throw new Error('Pickup request not found');
    }

    if (pickupRequest.volunteerId) {
      throw new Error('Volunteer already assigned');
    }

    const updated = await prisma.pickupRequest.update({
      where: { id: pickupRequestId },
      data: {
        volunteerId,
        status: 'ACCEPTED',
      },
      include: {
        donation: {
          include: {
            donor: true,
            claimedBy: true,
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
      },
    });

    // Update donation status to PICKED_UP
    await prisma.donation.update({
      where: { id: pickupRequest.donationId },
      data: { status: 'PICKED_UP' },
    });

    // Create delivery record
    await prisma.delivery.create({
      data: {
        pickupRequestId,
        status: 'ASSIGNED',
      },
    });

    return updated;
  },

  async acceptPickup(pickupRequestId: string, volunteerId: string) {
    const pickupRequest = await prisma.pickupRequest.findUnique({
      where: { id: pickupRequestId },
    });

    if (!pickupRequest) {
      throw new Error('Pickup request not found');
    }

    // Allow volunteer to accept if no one has accepted yet
    if (pickupRequest.volunteerId && pickupRequest.volunteerId !== volunteerId) {
      throw new Error('This pickup has already been accepted by another volunteer');
    }

    // If volunteerId is not set, assign this volunteer
    const updateData: Record<string, unknown> = {
      status: 'ACCEPTED',
    };
    
    if (!pickupRequest.volunteerId) {
      updateData.volunteerId = volunteerId;
    }

    const updated = await prisma.pickupRequest.update({
      where: { id: pickupRequestId },
      data: updateData,
    });

    await prisma.donation.update({
      where: { id: pickupRequest.donationId },
      data: { status: 'CLAIMED' },
    });

    // Create delivery record if it doesn't exist
    const existingDelivery = await prisma.delivery.findUnique({
      where: { pickupRequestId },
    });
    
    if (!existingDelivery) {
      await prisma.delivery.create({
        data: {
          pickupRequestId,
          status: 'ASSIGNED',
        },
      });
    }

    return updated;
  },

  async markPickedUp(pickupRequestId: string, volunteerId: string) {
    const pickupRequest = await prisma.pickupRequest.findUnique({
      where: { id: pickupRequestId },
    });

    if (!pickupRequest) {
      throw new Error('Pickup request not found');
    }

    if (pickupRequest.volunteerId !== volunteerId) {
      throw new Error('Not authorized to update this pickup');
    }

    const updated = await prisma.pickupRequest.update({
      where: { id: pickupRequestId },
      data: {
        status: 'PICKED_UP',
        pickedUpAt: new Date(),
      },
    });

    await prisma.donation.update({
      where: { id: pickupRequest.donationId },
      data: { status: 'PICKED_UP' },
    });

    // Update delivery record if it exists, otherwise create it
    const existingDelivery = await prisma.delivery.findUnique({
      where: { pickupRequestId },
    });
    
    if (existingDelivery) {
      await prisma.delivery.update({
        where: { pickupRequestId },
        data: {
          status: 'PICKED_UP',
          pickupTime: new Date(),
        },
      });
    } else {
      await prisma.delivery.create({
        data: {
          pickupRequestId,
          status: 'PICKED_UP',
          pickupTime: new Date(),
        },
      });
    }

    return updated;
  },

  async completeDelivery(pickupRequestId: string, volunteerId: string, photoUrl?: string) {
    const pickupRequest = await prisma.pickupRequest.findUnique({
      where: { id: pickupRequestId },
    });

    if (!pickupRequest) {
      throw new Error('Pickup request not found');
    }

    if (pickupRequest.volunteerId !== volunteerId) {
      throw new Error('Not authorized to complete this delivery');
    }

    const updated = await prisma.pickupRequest.update({
      where: { id: pickupRequestId },
      data: {
        status: 'COMPLETED',
        deliveredAt: new Date(),
      },
    });

    await prisma.donation.update({
      where: { id: pickupRequest.donationId },
      data: { status: 'DELIVERED' },
    });

    // Update delivery record if it exists, otherwise create it
    const existingDelivery = await prisma.delivery.findUnique({
      where: { pickupRequestId },
    });
    
    if (existingDelivery) {
      await prisma.delivery.update({
        where: { pickupRequestId },
        data: {
          status: 'COMPLETED',
          deliveryTime: new Date(),
          deliveryPhotoUrl: photoUrl,
        },
      });
    } else {
      await prisma.delivery.create({
        data: {
          pickupRequestId,
          status: 'COMPLETED',
          deliveryTime: new Date(),
          deliveryPhotoUrl: photoUrl,
        },
      });
    }

    return updated;
  },

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

