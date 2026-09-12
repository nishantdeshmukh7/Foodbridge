import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { pickupService } from '../services/pickup.service.js';
import { config } from '../config/index.js';

// Phase 12.5: two correctness fixes discovered while writing Phase 12's
// final report.
//
// Issue 1 - donationService.getAll() has no ownership concept, so the NGO
// dashboard's "my claims" views (which called it with only a status
// filter) returned every NGO's claimed donations to every NGO. Fixed with
// a dedicated, server-scoped donationService.getByClaimant() /
// GET /api/donations/my-claims (mirrors the existing getByDonor() /
// /my-donations pattern).
//
// Issue 2 - donationService.cancel() let an ADMIN cancel a CLAIMED
// donation even after a volunteer had already accepted the pickup
// (PickupRequest ACCEPTED), leaving Donation=CANCELLED next to a still-
// ACCEPTED PickupRequest a volunteer could keep driving forward. Fixed by
// applying the same PENDING-only reversibility window to ADMIN that
// DONOR already had - see donation.service.ts#cancel's updated comment.

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

async function notificationsFor(recipientId: string) {
  return prisma.notification.findMany({ where: { recipientId }, orderBy: { createdAt: 'asc' } });
}

function signToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

describe('Phase 12.5: NGO claim scoping and admin cancellation consistency', () => {
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

  describe('Issue 1: NGO claim scoping', () => {
    it('an NGO sees its own claims via getByClaimant', async () => {
      const donor = await createUser('DONOR', 's1');
      const ngoA = await createUser('NGO', 's1a');
      const donationA = await createAvailableDonation(donor.id, 's1a');
      await donationService.claim(donationA.id, ngoA.id);

      const claims = await donationService.getByClaimant(ngoA.id);
      expect(claims).toHaveLength(1);
      expect(claims[0].id).toBe(donationA.id);
    });

    it('NGO A does not see NGO B\'s claims via getByClaimant', async () => {
      const donor = await createUser('DONOR', 's2');
      const ngoA = await createUser('NGO', 's2a');
      const ngoB = await createUser('NGO', 's2b');
      const donationA = await createAvailableDonation(donor.id, 's2a');
      const donationB = await createAvailableDonation(donor.id, 's2b');
      await donationService.claim(donationA.id, ngoA.id);
      await donationService.claim(donationB.id, ngoB.id);

      const claimsA = await donationService.getByClaimant(ngoA.id);
      expect(claimsA).toHaveLength(1);
      expect(claimsA[0].id).toBe(donationA.id);
      expect(claimsA.find((d) => d.id === donationB.id)).toBeUndefined();

      const claimsB = await donationService.getByClaimant(ngoB.id);
      expect(claimsB).toHaveLength(1);
      expect(claimsB[0].id).toBe(donationB.id);
    });

    it('an NGO with no claims gets an empty list, not an error or someone else\'s data', async () => {
      const donor = await createUser('DONOR', 's3');
      const otherNgo = await createUser('NGO', 's3-other');
      const emptyNgo = await createUser('NGO', 's3-empty');
      const donation = await createAvailableDonation(donor.id, 's3');
      await donationService.claim(donation.id, otherNgo.id);

      const claims = await donationService.getByClaimant(emptyNgo.id);
      expect(claims).toHaveLength(0);
    });

    it('HTTP: GET /api/donations/my-claims returns only the authenticated NGO\'s records, never another NGO\'s', async () => {
      const donor = await createUser('DONOR', 's4');
      const ngoA = await createUser('NGO', 's4a');
      const ngoB = await createUser('NGO', 's4b');
      const donationA = await createAvailableDonation(donor.id, 's4a');
      const donationB = await createAvailableDonation(donor.id, 's4b');
      await donationService.claim(donationA.id, ngoA.id);
      await donationService.claim(donationB.id, ngoB.id);

      const resA = await request(app)
        .get('/api/donations/my-claims')
        .set('Authorization', `Bearer ${signToken(ngoA)}`);

      expect(resA.status).toBe(200);
      expect(resA.body).toHaveLength(1);
      expect(resA.body[0].id).toBe(donationA.id);
      expect(resA.body.some((d: { id: string }) => d.id === donationB.id)).toBe(false);

      const resB = await request(app)
        .get('/api/donations/my-claims')
        .set('Authorization', `Bearer ${signToken(ngoB)}`);

      expect(resB.status).toBe(200);
      expect(resB.body).toHaveLength(1);
      expect(resB.body[0].id).toBe(donationB.id);
    });

    it('a DONOR cannot use the NGO claims route', async () => {
      const donor = await createUser('DONOR', 's5');

      const res = await request(app)
        .get('/api/donations/my-claims')
        .set('Authorization', `Bearer ${signToken(donor)}`);

      expect(res.status).toBe(403);
    });

    it('a VOLUNTEER cannot use the NGO claims route', async () => {
      const volunteer = await createUser('VOLUNTEER', 's6');

      const res = await request(app)
        .get('/api/donations/my-claims')
        .set('Authorization', `Bearer ${signToken(volunteer)}`);

      expect(res.status).toBe(403);
    });

    it('an ADMIN cannot use the NGO-only claims route (admin has no "own claims")', async () => {
      const admin = await createUser('ADMIN', 's7');

      const res = await request(app)
        .get('/api/donations/my-claims')
        .set('Authorization', `Bearer ${signToken(admin)}`);

      expect(res.status).toBe(403);
    });

    it('an unauthenticated request is rejected', async () => {
      const res = await request(app).get('/api/donations/my-claims');
      expect(res.status).toBe(401);
    });

    it('existing contact-privacy rules are preserved: the claiming NGO still sees donor phone, and volunteer phone once assigned', async () => {
      const donor = await createUser('DONOR', 's8');
      const ngo = await createUser('NGO', 's8');
      const volunteer = await createUser('VOLUNTEER', 's8');
      await prisma.user.update({ where: { id: donor.id }, data: { phone: '+91-555-0001' } });
      await prisma.user.update({ where: { id: volunteer.id }, data: { phone: '+91-555-0002' } });
      const donation = await createAvailableDonation(donor.id, 's8');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      const res = await request(app)
        .get('/api/donations/my-claims')
        .set('Authorization', `Bearer ${signToken(ngo)}`);

      expect(res.status).toBe(200);
      const row = res.body[0];
      expect(row.donor.phone).not.toBeNull();
      expect(row.pickupRequest.volunteer.phone).not.toBeNull();
    });

    it('status filtering still works within the scoped query (?status=CLAIMED)', async () => {
      const donor = await createUser('DONOR', 's9');
      const ngo = await createUser('NGO', 's9');
      const volunteer = await createUser('VOLUNTEER', 's9');
      const donationClaimed = await createAvailableDonation(donor.id, 's9a');
      const donationDelivered = await createAvailableDonation(donor.id, 's9b');
      await donationService.claim(donationClaimed.id, ngo.id);
      const pickup2 = await claimAndGetPickup(donationDelivered.id, ngo.id);
      await pickupService.acceptPickup(pickup2.id, volunteer.id);
      await pickupService.markPickedUp(pickup2.id, volunteer.id);
      await pickupService.completeDelivery(pickup2.id, volunteer.id);

      const claimsOnly = await donationService.getByClaimant(ngo.id, { status: 'CLAIMED' });
      expect(claimsOnly.map((d) => d.id)).toEqual([donationClaimed.id]);

      const all = await donationService.getByClaimant(ngo.id);
      expect(all).toHaveLength(2);
    });
  });

  describe('Issue 2: admin cancellation vs PickupRequest consistency', () => {
    it('ADMIN cancels CLAIMED + PENDING pickup - allowed, pickup request removed, notifications correct', async () => {
      const donor = await createUser('DONOR', 't1');
      const ngo = await createUser('NGO', 't1');
      const admin = await createUser('ADMIN', 't1');
      const donation = await createAvailableDonation(donor.id, 't1');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const cancelled = await donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN' });

      expect(cancelled.status).toBe('CANCELLED');
      const pickupGone = await prisma.pickupRequest.findUnique({ where: { id: pickupRequest.id } });
      expect(pickupGone).toBeNull();

      const donorNotes = (await notificationsFor(donor.id)).filter((n) => n.type === 'DONATION_CANCELLED');
      const ngoNotes = (await notificationsFor(ngo.id)).filter((n) => n.type === 'DONATION_CANCELLED');
      expect(donorNotes).toHaveLength(1);
      expect(ngoNotes).toHaveLength(1);
    });

    it('ADMIN cancels CLAIMED + ACCEPTED pickup - now rejected (Phase 12.5 fix); donation and pickup both remain correct, no notification', async () => {
      const donor = await createUser('DONOR', 't2');
      const ngo = await createUser('NGO', 't2');
      const volunteer = await createUser('VOLUNTEER', 't2');
      const admin = await createUser('ADMIN', 't2');
      const donation = await createAvailableDonation(donor.id, 't2');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      const donorNotesBefore = await notificationsFor(donor.id);

      await expect(
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN' })
      ).rejects.toThrow('already has a volunteer assigned');

      const donationAfter = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(donationAfter.status).toBe('CLAIMED');
      const pickupAfter = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(pickupAfter.status).toBe('ACCEPTED');
      expect(pickupAfter.volunteerId).toBe(volunteer.id);

      const donorNotesAfter = await notificationsFor(donor.id);
      expect(donorNotesAfter).toHaveLength(donorNotesBefore.length);
    });

    it('ADMIN cancels a donation whose pickup has progressed to PICKED_UP - rejected, state and notifications unchanged', async () => {
      const donor = await createUser('DONOR', 't3');
      const ngo = await createUser('NGO', 't3');
      const volunteer = await createUser('VOLUNTEER', 't3');
      const admin = await createUser('ADMIN', 't3');
      const donation = await createAvailableDonation(donor.id, 't3');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);

      const donorNotesBefore = await notificationsFor(donor.id);

      await expect(
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN' })
      ).rejects.toThrow('Cannot cancel a donation with status PICKED_UP');

      const donationAfter = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(donationAfter.status).toBe('PICKED_UP');
      const pickupAfter = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(pickupAfter.status).toBe('PICKED_UP');

      expect(await notificationsFor(donor.id)).toHaveLength(donorNotesBefore.length);
    });

    it('ADMIN cancels a delivered donation (pickup COMPLETED) - rejected, state and notifications unchanged', async () => {
      const donor = await createUser('DONOR', 't4');
      const ngo = await createUser('NGO', 't4');
      const volunteer = await createUser('VOLUNTEER', 't4');
      const admin = await createUser('ADMIN', 't4');
      const donation = await createAvailableDonation(donor.id, 't4');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);
      await pickupService.completeDelivery(pickupRequest.id, volunteer.id);

      const donorNotesBefore = await notificationsFor(donor.id);

      await expect(
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN' })
      ).rejects.toThrow('Cannot cancel a donation with status DELIVERED');

      const donationAfter = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(donationAfter.status).toBe('DELIVERED');
      const pickupAfter = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(pickupAfter.status).toBe('COMPLETED');

      expect(await notificationsFor(donor.id)).toHaveLength(donorNotesBefore.length);
    });

    it('HTTP: an admin cancel attempt on an ACCEPTED pickup returns a clean 400 conflict, not a false success', async () => {
      const donor = await createUser('DONOR', 't5');
      const ngo = await createUser('NGO', 't5');
      const volunteer = await createUser('VOLUNTEER', 't5');
      const admin = await createUser('ADMIN', 't5');
      const donation = await createAvailableDonation(donor.id, 't5');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(admin)}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already has a volunteer assigned');
    });
  });

  describe('Concurrency regression (Phase 12.5)', () => {
    it('new race: admin cancellation vs volunteer acceptance - exactly one wins, no inconsistent state', async () => {
      const donor = await createUser('DONOR', 'c1');
      const ngo = await createUser('NGO', 'c1');
      const volunteer = await createUser('VOLUNTEER', 'c1');
      const admin = await createUser('ADMIN', 'c1');
      const donation = await createAvailableDonation(donor.id, 'c1');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const results = await Promise.allSettled([
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN' }),
        pickupService.acceptPickup(pickupRequest.id, volunteer.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const finalDonation = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });

      if (results[0].status === 'fulfilled') {
        expect(finalDonation.status).toBe('CANCELLED');
        const pickupGone = await prisma.pickupRequest.findUnique({ where: { id: pickupRequest.id } });
        expect(pickupGone).toBeNull();
      } else {
        expect(finalDonation.status).toBe('CLAIMED');
        const pickupAfter = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
        expect(pickupAfter.status).toBe('ACCEPTED');
        expect(pickupAfter.volunteerId).toBe(volunteer.id);
      }
    });

    it('regression: admin cancellation vs admin assignment - exactly one wins', async () => {
      const donor = await createUser('DONOR', 'c2');
      const ngo = await createUser('NGO', 'c2');
      const volunteer = await createUser('VOLUNTEER', 'c2');
      const admin = await createUser('ADMIN', 'c2');
      const donation = await createAvailableDonation(donor.id, 'c2');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const results = await Promise.allSettled([
        donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN' }),
        pickupService.assignVolunteer(pickupRequest.id, volunteer.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
    });

    it('regression: NGO release vs volunteer acceptance still resolves to exactly one winner', async () => {
      const donor = await createUser('DONOR', 'c3');
      const ngo = await createUser('NGO', 'c3');
      const volunteer = await createUser('VOLUNTEER', 'c3');
      const donation = await createAvailableDonation(donor.id, 'c3');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const results = await Promise.allSettled([
        donationService.releaseClaim(donation.id, ngo.id),
        pickupService.acceptPickup(pickupRequest.id, volunteer.id),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('regression: donor cancellation vs volunteer acceptance still resolves to exactly one winner', async () => {
      const donor = await createUser('DONOR', 'c4');
      const ngo = await createUser('NGO', 'c4');
      const volunteer = await createUser('VOLUNTEER', 'c4');
      const donation = await createAvailableDonation(donor.id, 'c4');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const results = await Promise.allSettled([
        donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' }),
        pickupService.acceptPickup(pickupRequest.id, volunteer.id),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });
});
