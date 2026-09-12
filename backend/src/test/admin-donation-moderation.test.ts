import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { pickupService } from '../services/pickup.service.js';
import { config } from '../config/index.js';

// Phase 14: admin donation moderation. The state machine itself
// (donationService.cancel's AVAILABLE / CLAIMED+PENDING / rejection of
// everything past PENDING) was already built and extensively tested in
// Phases 12 and 12.5 - this file focuses on what's actually new: the
// AdminLog audit trail for admin-initiated cancellations, the HTTP-level
// authorization matrix for the moderation use case specifically, and
// re-confirming (with AdminLog assertions added) that a rejected
// moderation attempt leaves no audit trace.

const TEST_EMAIL_SUFFIX = '@test.foodbridge.local';

type Role = 'ADMIN' | 'DONOR' | 'NGO' | 'VOLUNTEER';

async function createUser(role: Role, suffix: string) {
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}${TEST_EMAIL_SUFFIX}`,
      password: await bcrypt.hash('password123', 4),
      name: `${role} ${suffix}`,
      role,
      isApproved: true,
      isActive: true,
    },
  });
}

async function createAvailableDonation(donorId: string, suffix: string) {
  return prisma.donation.create({
    data: {
      foodType: `Test Meal ${suffix}`,
      quantity: '10 servings',
      expiryTime: new Date(Date.now() + 60 * 60 * 1000),
      pickupLocation: `Test Kitchen ${suffix}`,
      status: 'AVAILABLE',
      donorId,
    },
  });
}

async function claimAndGetPickup(donationId: string, ngoId: string) {
  await donationService.claim(donationId, ngoId);
  return prisma.pickupRequest.findUniqueOrThrow({ where: { donationId } });
}

async function adminLogsFor(donationId: string) {
  return prisma.adminLog.findMany({
    where: { action: 'DONATION_CANCELLED', details: { contains: donationId } },
  });
}

function signToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

describe('Phase 14: admin donation moderation', () => {
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
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Part A: authorization', () => {
    it('ADMIN succeeds via the real HTTP route', async () => {
      const donor = await createUser('DONOR', 'a1');
      const admin = await createUser('ADMIN', 'a1');
      const donation = await createAvailableDonation(donor.id, 'a1');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(admin)}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('a DONOR cannot use this to moderate a donation that is not their own', async () => {
      const owner = await createUser('DONOR', 'a2-owner');
      const otherDonor = await createUser('DONOR', 'a2-other');
      const donation = await createAvailableDonation(owner.id, 'a2');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(otherDonor)}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('own donations');
      const unchanged = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(unchanged.status).toBe('AVAILABLE');
    });

    it('NGO is rejected at the route level', async () => {
      const donor = await createUser('DONOR', 'a3');
      const ngo = await createUser('NGO', 'a3');
      const donation = await createAvailableDonation(donor.id, 'a3');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(ngo)}`);

      expect(res.status).toBe(403);
    });

    it('VOLUNTEER is rejected at the route level', async () => {
      const donor = await createUser('DONOR', 'a4');
      const volunteer = await createUser('VOLUNTEER', 'a4');
      const donation = await createAvailableDonation(donor.id, 'a4');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(volunteer)}`);

      expect(res.status).toBe(403);
    });

    it('an unauthenticated request is rejected', async () => {
      const donor = await createUser('DONOR', 'a5');
      const donation = await createAvailableDonation(donor.id, 'a5');

      const res = await request(app).post(`/api/donations/${donation.id}/cancel`);
      expect(res.status).toBe(401);
    });

    it('the admin identity recorded in AdminLog comes from the JWT, not any client-supplied field', async () => {
      const donor = await createUser('DONOR', 'a6');
      const admin = await createUser('ADMIN', 'a6');
      const impersonated = await createUser('ADMIN', 'a6-impersonated');
      const donation = await createAvailableDonation(donor.id, 'a6');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        // Attempt to smuggle a different actor identity through the body -
        // the route/controller/service never read anything from the body
        // for this endpoint, only req.user from the verified JWT.
        .send({ adminId: impersonated.id, userId: impersonated.id, actorEmail: impersonated.email })
        .set('Authorization', `Bearer ${signToken(admin)}`);

      expect(res.status).toBe(200);
      const logs = await adminLogsFor(donation.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toContain(admin.email);
      expect(logs[0].details).not.toContain(impersonated.email);
    });
  });

  describe('Part B: AVAILABLE cancellation', () => {
    it('succeeds, reaches CANCELLED, and creates a matching AdminLog entry', async () => {
      const donor = await createUser('DONOR', 'b1');
      const admin = await createUser('ADMIN', 'b1');
      const donation = await createAvailableDonation(donor.id, 'b1');

      const cancelled = await donationService.cancel(donation.id, {
        id: admin.id,
        role: 'ADMIN',
        email: admin.email,
      });

      expect(cancelled.status).toBe('CANCELLED');
      const logs = await adminLogsFor(donation.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('warning');
      expect(logs[0].userId).toBe(donor.id);
      expect(logs[0].details).toContain('Previous status: AVAILABLE');
      expect(logs[0].details).toContain(admin.email);
    });
  });

  describe('Part C: CLAIMED + PENDING cancellation', () => {
    it('succeeds, removes the PickupRequest, notifies donor and NGO, and logs the action', async () => {
      const donor = await createUser('DONOR', 'c1');
      const ngo = await createUser('NGO', 'c1');
      const admin = await createUser('ADMIN', 'c1');
      const donation = await createAvailableDonation(donor.id, 'c1');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const cancelled = await donationService.cancel(donation.id, {
        id: admin.id,
        role: 'ADMIN',
        email: admin.email,
      });

      expect(cancelled.status).toBe('CANCELLED');
      const pickupGone = await prisma.pickupRequest.findUnique({ where: { id: pickupRequest.id } });
      expect(pickupGone).toBeNull();

      const donorNotes = await prisma.notification.findMany({
        where: { recipientId: donor.id, type: 'DONATION_CANCELLED' },
      });
      const ngoNotes = await prisma.notification.findMany({
        where: { recipientId: ngo.id, type: 'DONATION_CANCELLED' },
      });
      expect(donorNotes).toHaveLength(1);
      expect(ngoNotes).toHaveLength(1);

      const logs = await adminLogsFor(donation.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toContain('Previous status: CLAIMED');
    });
  });

  describe('Part D: CLAIMED + ACCEPTED is rejected (Phase 12.5 rule, re-verified with audit assertions)', () => {
    it('rejects, leaves the donation, pickup, and volunteer assignment untouched, and writes no audit entry or notification', async () => {
      const donor = await createUser('DONOR', 'd1');
      const ngo = await createUser('NGO', 'd1');
      const volunteer = await createUser('VOLUNTEER', 'd1');
      const admin = await createUser('ADMIN', 'd1');
      const donation = await createAvailableDonation(donor.id, 'd1');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      await expect(
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN', email: admin.email })
      ).rejects.toThrow('already has a volunteer assigned');

      const donationAfter = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(donationAfter.status).toBe('CLAIMED');
      const pickupAfter = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(pickupAfter.status).toBe('ACCEPTED');
      expect(pickupAfter.volunteerId).toBe(volunteer.id);

      expect(await adminLogsFor(donation.id)).toHaveLength(0);
      const donorNotes = await prisma.notification.findMany({
        where: { recipientId: donor.id, type: 'DONATION_CANCELLED' },
      });
      expect(donorNotes).toHaveLength(0);
    });
  });

  describe('Part E: PICKED_UP is rejected', () => {
    it('rejects and leaves all state intact, with no audit entry', async () => {
      const donor = await createUser('DONOR', 'e1');
      const ngo = await createUser('NGO', 'e1');
      const volunteer = await createUser('VOLUNTEER', 'e1');
      const admin = await createUser('ADMIN', 'e1');
      const donation = await createAvailableDonation(donor.id, 'e1');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);

      await expect(
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN', email: admin.email })
      ).rejects.toThrow('Cannot cancel a donation with status PICKED_UP');

      const donationAfter = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(donationAfter.status).toBe('PICKED_UP');
      const pickupAfter = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(pickupAfter.status).toBe('PICKED_UP');
      expect(await adminLogsFor(donation.id)).toHaveLength(0);
    });
  });

  describe('Part F: DELIVERED is rejected', () => {
    it('rejects and leaves all state intact, with no audit entry', async () => {
      const donor = await createUser('DONOR', 'f1');
      const ngo = await createUser('NGO', 'f1');
      const volunteer = await createUser('VOLUNTEER', 'f1');
      const admin = await createUser('ADMIN', 'f1');
      const donation = await createAvailableDonation(donor.id, 'f1');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);
      await pickupService.completeDelivery(pickupRequest.id, volunteer.id);

      await expect(
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN', email: admin.email })
      ).rejects.toThrow('Cannot cancel a donation with status DELIVERED');

      const donationAfter = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(donationAfter.status).toBe('DELIVERED');
      const pickupAfter = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(pickupAfter.status).toBe('COMPLETED');
      expect(await adminLogsFor(donation.id)).toHaveLength(0);
    });
  });

  describe('Part G: already-CANCELLED is rejected', () => {
    it('rejects a second cancellation, and does not create a duplicate audit entry', async () => {
      const donor = await createUser('DONOR', 'g1');
      const admin = await createUser('ADMIN', 'g1');
      const donation = await createAvailableDonation(donor.id, 'g1');

      await donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN', email: admin.email });
      expect(await adminLogsFor(donation.id)).toHaveLength(1);

      await expect(
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN', email: admin.email })
      ).rejects.toThrow('Cannot cancel a donation with status CANCELLED');

      // Still exactly one - the rejected second attempt added nothing.
      expect(await adminLogsFor(donation.id)).toHaveLength(1);
    });
  });

  describe('Part H: EXPIRED is rejected', () => {
    it('rejects a donation in the (currently writer-less) EXPIRED state, with no audit entry', async () => {
      const donor = await createUser('DONOR', 'h1');
      const admin = await createUser('ADMIN', 'h1');
      const donation = await createAvailableDonation(donor.id, 'h1');
      // Nothing in the app ever writes EXPIRED (no sweep job exists) - set
      // it directly to exercise the terminal-state guard for this status.
      await prisma.donation.update({ where: { id: donation.id }, data: { status: 'EXPIRED' } });

      await expect(
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN', email: admin.email })
      ).rejects.toThrow('Cannot cancel a donation with status EXPIRED');

      const donationAfter = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(donationAfter.status).toBe('EXPIRED');
      expect(await adminLogsFor(donation.id)).toHaveLength(0);
    });
  });

  describe('Part I: concurrency, with audit-trail assertions', () => {
    it('admin cancellation vs volunteer acceptance: an AdminLog entry exists if and only if the cancellation won', async () => {
      const donor = await createUser('DONOR', 'i1');
      const ngo = await createUser('NGO', 'i1');
      const volunteer = await createUser('VOLUNTEER', 'i1');
      const admin = await createUser('ADMIN', 'i1');
      const donation = await createAvailableDonation(donor.id, 'i1');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const results = await Promise.allSettled([
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN', email: admin.email }),
        pickupService.acceptPickup(pickupRequest.id, volunteer.id),
      ]);

      const cancelWon = results[0].status === 'fulfilled';
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const logs = await adminLogsFor(donation.id);
      expect(logs).toHaveLength(cancelWon ? 1 : 0);

      const finalDonation = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(finalDonation.status).toBe(cancelWon ? 'CANCELLED' : 'CLAIMED');
    });

    it('admin cancellation vs admin assignment: an AdminLog entry exists if and only if the cancellation won', async () => {
      const donor = await createUser('DONOR', 'i2');
      const ngo = await createUser('NGO', 'i2');
      const volunteer = await createUser('VOLUNTEER', 'i2');
      const admin = await createUser('ADMIN', 'i2');
      const donation = await createAvailableDonation(donor.id, 'i2');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const results = await Promise.allSettled([
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN', email: admin.email }),
        pickupService.assignVolunteer(pickupRequest.id, volunteer.id),
      ]);

      const cancelWon = results[0].status === 'fulfilled';
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const logs = await adminLogsFor(donation.id);
      expect(logs).toHaveLength(cancelWon ? 1 : 0);
    });
  });
});
