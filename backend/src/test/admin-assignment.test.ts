import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { pickupService } from '../services/pickup.service.js';
import { config } from '../config/index.js';

// Phase 4: canonical admin volunteer assignment.
//
// Service-level cases exercise pickupService.assignVolunteer() directly
// against the real test database (fast, precise error assertions). The
// authorization matrix (Part F) additionally goes through the real Express
// app via supertest, since that is what actually proves the route chain
// (authenticate -> requireApproved -> authorize('ADMIN') -> controller ->
// service) rejects the wrong roles, not just the service function in
// isolation.

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

async function createAvailableDonation(donorId: string, suffix: string) {
  return prisma.donation.create({
    data: {
      foodType: 'Test Meal',
      quantity: '10 servings',
      expiryTime: new Date(Date.now() + 60 * 60 * 1000),
      pickupLocation: `Test Kitchen ${suffix}`,
      status: 'AVAILABLE',
      donorId,
    },
  });
}

async function createPendingPickup(suffix: string) {
  const donor = await createUser('DONOR', `${suffix}-donor`);
  const ngo = await createUser('NGO', `${suffix}-ngo`);
  const donation = await createAvailableDonation(donor.id, suffix);
  await donationService.claim(donation.id, ngo.id);
  const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
    where: { donationId: donation.id },
  });
  return { donor, ngo, donation, pickupRequest };
}

// Signs a real, valid JWT directly rather than going through POST
// /auth/login - that route is behind Phase 3's login rate limiter, which is
// shared (in-memory, per IP) across every test file that imports app.js in
// this same test run, including auth-security.test.ts's own test that
// deliberately trips it. Signing directly here tests exactly what this
// phase is about (the /assign route's authorization), without colliding
// with a limiter this phase isn't testing.
function signToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

