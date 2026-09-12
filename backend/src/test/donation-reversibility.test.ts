import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { pickupService } from '../services/pickup.service.js';
import { config } from '../config/index.js';

// Phase 12: donor cancellation of a CLAIMED/PENDING donation, and the
// NGO-facing counterpart, claim release. Both share the same reversibility
// window (pickup still PENDING, no volunteer involved) and the same
// data-consistency requirement: after either succeeds, the PickupRequest
// row must be gone entirely (not just marked CANCELLED - see
// donationService.cancel()'s comment on the @unique donationId constraint),
// so nothing can ever accept it and the donation (if released) can be
// claimed fresh by a different NGO.

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

describe('Phase 12: donation cancellation & claim release', () => {
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

  describe('Part A: donor cancellation', () => {
    it('donor cancels their own AVAILABLE donation', async () => {
      const donor = await createUser('DONOR', 'a1');
      const donation = await createAvailableDonation(donor.id, 'a1');

      const cancelled = await donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' });

      expect(cancelled.status).toBe('CANCELLED');
    });

    it('donor cancels their own CLAIMED donation while the pickup is still PENDING', async () => {
      const donor = await createUser('DONOR', 'a2');
      const ngo = await createUser('NGO', 'a2');
      const donation = await createAvailableDonation(donor.id, 'a2');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const cancelled = await donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' });

      expect(cancelled.status).toBe('CANCELLED');
      const pickupAfter = await prisma.pickupRequest.findUnique({ where: { id: pickupRequest.id } });
      expect(pickupAfter).toBeNull();
    });

    it('an unrelated donor cannot cancel someone else\'s donation', async () => {
      const owner = await createUser('DONOR', 'a3-owner');
      const stranger = await createUser('DONOR', 'a3-stranger');
      const donation = await createAvailableDonation(owner.id, 'a3');

      await expect(
        donationService.cancel(donation.id, { id: stranger.id, role: 'DONOR' })
      ).rejects.toThrow('You can only cancel your own donations');

      const unchanged = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(unchanged.status).toBe('AVAILABLE');
    });

    it('an NGO cannot use the donor cancellation route', async () => {
      const donor = await createUser('DONOR', 'a4');
      const ngo = await createUser('NGO', 'a4');
      const donation = await createAvailableDonation(donor.id, 'a4');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(ngo)}`);

      expect(res.status).toBe(403);
      const unchanged = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(unchanged.status).toBe('AVAILABLE');
    });

    it('a volunteer cannot use the donor cancellation route', async () => {
      const donor = await createUser('DONOR', 'a5');
      const volunteer = await createUser('VOLUNTEER', 'a5');
      const donation = await createAvailableDonation(donor.id, 'a5');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(volunteer)}`);

      expect(res.status).toBe(403);
    });

    it('cancellation is rejected once a volunteer has accepted the pickup (ACCEPTED)', async () => {
      const donor = await createUser('DONOR', 'a6');
      const ngo = await createUser('NGO', 'a6');
      const volunteer = await createUser('VOLUNTEER', 'a6');
      const donation = await createAvailableDonation(donor.id, 'a6');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      await expect(
        donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' })
      ).rejects.toThrow('already has a volunteer assigned');

      const unchanged = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(unchanged.status).toBe('CLAIMED');
      const pickupUnchanged = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(pickupUnchanged.status).toBe('ACCEPTED');
    });

    it('cancellation is rejected after pickup (PICKED_UP)', async () => {
      const donor = await createUser('DONOR', 'a7');
      const ngo = await createUser('NGO', 'a7');
      const volunteer = await createUser('VOLUNTEER', 'a7');
      const donation = await createAvailableDonation(donor.id, 'a7');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);

      await expect(
        donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' })
      ).rejects.toThrow('Cannot cancel a donation with status PICKED_UP');

      const unchanged = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(unchanged.status).toBe('PICKED_UP');
    });

    it('cancellation is rejected after delivery (DELIVERED)', async () => {
      const donor = await createUser('DONOR', 'a8');
      const ngo = await createUser('NGO', 'a8');
      const volunteer = await createUser('VOLUNTEER', 'a8');
      const donation = await createAvailableDonation(donor.id, 'a8');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);
      await pickupService.completeDelivery(pickupRequest.id, volunteer.id);

      await expect(
        donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' })
      ).rejects.toThrow('Cannot cancel a donation with status DELIVERED');
    });

    it('an already-cancelled donation cannot be cancelled again', async () => {
      const donor = await createUser('DONOR', 'a9');
      const donation = await createAvailableDonation(donor.id, 'a9');
      await donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' });

      await expect(
        donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' })
      ).rejects.toThrow('Cannot cancel a donation with status CANCELLED');
    });

    it('cancelling a CLAIMED donation notifies the claiming NGO, not the donor themselves', async () => {
      const donor = await createUser('DONOR', 'a10');
      const ngo = await createUser('NGO', 'a10');
      const donation = await createAvailableDonation(donor.id, 'a10');
      await claimAndGetPickup(donation.id, ngo.id);

      await donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' });

      const ngoNotes = (await notificationsFor(ngo.id)).filter((n) => n.type === 'DONATION_CANCELLED');
      expect(ngoNotes).toHaveLength(1);
      expect(ngoNotes[0].donationId).toBe(donation.id);

      // The donor never receives a notification about their own action.
      const donorNotes = await notificationsFor(donor.id);
      expect(donorNotes.find((n) => n.type === 'DONATION_CANCELLED')).toBeUndefined();
    });

    it('a failed cancellation creates no notification', async () => {
      const donor = await createUser('DONOR', 'a11');
      const ngo = await createUser('NGO', 'a11');
      const volunteer = await createUser('VOLUNTEER', 'a11');
      const donation = await createAvailableDonation(donor.id, 'a11');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      const ngoNotesBefore = await notificationsFor(ngo.id);

      await expect(
        donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' })
      ).rejects.toThrow();

      const ngoNotesAfter = await notificationsFor(ngo.id);
      expect(ngoNotesAfter).toHaveLength(ngoNotesBefore.length);
    });
  });

  describe('Part B: NGO claim release', () => {
    it('the claiming NGO releases a CLAIMED/PENDING donation back to AVAILABLE', async () => {
      const donor = await createUser('DONOR', 'b1');
      const ngo = await createUser('NGO', 'b1');
      const donation = await createAvailableDonation(donor.id, 'b1');
      await claimAndGetPickup(donation.id, ngo.id);

      const released = await donationService.releaseClaim(donation.id, ngo.id);

      expect(released.status).toBe('AVAILABLE');
      expect(released.claimedById).toBeNull();
    });

    it('an unrelated NGO cannot release someone else\'s claim', async () => {
      const donor = await createUser('DONOR', 'b2');
      const claimingNgo = await createUser('NGO', 'b2-claiming');
      const otherNgo = await createUser('NGO', 'b2-other');
      const donation = await createAvailableDonation(donor.id, 'b2');
      await claimAndGetPickup(donation.id, claimingNgo.id);

      await expect(donationService.releaseClaim(donation.id, otherNgo.id)).rejects.toThrow(
        'You can only release your own claim'
      );

      const unchanged = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(unchanged.status).toBe('CLAIMED');
      expect(unchanged.claimedById).toBe(claimingNgo.id);
    });

    it('a donor cannot use the NGO release route', async () => {
      const donor = await createUser('DONOR', 'b3');
      const ngo = await createUser('NGO', 'b3');
      const donation = await createAvailableDonation(donor.id, 'b3');
      await claimAndGetPickup(donation.id, ngo.id);

      const res = await request(app)
        .post(`/api/donations/${donation.id}/release`)
        .set('Authorization', `Bearer ${signToken(donor)}`);

      expect(res.status).toBe(403);
    });

    it('a volunteer cannot use the NGO release route', async () => {
      const donor = await createUser('DONOR', 'b4');
      const ngo = await createUser('NGO', 'b4');
      const volunteer = await createUser('VOLUNTEER', 'b4');
      const donation = await createAvailableDonation(donor.id, 'b4');
      await claimAndGetPickup(donation.id, ngo.id);

      const res = await request(app)
        .post(`/api/donations/${donation.id}/release`)
        .set('Authorization', `Bearer ${signToken(volunteer)}`);

      expect(res.status).toBe(403);
    });

    it('release is rejected once a volunteer has accepted the pickup', async () => {
      const donor = await createUser('DONOR', 'b5');
      const ngo = await createUser('NGO', 'b5');
      const volunteer = await createUser('VOLUNTEER', 'b5');
      const donation = await createAvailableDonation(donor.id, 'b5');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      await expect(donationService.releaseClaim(donation.id, ngo.id)).rejects.toThrow(
        'already has a volunteer assigned'
      );

      const unchanged = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(unchanged.status).toBe('CLAIMED');
    });

    it('release is rejected after pickup (PICKED_UP)', async () => {
      const donor = await createUser('DONOR', 'b6');
      const ngo = await createUser('NGO', 'b6');
      const volunteer = await createUser('VOLUNTEER', 'b6');
      const donation = await createAvailableDonation(donor.id, 'b6');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);

      await expect(donationService.releaseClaim(donation.id, ngo.id)).rejects.toThrow(
        'Cannot release a claim on a donation with status PICKED_UP'
      );
    });

    it('release is rejected after delivery (DELIVERED)', async () => {
      const donor = await createUser('DONOR', 'b7');
      const ngo = await createUser('NGO', 'b7');
      const volunteer = await createUser('VOLUNTEER', 'b7');
      const donation = await createAvailableDonation(donor.id, 'b7');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);
      await pickupService.completeDelivery(pickupRequest.id, volunteer.id);

      await expect(donationService.releaseClaim(donation.id, ngo.id)).rejects.toThrow(
        'Cannot release a claim on a donation with status DELIVERED'
      );
    });

    it('a released donation can be claimed by a different NGO', async () => {
      const donor = await createUser('DONOR', 'b8');
      const ngoA = await createUser('NGO', 'b8a');
      const ngoB = await createUser('NGO', 'b8b');
      const donation = await createAvailableDonation(donor.id, 'b8');
      await claimAndGetPickup(donation.id, ngoA.id);
      await donationService.releaseClaim(donation.id, ngoA.id);

      const reclaimed = await donationService.claim(donation.id, ngoB.id);

      expect(reclaimed.status).toBe('CLAIMED');
      expect(reclaimed.claimedById).toBe(ngoB.id);
      const newPickup = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });
      expect(newPickup.status).toBe('PENDING');
    });

    it('after release, the old PickupRequest no longer exists and cannot be accepted or found in the available-pickups list', async () => {
      const donor = await createUser('DONOR', 'b9');
      const ngo = await createUser('NGO', 'b9');
      const volunteer = await createUser('VOLUNTEER', 'b9');
      const donation = await createAvailableDonation(donor.id, 'b9');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      await donationService.releaseClaim(donation.id, ngo.id);

      const gone = await prisma.pickupRequest.findUnique({ where: { id: pickupRequest.id } });
      expect(gone).toBeNull();

      await expect(pickupService.acceptPickup(pickupRequest.id, volunteer.id)).rejects.toThrow(
        'Pickup request not found'
      );

      const available = await pickupService.getAvailablePickups();
      expect(available.find((p) => p.id === pickupRequest.id)).toBeUndefined();
    });

    it('release notifies the donor (DONATION_RELEASED), not the releasing NGO', async () => {
      const donor = await createUser('DONOR', 'b10');
      const ngo = await createUser('NGO', 'b10');
      const donation = await createAvailableDonation(donor.id, 'b10');
      await claimAndGetPickup(donation.id, ngo.id);

      await donationService.releaseClaim(donation.id, ngo.id);

      const donorNotes = (await notificationsFor(donor.id)).filter((n) => n.type === 'DONATION_RELEASED');
      expect(donorNotes).toHaveLength(1);
      expect(donorNotes[0].donationId).toBe(donation.id);

      const ngoNotes = await notificationsFor(ngo.id);
      expect(ngoNotes.find((n) => n.type === 'DONATION_RELEASED')).toBeUndefined();
    });

    it('a failed release creates no notification', async () => {
      const donor = await createUser('DONOR', 'b11');
      const ngo = await createUser('NGO', 'b11');
      const volunteer = await createUser('VOLUNTEER', 'b11');
      const donation = await createAvailableDonation(donor.id, 'b11');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      const donorNotesBefore = await notificationsFor(donor.id);

      await expect(donationService.releaseClaim(donation.id, ngo.id)).rejects.toThrow();

      const donorNotesAfter = await notificationsFor(donor.id);
      expect(donorNotesAfter).toHaveLength(donorNotesBefore.length);
    });
  });

  describe('Part C: concurrency', () => {
    it('Race 1: donor cancel vs volunteer accept - exactly one wins, no duplicate/spurious notifications', async () => {
      const donor = await createUser('DONOR', 'c1');
      const ngo = await createUser('NGO', 'c1');
      const volunteer = await createUser('VOLUNTEER', 'c1');
      const donation = await createAvailableDonation(donor.id, 'c1');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const results = await Promise.allSettled([
        donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' }),
        pickupService.acceptPickup(pickupRequest.id, volunteer.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const finalDonation = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });

      if (results[0].status === 'fulfilled') {
        // Cancellation won.
        expect(finalDonation.status).toBe('CANCELLED');
        const pickupGone = await prisma.pickupRequest.findUnique({ where: { id: pickupRequest.id } });
        expect(pickupGone).toBeNull();
      } else {
        // Acceptance won - donation must remain claimed, pickup ACCEPTED.
        expect(finalDonation.status).toBe('CLAIMED');
        const pickupAfter = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
        expect(pickupAfter.status).toBe('ACCEPTED');
        expect(pickupAfter.volunteerId).toBe(volunteer.id);
      }

      // Exactly the notifications the winning transition produces - never both.
      const ngoNotes = (await notificationsFor(ngo.id)).filter(
        (n) => n.type === 'DONATION_CANCELLED' || n.type === 'PICKUP_ACCEPTED'
      );
      expect(ngoNotes).toHaveLength(1);
    });

    it('Race 2: NGO release vs volunteer accept - exactly one wins', async () => {
      const donor = await createUser('DONOR', 'c2');
      const ngo = await createUser('NGO', 'c2');
      const volunteer = await createUser('VOLUNTEER', 'c2');
      const donation = await createAvailableDonation(donor.id, 'c2');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const results = await Promise.allSettled([
        donationService.releaseClaim(donation.id, ngo.id),
        pickupService.acceptPickup(pickupRequest.id, volunteer.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
      const releaseWon = results[0].status === 'fulfilled';

      const finalDonation = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });

      if (releaseWon) {
        // Release won: donation available again, pickup gone, no volunteer notified.
        expect(finalDonation.status).toBe('AVAILABLE');
        expect(finalDonation.claimedById).toBeNull();
        const pickupGone = await prisma.pickupRequest.findUnique({ where: { id: pickupRequest.id } });
        expect(pickupGone).toBeNull();
        expect(await notificationsFor(volunteer.id)).toHaveLength(0);
      } else {
        // Acceptance won: donation stays claimed, release must have failed.
        expect(finalDonation.status).toBe('CLAIMED');
        expect(finalDonation.claimedById).toBe(ngo.id);
        const pickupAfter = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
        expect(pickupAfter.status).toBe('ACCEPTED');
      }

      const donorReleaseNotes = (await notificationsFor(donor.id)).filter((n) => n.type === 'DONATION_RELEASED');
      expect(donorReleaseNotes).toHaveLength(releaseWon ? 1 : 0);
    });

    it('Race 3: NGO release vs admin assignment - exactly one wins', async () => {
      const donor = await createUser('DONOR', 'c3');
      const ngo = await createUser('NGO', 'c3');
      const volunteer = await createUser('VOLUNTEER', 'c3');
      const donation = await createAvailableDonation(donor.id, 'c3');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);

      const results = await Promise.allSettled([
        donationService.releaseClaim(donation.id, ngo.id),
        pickupService.assignVolunteer(pickupRequest.id, volunteer.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const finalDonation = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });

      if (results[0].status === 'fulfilled') {
        expect(finalDonation.status).toBe('AVAILABLE');
        const pickupGone = await prisma.pickupRequest.findUnique({ where: { id: pickupRequest.id } });
        expect(pickupGone).toBeNull();
        expect(await notificationsFor(volunteer.id)).toHaveLength(0);
      } else {
        expect(finalDonation.status).toBe('CLAIMED');
        const pickupAfter = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
        expect(pickupAfter.status).toBe('ACCEPTED');
        expect(pickupAfter.volunteerId).toBe(volunteer.id);
      }
    });
  });

  describe('Part D: HTTP authorization surface', () => {
    it('an unauthenticated cancel request is rejected', async () => {
      const donor = await createUser('DONOR', 'd1');
      const donation = await createAvailableDonation(donor.id, 'd1');

      const res = await request(app).post(`/api/donations/${donation.id}/cancel`);
      expect(res.status).toBe(401);
    });

    it('an unauthenticated release request is rejected', async () => {
      const donor = await createUser('DONOR', 'd2');
      const ngo = await createUser('NGO', 'd2');
      const donation = await createAvailableDonation(donor.id, 'd2');
      await claimAndGetPickup(donation.id, ngo.id);

      const res = await request(app).post(`/api/donations/${donation.id}/release`);
      expect(res.status).toBe(401);
    });

    it('the owning donor can cancel through the real HTTP route', async () => {
      const donor = await createUser('DONOR', 'd3');
      const donation = await createAvailableDonation(donor.id, 'd3');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(donor)}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('the claiming NGO can release through the real HTTP route', async () => {
      const donor = await createUser('DONOR', 'd4');
      const ngo = await createUser('NGO', 'd4');
      const donation = await createAvailableDonation(donor.id, 'd4');
      await claimAndGetPickup(donation.id, ngo.id);

      const res = await request(app)
        .post(`/api/donations/${donation.id}/release`)
        .set('Authorization', `Bearer ${signToken(ngo)}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('AVAILABLE');
    });

    it('an illegal-state conflict returns a clear 400, not a false success', async () => {
      const donor = await createUser('DONOR', 'd5');
      const ngo = await createUser('NGO', 'd5');
      const volunteer = await createUser('VOLUNTEER', 'd5');
      const donation = await createAvailableDonation(donor.id, 'd5');
      const pickupRequest = await claimAndGetPickup(donation.id, ngo.id);
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(donor)}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already has a volunteer assigned');
    });
  });
});
