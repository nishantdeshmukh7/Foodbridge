import prisma from '../models/prisma.js';

export interface CreateDonationData {
  foodType: string;
  quantity: string;
  description?: string;
  expiryTime: Date;
  pickupLocation: string;
  imageUrl?: string;
  isUrgent?: boolean;
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

  async getAll(filters?: {
    status?: string;
    foodType?: string;
    location?: string;
  }) {
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
      },
      orderBy: { createdAt: 'desc' },
    });

    return donations;
  },

  async getById(id: string) {
    const donation = await prisma.donation.findUnique({
      where: { id },
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

  async claim(donationId: string, ngoId: string) {
    const donation = await prisma.donation.findUnique({
      where: { id: donationId },
    });

    if (!donation) {
      throw new Error('Donation not found');
    }

    if (donation.status !== 'AVAILABLE') {
      throw new Error('Donation is not available');
    }

    const updated = await prisma.donation.update({
      where: { id: donationId },
      data: {
        status: 'CLAIMED',
        claimedById: ngoId,
      },
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

    return updated;
  },

  async updateStatus(donationId: string, status: string) {
    const donation = await prisma.donation.update({
      where: { id: donationId },
      data: { status: status as 'AVAILABLE' | 'CLAIMED' | 'PICKED_UP' | 'DELIVERED' | 'EXPIRED' | 'CANCELLED' },
    });

    return donation;
  },

  async delete(donationId: string, donorId: string) {
    const donation = await prisma.donation.findUnique({
      where: { id: donationId },
    });

    if (!donation) {
      throw new Error('Donation not found');
    }

    if (donation.donorId !== donorId) {
      throw new Error('Not authorized');
    }

    if (donation.status !== 'AVAILABLE') {
      throw new Error('Cannot delete donation that has been claimed');
    }

    await prisma.donation.delete({
      where: { id: donationId },
    });

    return { message: 'Donation deleted successfully' };
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

