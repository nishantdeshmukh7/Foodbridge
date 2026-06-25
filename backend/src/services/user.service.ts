import prisma from '../models/prisma.js';

export const userService = {
  async getAll(filters?: {
    role?: string;
    isApproved?: boolean;
    search?: string;
  }) {
    const where: Record<string, unknown> = {};

    if (filters?.role) {
      where.role = filters.role;
    }

    if (filters?.isApproved !== undefined) {
      where.isApproved = filters.isApproved;
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { organization: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        location: true,
        organization: true,
        role: true,
        isApproved: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            donations: true,
            claims: true,
            pickups: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  },

  async getById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        location: true,
        organization: true,
        role: true,
        isApproved: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            donations: true,
            claims: true,
            pickups: true,
          },
        },
      },
    });

    return user;
  },

  async approveUser(userId: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { isApproved: true },
    });

    await prisma.adminLog.create({
      data: {
        action: 'USER_APPROVED',
        details: `User ${user.email} approved`,
        level: 'success',
        userId,
      },
    });

    return user;
  },

  async rejectUser(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    await prisma.adminLog.create({
      data: {
        action: 'USER_REJECTED',
        details: `User rejected: ${userId}`,
        level: 'warning',
      },
    });

    return { message: 'User rejected' };
  },

  async suspendUser(userId: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    await prisma.adminLog.create({
      data: {
        action: 'USER_SUSPENDED',
        details: `User ${user.email} suspended`,
        level: 'warning',
        userId,
      },
    });

    return user;
  },

  async activateUser(userId: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });

    await prisma.adminLog.create({
      data: {
        action: 'USER_ACTIVATED',
        details: `User ${user.email} activated`,
        level: 'success',
        userId,
      },
    });

    return user;
  },

  async getStats() {
    const [totalUsers, totalDonors, totalNgos, totalVolunteers, pendingNgos] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'DONOR' } }),
      prisma.user.count({ where: { role: 'NGO' } }),
      prisma.user.count({ where: { role: 'VOLUNTEER' } }),
      prisma.user.count({ where: { role: 'NGO', isApproved: false } }),
    ]);

    return {
      total: totalUsers,
      donors: totalDonors,
      ngos: totalNgos,
      volunteers: totalVolunteers,
      pendingApprovals: pendingNgos,
    };
  },

  async getPendingApprovals() {
    const users = await prisma.user.findMany({
      where: {
        isApproved: false,
        role: 'NGO',
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        location: true,
        organization: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return users;
  },
};