describe('Phase 4: canonical admin volunteer assignment', () => {
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

  describe('Validation (Tests 6-9)', () => {
    it('Test 6: assigning a non-existent volunteer is rejected', async () => {
      const { pickupRequest } = await createPendingPickup('val1');

      await expect(
        pickupService.assignVolunteer(pickupRequest.id, 'does-not-exist')
      ).rejects.toThrow('Volunteer not found');

      const unchanged = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(unchanged.status).toBe('PENDING');
      expect(unchanged.volunteerId).toBeNull();
    });

    it('Test 7: a DONOR cannot be assigned as the volunteer', async () => {
      const { pickupRequest } = await createPendingPickup('val2');
      const notAVolunteer = await createUser('DONOR', 'val2-notvol');

      await expect(
        pickupService.assignVolunteer(pickupRequest.id, notAVolunteer.id)
      ).rejects.toThrow('Selected user is not a volunteer');
    });

    it('Test 7: an NGO cannot be assigned as the volunteer', async () => {
      const { pickupRequest } = await createPendingPickup('val3');
      const notAVolunteer = await createUser('NGO', 'val3-notvol');

      await expect(
        pickupService.assignVolunteer(pickupRequest.id, notAVolunteer.id)
      ).rejects.toThrow('Selected user is not a volunteer');
    });

    it('a suspended (inactive) volunteer cannot be assigned', async () => {
      const { pickupRequest } = await createPendingPickup('val4');
      const suspended = await createUser('VOLUNTEER', 'val4-suspended', { isActive: false });

      await expect(
        pickupService.assignVolunteer(pickupRequest.id, suspended.id)
      ).rejects.toThrow('Selected volunteer is not eligible for assignment');
    });

    it('Test 8: assigning to a non-existent pickup is rejected', async () => {
      const volunteer = await createUser('VOLUNTEER', 'val5');

      await expect(
        pickupService.assignVolunteer('does-not-exist', volunteer.id)
      ).rejects.toThrow('Pickup request not found');
    });

    it('Test 9: assignment on an already-COMPLETED pickup is rejected (status guard, same volunteer)', async () => {
      const { pickupRequest } = await createPendingPickup('val6');
      const volunteer1 = await createUser('VOLUNTEER', 'val6-first');

      await pickupService.acceptPickup(pickupRequest.id, volunteer1.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer1.id);
      await pickupService.completeDelivery(pickupRequest.id, volunteer1.id);

      // Same volunteer, so the "already accepted by another volunteer"
      // branch doesn't apply - this isolates the status guard itself.
      await expect(
        pickupService.assignVolunteer(pickupRequest.id, volunteer1.id)
      ).rejects.toThrow('Cannot accept a pickup request with status COMPLETED');
    });

    it('Test 9: assignment on an already-COMPLETED pickup is rejected for a different volunteer too', async () => {
      const { pickupRequest } = await createPendingPickup('val6b');
      const volunteer1 = await createUser('VOLUNTEER', 'val6b-first');
      const volunteer2 = await createUser('VOLUNTEER', 'val6b-second');

      await pickupService.acceptPickup(pickupRequest.id, volunteer1.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer1.id);
      await pickupService.completeDelivery(pickupRequest.id, volunteer1.id);

      await expect(
        pickupService.assignVolunteer(pickupRequest.id, volunteer2.id)
      ).rejects.toThrow('already been accepted by another volunteer');

      const unchanged = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(unchanged.status).toBe('COMPLETED');
      expect(unchanged.volunteerId).toBe(volunteer1.id);
    });

    it('no silent reassignment: assigning a second volunteer to an already-assigned pickup is rejected', async () => {
      const { pickupRequest } = await createPendingPickup('val7');
      const volunteer1 = await createUser('VOLUNTEER', 'val7-first');
      const volunteer2 = await createUser('VOLUNTEER', 'val7-second');

      await pickupService.assignVolunteer(pickupRequest.id, volunteer1.id);

      await expect(
        pickupService.assignVolunteer(pickupRequest.id, volunteer2.id)
      ).rejects.toThrow('already been accepted by another volunteer');

      const stillFirst = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(stillFirst.volunteerId).toBe(volunteer1.id);
    });
  });

  describe('State integrity (Tests 10-15)', () => {
    it('Tests 10-15: admin assignment stays at CLAIMED/ACCEPTED and the volunteer completes the rest of the canonical flow', async () => {
      const { donation, pickupRequest } = await createPendingPickup('state1');
      const volunteer = await createUser('VOLUNTEER', 'state1');

      const assigned = await pickupService.assignVolunteer(pickupRequest.id, volunteer.id);
      expect(assigned.status).toBe('ACCEPTED');
      expect(assigned.volunteerId).toBe(volunteer.id);

      // Test 10 & 11: assignment must not skip ahead to PICKED_UP - the
      // donation stays CLAIMED until the volunteer actually picks it up.
      const donationAfterAssign = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(donationAfterAssign.status).toBe('CLAIMED');

      // Test 12: the assigned volunteer can perform the legal pickup transition.
      const pickedUp = await pickupService.markPickedUp(pickupRequest.id, volunteer.id);
      expect(pickedUp.status).toBe('PICKED_UP');
      const donationAfterPickup = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(donationAfterPickup.status).toBe('PICKED_UP');

      // Test 13-15: completing delivery reaches the correct final states.
      const completed = await pickupService.completeDelivery(pickupRequest.id, volunteer.id);
      expect(completed.status).toBe('COMPLETED');

      const finalDonation = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(finalDonation.status).toBe('DELIVERED');

      const finalPickup = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(finalPickup.status).toBe('COMPLETED');
      expect(finalPickup.volunteerId).toBe(volunteer.id);
    });

    it('a volunteer other than the one an admin assigned cannot pick up or complete it', async () => {
      const { pickupRequest } = await createPendingPickup('state2');
      const assignedVolunteer = await createUser('VOLUNTEER', 'state2-assigned');
      const otherVolunteer = await createUser('VOLUNTEER', 'state2-other');

      await pickupService.assignVolunteer(pickupRequest.id, assignedVolunteer.id);

      await expect(
        pickupService.markPickedUp(pickupRequest.id, otherVolunteer.id)
      ).rejects.toThrow('Not authorized to update this pickup');
    });
  });

  describe('Ownership / IDOR (Test 16)', () => {
    it('Test 16: assigning one pickup cannot affect an unrelated pickup', async () => {
      const pickupA = await createPendingPickup('idor1a');
      const pickupB = await createPendingPickup('idor1b');
      const volunteer = await createUser('VOLUNTEER', 'idor1');

      await pickupService.assignVolunteer(pickupA.pickupRequest.id, volunteer.id);

      const untouchedB = await prisma.pickupRequest.findUniqueOrThrow({
        where: { id: pickupB.pickupRequest.id },
      });
      expect(untouchedB.status).toBe('PENDING');
      expect(untouchedB.volunteerId).toBeNull();

      const untouchedDonationB = await prisma.donation.findUniqueOrThrow({
        where: { id: pickupB.donation.id },
      });
      expect(untouchedDonationB.status).toBe('CLAIMED'); // unaffected by pickupA's assignment
    });
  });

  describe('Concurrency (Test 17)', () => {
    it('Test 17: two concurrent admin assignments of different volunteers to the same pickup leave exactly one assigned', async () => {
      const { pickupRequest } = await createPendingPickup('conc1');
      const volunteerA = await createUser('VOLUNTEER', 'conc1a');
      const volunteerB = await createUser('VOLUNTEER', 'conc1b');

      const results = await Promise.allSettled([
        pickupService.assignVolunteer(pickupRequest.id, volunteerA.id),
        pickupService.assignVolunteer(pickupRequest.id, volunteerB.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const final = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(final.status).toBe('ACCEPTED');
      expect([volunteerA.id, volunteerB.id]).toContain(final.volunteerId);
    });

    it('an admin assignment racing a volunteer self-accept for the same pickup resolves to exactly one winner', async () => {
      const { pickupRequest } = await createPendingPickup('conc2');
      const adminAssignedVolunteer = await createUser('VOLUNTEER', 'conc2-admin-pick');
      const selfAcceptingVolunteer = await createUser('VOLUNTEER', 'conc2-self');

      const results = await Promise.allSettled([
        pickupService.assignVolunteer(pickupRequest.id, adminAssignedVolunteer.id),
        pickupService.acceptPickup(pickupRequest.id, selfAcceptingVolunteer.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const final = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect([adminAssignedVolunteer.id, selfAcceptingVolunteer.id]).toContain(final.volunteerId);
    });
  });

  describe('Authorization matrix via the real HTTP route (Part F, Tests 1-5)', () => {
    it('Test 1: ADMIN can assign a volunteer through POST /api/pickups/:id/assign', async () => {
      const { pickupRequest } = await createPendingPickup('http-auth-admin');
      const volunteer = await createUser('VOLUNTEER', 'http-auth-admin');
      const admin = await createUser('ADMIN', 'http-auth-admin');
      const token = signToken(admin);

      const res = await request(app)
        .post(`/api/pickups/${pickupRequest.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ volunteerId: volunteer.id });

      expect(res.status).toBe(200);
      expect(res.body.volunteerId).toBe(volunteer.id);
      expect(res.body.status).toBe('ACCEPTED');
    });

    it('Test 2: DONOR receives 403', async () => {
      const { pickupRequest } = await createPendingPickup('http-auth-donor');
      const volunteer = await createUser('VOLUNTEER', 'http-auth-donor');
      const donor = await createUser('DONOR', 'http-auth-donor-actor');
      const token = signToken(donor);

      const res = await request(app)
        .post(`/api/pickups/${pickupRequest.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ volunteerId: volunteer.id });

      expect(res.status).toBe(403);
    });

    it('Test 3: NGO receives 403', async () => {
      const { pickupRequest } = await createPendingPickup('http-auth-ngo');
      const volunteer = await createUser('VOLUNTEER', 'http-auth-ngo');
      const ngo = await createUser('NGO', 'http-auth-ngo-actor');
      const token = signToken(ngo);

      const res = await request(app)
        .post(`/api/pickups/${pickupRequest.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ volunteerId: volunteer.id });

      expect(res.status).toBe(403);
    });

    it('Test 4: VOLUNTEER receives 403 (cannot assign another volunteer)', async () => {
      const { pickupRequest } = await createPendingPickup('http-auth-vol');
      const targetVolunteer = await createUser('VOLUNTEER', 'http-auth-vol-target');
      const actingVolunteer = await createUser('VOLUNTEER', 'http-auth-vol-actor');
      const token = signToken(actingVolunteer);

      const res = await request(app)
        .post(`/api/pickups/${pickupRequest.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ volunteerId: targetVolunteer.id });

      expect(res.status).toBe(403);
    });

    it('Test 5: an unauthenticated request is rejected', async () => {
      const { pickupRequest } = await createPendingPickup('http-auth-anon');
      const volunteer = await createUser('VOLUNTEER', 'http-auth-anon');

      const res = await request(app)
        .post(`/api/pickups/${pickupRequest.id}/assign`)
        .send({ volunteerId: volunteer.id });

      expect(res.status).toBe(401);
    });
  });
});
