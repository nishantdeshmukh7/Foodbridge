import { UserRole, DonationStatus, RequestStatus } from '@prisma/client';
import prisma from '../models/prisma.js';

// Every number here comes from a real Prisma aggregate query against
// current database state - nothing is hardcoded, estimated, or carried
// over from a mock. If a group has zero rows, groupBy() simply omits it
// (SQL GROUP BY never returns empty groups), so every lookup below falls
// back to 0 explicitly - a genuine "no rows in that state" zero, not a
// placeholder that happened to be left in the UI.

function sumCounts(groups: { _count: number }[]): number {
  return groups.reduce((sum, g) => sum + g._count, 0);
}

export const adminService = {
  async getAnalytics() {
    // Five queries total, each a single grouped aggregate rather than one
    // count() per status/role/lifecycle value - see Phase 8 report for why
    // groupBy was chosen over ~15 separate count() calls.
    const [roleGroups, lifecycleGroups, donationGroups, urgentAvailable, pickupGroups] =
      await Promise.all([
        prisma.user.groupBy({ by: ['role'], _count: true }),
        // The full Phase 5 lifecycle lattice in one query: every
        // (isApproved, isActive) combination that actually occurs.
        prisma.user.groupBy({ by: ['isApproved', 'isActive'], _count: true }),
        prisma.donation.groupBy({ by: ['status'], _count: true }),
        // isUrgent is an independent boolean, not part of DonationStatus,
        // so it can't come from the status groupBy above - kept as its own
        // count, matching the definition donationService.getStats() already
        // uses elsewhere (urgent AND still AVAILABLE).
        prisma.donation.count({ where: { isUrgent: true, status: 'AVAILABLE' } }),
        prisma.pickupRequest.groupBy({ by: ['status'], _count: true }),
      ]);

    const roleCount = (role: UserRole) => roleGroups.find((g) => g.role === role)?._count ?? 0;
    const lifecycleCount = (isApproved: boolean, isActive: boolean) =>
      lifecycleGroups.find((g) => g.isApproved === isApproved && g.isActive === isActive)?._count ?? 0;
    const donationCount = (status: DonationStatus) =>
      donationGroups.find((g) => g.status === status)?._count ?? 0;
    const pickupCount = (status: RequestStatus) =>
      pickupGroups.find((g) => g.status === status)?._count ?? 0;

    return {
      users: {
        total: sumCounts(roleGroups),
        donors: roleCount('DONOR'),
        ngos: roleCount('NGO'),
        volunteers: roleCount('VOLUNTEER'),
        admins: roleCount('ADMIN'),
        // The four Phase 5 lifecycle states - mutually exclusive, sum to total.
        activeAccounts: lifecycleCount(true, true),
        pendingApprovals: lifecycleCount(false, true),
        rejectedAccounts: lifecycleCount(false, false),
        suspendedAccounts: lifecycleCount(true, false),
      },
      donations: {
        total: sumCounts(donationGroups),
        available: donationCount('AVAILABLE'),
        claimed: donationCount('CLAIMED'),
        pickedUp: donationCount('PICKED_UP'),
        delivered: donationCount('DELIVERED'),
        // EXPIRED will read 0 until an expiry sweep exists to ever set it -
        // that is a truthful zero, not a bug in this query.
        expired: donationCount('EXPIRED'),
        cancelled: donationCount('CANCELLED'),
        urgentAvailable,
      },
      pickups: {
        total: sumCounts(pickupGroups),
        pending: pickupCount('PENDING'),
        accepted: pickupCount('ACCEPTED'),
        pickedUp: pickupCount('PICKED_UP'),
        completed: pickupCount('COMPLETED'),
        // REJECTED/CANCELLED exist in the schema but no current code path
        // ever writes them - also truthful zeros today, not omissions.
        rejected: pickupCount('REJECTED'),
        cancelled: pickupCount('CANCELLED'),
      },
    };
  },

  // Real admin action history - AdminLog rows have been written on every
  // approve/reject/suspend/reactivate since Phase 5, but nothing has ever
  // read them back until now. This replaces Monitoring's fabricated
  // "System Logs" array with the platform's actual recent activity.
  async getRecentActivity(limit = 10) {
    return prisma.adminLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        details: true,
        level: true,
        createdAt: true,
      },
    });
  },
};
