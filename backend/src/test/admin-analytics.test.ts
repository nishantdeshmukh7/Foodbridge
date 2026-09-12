import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { pickupService } from '../services/pickup.service.js';
import { config } from '../config/index.js';

// Phase 8: truthful, database-backed Admin analytics.
//
// Because GET /api/admin/analytics aggregates the *entire* database, not
// just this file's own test-suffixed rows, these tests cannot assert fixed
// expected numbers (other test files' leftover data is also counted, by
// design - this is an admin-wide aggregate). Instead, every assertion
// compares the endpoint's response against an independent direct Prisma
// query taken at the same moment - proving the numbers are real, not that
// they equal some hardcoded constant.

const TEST_EMAIL_SUFFIX = '@test.foodbridge.local';

type Role = 'ADMIN' | 'DONOR' | 'NGO' | 'VOLUNTEER';

async function createUser(
  role: Role,
  suffix: string,
  overrides: { isApproved?: boolean; isActive?: boolean } = {}
) {
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}${TEST_EMAIL_SUFFIX}`,
      password: await bcrypt.hash('password123', 4),
      name: `${role} ${suffix}`,
      role,
      isApproved: overrides.isApproved ?? true,
      isActive: overrides.isActive ?? true,
    },
  });
}

function signToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

async function fetchAnalytics(token: string) {
  const res = await request(app).get('/api/admin/analytics').set('Authorization', `Bearer ${token}`);
  return res;
}

describe('Phase 8: truthful Admin analytics', () => {
  let admin: Awaited<ReturnType<typeof createUser>>;
  let adminToken: string;

  beforeAll(async () => {
    const testUsers = await prisma.user.findMany({
      where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
      select: { id: true },
    });
    const testUserIds = testUsers.map((u) => u.id);

    await prisma.delivery.deleteMany({
      where: { pickupRequest: { donation: { donorId: { in: testUserIds } } } },
    });
    await prisma.pickupRequest.deleteMany({
      where: { donation: { donorId: { in: testUserIds } } },
    });
    await prisma.donation.deleteMany({ where: { donorId: { in: testUserIds } } });
    await prisma.adminLog.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_SUFFIX } } });

    admin = await createUser('ADMIN', 'main');
    adminToken = signToken(admin);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Authorization (Tests 1-5)', () => {
    it('Test 1: ADMIN can retrieve analytics', async () => {
      const res = await fetchAnalytics(adminToken);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('donations');
      expect(res.body).toHaveProperty('pickups');
    });

    it('Test 2: unauthenticated request gets 401', async () => {
      const res = await request(app).get('/api/admin/analytics');
      expect(res.status).toBe(401);
    });

    it('Test 3: DONOR gets 403', async () => {
      const donor = await createUser('DONOR', 'authz1');
      const res = await fetchAnalytics(signToken(donor));
      expect(res.status).toBe(403);
    });

    it('Test 4: NGO gets 403', async () => {
      const ngo = await createUser('NGO', 'authz2');
      const res = await fetchAnalytics(signToken(ngo));
      expect(res.status).toBe(403);
    });

    it('Test 5: VOLUNTEER gets 403', async () => {
      const volunteer = await createUser('VOLUNTEER', 'authz3');
      const res = await fetchAnalytics(signToken(volunteer));
      expect(res.status).toBe(403);
    });

    it('GET /api/admin/activity has the same authorization (positive + negative control)', async () => {
      const donor = await createUser('DONOR', 'authz4');
      const unauthorized = await request(app)
        .get('/api/admin/activity')
        .set('Authorization', `Bearer ${signToken(donor)}`);
      expect(unauthorized.status).toBe(403);

      const authorized = await request(app)
        .get('/api/admin/activity')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(authorized.status).toBe(200);
      expect(Array.isArray(authorized.body)).toBe(true);
    });
  });

  describe('User metrics match direct database queries (Tests 6-8)', () => {
    it('Test 6: total user count matches the database', async () => {
      const donor = await createUser('DONOR', 'user1');
      void donor;

      const res = await fetchAnalytics(adminToken);
      const dbTotal = await prisma.user.count();

      expect(res.body.users.total).toBe(dbTotal);
    });

    it('Test 7: role counts match the database', async () => {
      await createUser('DONOR', 'user2');
      await createUser('NGO', 'user3');
      await createUser('VOLUNTEER', 'user4');

      const res = await fetchAnalytics(adminToken);
      const [donors, ngos, volunteers, admins] = await Promise.all([
        prisma.user.count({ where: { role: 'DONOR' } }),
        prisma.user.count({ where: { role: 'NGO' } }),
        prisma.user.count({ where: { role: 'VOLUNTEER' } }),
        prisma.user.count({ where: { role: 'ADMIN' } }),
      ]);

      expect(res.body.users.donors).toBe(donors);
      expect(res.body.users.ngos).toBe(ngos);
      expect(res.body.users.volunteers).toBe(volunteers);
      expect(res.body.users.admins).toBe(admins);
      expect(donors + ngos + volunteers + admins).toBe(res.body.users.total);
    });

    it('Test 8: pending/rejected/suspended/active counts match the database and partition all users', async () => {
      await createUser('NGO', 'user5-pending', { isApproved: false, isActive: true });
      await createUser('NGO', 'user6-rejected', { isApproved: false, isActive: false });
      await createUser('DONOR', 'user7-suspended', { isApproved: true, isActive: false });

      const res = await fetchAnalytics(adminToken);
      const [active, pending, rejected, suspended] = await Promise.all([
        prisma.user.count({ where: { isApproved: true, isActive: true } }),
        prisma.user.count({ where: { isApproved: false, isActive: true } }),
        prisma.user.count({ where: { isApproved: false, isActive: false } }),
        prisma.user.count({ where: { isApproved: true, isActive: false } }),
      ]);

      expect(res.body.users.activeAccounts).toBe(active);
      expect(res.body.users.pendingApprovals).toBe(pending);
      expect(res.body.users.rejectedAccounts).toBe(rejected);
      expect(res.body.users.suspendedAccounts).toBe(suspended);
      // These four lifecycle states are mutually exclusive and exhaustive -
      // they must sum to exactly the total user count (Part D: no double
      // counting, no gaps).
      expect(active + pending + rejected + suspended).toBe(res.body.users.total);
    });
  });

  describe('Donation metrics match the database, no double counting (Tests 9-10)', () => {
    it('Test 9 & 10: donation status counts match the database and sum to the total with no double counting', async () => {
      const donor = await createUser('DONOR', 'don1');
      const ngo = await createUser('NGO', 'don1');
      const donation = await prisma.donation.create({
        data: {
          foodType: 'Test Meal',
          quantity: '5',
          expiryTime: new Date(Date.now() + 60 * 60 * 1000),
          pickupLocation: 'X',
          status: 'AVAILABLE',
          donorId: donor.id,
        },
      });
      await donationService.claim(donation.id, ngo.id);

      const res = await fetchAnalytics(adminToken);
      const [available, claimed, pickedUp, delivered, expired, cancelled, total] = await Promise.all([
        prisma.donation.count({ where: { status: 'AVAILABLE' } }),
        prisma.donation.count({ where: { status: 'CLAIMED' } }),
        prisma.donation.count({ where: { status: 'PICKED_UP' } }),
        prisma.donation.count({ where: { status: 'DELIVERED' } }),
        prisma.donation.count({ where: { status: 'EXPIRED' } }),
        prisma.donation.count({ where: { status: 'CANCELLED' } }),
        prisma.donation.count(),
      ]);

      expect(res.body.donations.available).toBe(available);
      expect(res.body.donations.claimed).toBe(claimed);
      expect(res.body.donations.pickedUp).toBe(pickedUp);
      expect(res.body.donations.delivered).toBe(delivered);
      expect(res.body.donations.expired).toBe(expired);
      expect(res.body.donations.cancelled).toBe(cancelled);
      expect(res.body.donations.total).toBe(total);
      // Every donation has exactly one status - no join/relation is
      // involved in these counts, so there is no double-counting surface.
      expect(available + claimed + pickedUp + delivered + expired + cancelled).toBe(total);
    });
  });

  describe('Pickup metrics match the database (Tests 11-12)', () => {
    it('Test 11 & 12: pickup status counts match the database, and every PENDING pickup is genuinely unassigned', async () => {
      const donor = await createUser('DONOR', 'pick1');
      const ngo = await createUser('NGO', 'pick1');
      const volunteer = await createUser('VOLUNTEER', 'pick1');
      const donation = await prisma.donation.create({
        data: {
          foodType: 'Test Meal',
          quantity: '5',
          expiryTime: new Date(Date.now() + 60 * 60 * 1000),
          pickupLocation: 'X',
          status: 'AVAILABLE',
          donorId: donor.id,
        },
      });
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      const res = await fetchAnalytics(adminToken);
      const [pending, accepted, pickedUp, completed, total] = await Promise.all([
        prisma.pickupRequest.count({ where: { status: 'PENDING' } }),
        prisma.pickupRequest.count({ where: { status: 'ACCEPTED' } }),
        prisma.pickupRequest.count({ where: { status: 'PICKED_UP' } }),
        prisma.pickupRequest.count({ where: { status: 'COMPLETED' } }),
        prisma.pickupRequest.count(),
      ]);

      expect(res.body.pickups.pending).toBe(pending);
      expect(res.body.pickups.accepted).toBe(accepted);
      expect(res.body.pickups.pickedUp).toBe(pickedUp);
      expect(res.body.pickups.completed).toBe(completed);
      expect(res.body.pickups.total).toBe(total);

      // "pending" and "unassigned" are the same set today by construction
      // (assignPickupToVolunteer flips status and sets volunteerId in one
      // atomic update - see pickup.service.ts) - verify that invariant
      // directly rather than exposing a second field that would always
      // just repeat this number.
      const pendingWithVolunteer = await prisma.pickupRequest.count({
        where: { status: 'PENDING', volunteerId: { not: null } },
      });
      expect(pendingWithVolunteer).toBe(0);
    });
  });

  describe('Empty state - genuine zeros, not placeholders (Test 13)', () => {
    it('Test 13: statuses no code path ever writes read as real zeros', async () => {
      const res = await fetchAnalytics(adminToken);

      const [expiredDonations, rejectedPickups, cancelledPickups] = await Promise.all([
        prisma.donation.count({ where: { status: 'EXPIRED' } }),
        prisma.pickupRequest.count({ where: { status: 'REJECTED' } }),
        prisma.pickupRequest.count({ where: { status: 'CANCELLED' } }),
      ]);

      // No expiry sweep and no reject/cancel pickup code path exist yet
      // (confirmed across Phases 1-7), so these must be 0 in this test
      // database - and the endpoint must report that real 0, not omit the
      // field or substitute something else.
      expect(expiredDonations).toBe(0);
      expect(cancelledPickups).toBe(0);
      expect(rejectedPickups).toBe(0);
      expect(res.body.donations.expired).toBe(0);
      expect(res.body.pickups.rejected).toBe(0);
      expect(res.body.pickups.cancelled).toBe(0);
    });
  });

  describe('Data leakage (Tests 14-15)', () => {
    it('Test 14: no password hash anywhere in analytics or activity', async () => {
      const analyticsRes = await fetchAnalytics(adminToken);
      expect(JSON.stringify(analyticsRes.body)).not.toContain('"password"');

      const activityRes = await request(app)
        .get('/api/admin/activity')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(JSON.stringify(activityRes.body)).not.toContain('"password"');
    });

    it('Test 15: analytics is aggregate-only - no email, phone, or per-user records', async () => {
      const res = await fetchAnalytics(adminToken);
      const text = JSON.stringify(res.body);

      expect(text).not.toContain('@test.foodbridge.local');
      expect(res.body.users).not.toHaveProperty('email');
      expect(res.body.users).not.toHaveProperty('phone');
      expect(Array.isArray(res.body.users)).toBe(false); // an aggregate object, not a list of user rows
    });
  });
});
