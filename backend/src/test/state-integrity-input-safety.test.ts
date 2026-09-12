import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { config } from '../config/index.js';

// Phase 22: every Donation/PickupRequest state transition is driven by a
// purpose-built endpoint (claim/cancel/release/accept/pickup/complete),
// none of which ever reads a status/role/ownership field out of the
// request body (confirmed via a repo-wide grep for req.body.status,
// data.status, req.body.role - zero matches). These tests prove that
// directly: sending extra, hostile body fields alongside a legitimate
// request has zero effect on the resulting state, and invalid transitions
// stay rejected regardless of what a malformed request contains.
//
// Also covers Donation.status EXPIRED specifically (see the Phase 22
// report for why automated expiry was NOT implemented this phase): no
// writer exists anywhere, and the one place a client could reference it
// at all - the GET /donations ?status= filter - now validates it's a real
// enum value rather than passing an arbitrary string to Prisma.

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

async function createDonation(donorId: string, suffix: string) {
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

function signToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

describe('Phase 22: state integrity under malformed/hostile input', () => {
  beforeAll(async () => {
    const testUsers = await prisma.user.findMany({
      where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
      select: { id: true },
    });
    const testUserIds = testUsers.map((u) => u.id);
    await prisma.delivery.deleteMany({ where: { pickupRequest: { donation: { donorId: { in: testUserIds } } } } });
    await prisma.pickupRequest.deleteMany({ where: { donation: { donorId: { in: testUserIds } } } });
    await prisma.adminLog.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.donation.deleteMany({ where: { donorId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_SUFFIX } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('claim', () => {
    it('a hostile status/donorId in the body has no effect - the donation still transitions exactly AVAILABLE -> CLAIMED, owned by the real caller', async () => {
      const donor = await createUser('DONOR', 'claim-hostile-donor');
      const ngo = await createUser('NGO', 'claim-hostile-ngo');
      const attacker = await createUser('NGO', 'claim-hostile-attacker');
      const donation = await createDonation(donor.id, 'claim-hostile');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/claim`)
        .set('Authorization', `Bearer ${signToken(ngo)}`)
        .send({ status: 'DELIVERED', claimedById: attacker.id, donorId: attacker.id });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CLAIMED');
      expect(res.body.claimedById).toBe(ngo.id);
      expect(res.body.claimedById).not.toBe(attacker.id);
    });

    it('claiming an already-CLAIMED donation is rejected regardless of body content', async () => {
      const donor = await createUser('DONOR', 'claim-invalid-donor');
      const ngo1 = await createUser('NGO', 'claim-invalid-ngo1');
      const ngo2 = await createUser('NGO', 'claim-invalid-ngo2');
      const donation = await createDonation(donor.id, 'claim-invalid');
      await donationService.claim(donation.id, ngo1.id);

      const res = await request(app)
        .post(`/api/donations/${donation.id}/claim`)
        .set('Authorization', `Bearer ${signToken(ngo2)}`)
        .send({ status: 'AVAILABLE', force: true });

      expect(res.status).toBe(400);
      const unchanged = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(unchanged.claimedById).toBe(ngo1.id);
    });
  });

  describe('cancel', () => {
    it('a hostile status/donorId in the body has no effect - the donation transitions to CANCELLED only, nothing else', async () => {
      const donor = await createUser('DONOR', 'cancel-hostile-donor');
      const attacker = await createUser('DONOR', 'cancel-hostile-attacker');
      const donation = await createDonation(donor.id, 'cancel-hostile');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(donor)}`)
        .send({ status: 'DELIVERED', donorId: attacker.id });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.donorId).toBe(donor.id);
    });

    it("a DONOR cannot cancel another donor's donation, regardless of body content", async () => {
      const owner = await createUser('DONOR', 'cancel-idor-owner');
      const attacker = await createUser('DONOR', 'cancel-idor-attacker');
      const donation = await createDonation(owner.id, 'cancel-idor');

      const res = await request(app)
        .post(`/api/donations/${donation.id}/cancel`)
        .set('Authorization', `Bearer ${signToken(attacker)}`)
        .send({ donorId: owner.id });

      expect(res.status).toBe(400);
      const unchanged = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(unchanged.status).toBe('AVAILABLE');
    });
  });

  describe('release', () => {
    it('a hostile status in the body has no effect - a released claim goes back to AVAILABLE only', async () => {
      const donor = await createUser('DONOR', 'release-hostile-donor');
      const ngo = await createUser('NGO', 'release-hostile-ngo');
      const donation = await createDonation(donor.id, 'release-hostile');
      await donationService.claim(donation.id, ngo.id);

      const res = await request(app)
        .post(`/api/donations/${donation.id}/release`)
        .set('Authorization', `Bearer ${signToken(ngo)}`)
        .send({ status: 'DELIVERED' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('AVAILABLE');
      expect(res.body.claimedById).toBeNull();
    });
  });

  describe('pickup accept/pickup/complete', () => {
    async function createPendingPickup(suffix: string) {
      const donor = await createUser('DONOR', `${suffix}-donor`);
      const ngo = await createUser('NGO', `${suffix}-ngo`);
      const donation = await createDonation(donor.id, suffix);
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });
      return { donation, pickupRequest };
    }

    it('accept: a hostile status/volunteerId in the body has no effect - the caller is always the real assigned volunteer', async () => {
      const { pickupRequest } = await createPendingPickup('accept-hostile');
      const volunteer = await createUser('VOLUNTEER', 'accept-hostile-vol');
      const attacker = await createUser('VOLUNTEER', 'accept-hostile-attacker');

      const res = await request(app)
        .post(`/api/pickups/${pickupRequest.id}/accept`)
        .set('Authorization', `Bearer ${signToken(volunteer)}`)
        .send({ status: 'COMPLETED', volunteerId: attacker.id });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACCEPTED');
      expect(res.body.volunteerId).toBe(volunteer.id);
      expect(res.body.volunteerId).not.toBe(attacker.id);
    });

    it('pickup: a volunteer who is not the assigned one is rejected regardless of body content', async () => {
      const { pickupRequest } = await createPendingPickup('pickup-idor');
      const assigned = await createUser('VOLUNTEER', 'pickup-idor-assigned');
      const attacker = await createUser('VOLUNTEER', 'pickup-idor-attacker');
      await request(app)
        .post(`/api/pickups/${pickupRequest.id}/accept`)
        .set('Authorization', `Bearer ${signToken(assigned)}`)
        .send();

      const res = await request(app)
        .post(`/api/pickups/${pickupRequest.id}/pickup`)
        .set('Authorization', `Bearer ${signToken(attacker)}`)
        .send({ volunteerId: attacker.id });

      expect(res.status).toBe(400);
      const unchanged = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(unchanged.status).toBe('ACCEPTED');
      expect(unchanged.volunteerId).toBe(assigned.id);
    });

    it('complete: cannot skip straight from ACCEPTED to COMPLETED without the PICKED_UP step, regardless of body content', async () => {
      const { pickupRequest } = await createPendingPickup('complete-skip');
      const volunteer = await createUser('VOLUNTEER', 'complete-skip-vol');
      await request(app)
        .post(`/api/pickups/${pickupRequest.id}/accept`)
        .set('Authorization', `Bearer ${signToken(volunteer)}`)
        .send();

      const res = await request(app)
        .post(`/api/pickups/${pickupRequest.id}/complete`)
        .set('Authorization', `Bearer ${signToken(volunteer)}`)
        .send({ status: 'COMPLETED', force: true });

      expect(res.status).toBe(400);
      const unchanged = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(unchanged.status).toBe('ACCEPTED');
    });
  });

  describe('EXPIRED status - no writer, and filter-level validation only', () => {
    it('creating a donation with a client-supplied EXPIRED status is ignored - it is always created AVAILABLE', async () => {
      const donor = await createUser('DONOR', 'expired-create-donor');
      const res = await request(app)
        .post('/api/donations')
        .set('Authorization', `Bearer ${signToken(donor)}`)
        .send({
          foodType: 'Test',
          quantity: '1',
          pickupLocation: 'Test',
          expiryTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          status: 'EXPIRED',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('AVAILABLE');
    });

    it('GET /donations?status=EXPIRED is a legitimate, validated filter request - it succeeds and returns an empty list (no donation is ever actually EXPIRED)', async () => {
      const res = await request(app).get('/api/donations').query({ status: 'EXPIRED' });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('GET /donations?status=NOT_A_REAL_STATUS is cleanly rejected, not passed through to the database', async () => {
      const res = await request(app).get('/api/donations').query({ status: 'NOT_A_REAL_STATUS' });
      expect(res.status).toBe(400);
    });

    it('no donation anywhere in the database has EXPIRED status - confirms the absence of any writer, not just the absence of a client-facing path to set it', async () => {
      const expiredCount = await prisma.donation.count({ where: { status: 'EXPIRED' } });
      expect(expiredCount).toBe(0);
    });
  });

  describe('GET /donations/my-claims status filter (found during this phase\'s own security-regression review)', () => {
    it('a valid status filter succeeds', async () => {
      const ngo = await createUser('NGO', 'myclaims-filter-valid');
      const res = await request(app)
        .get('/api/donations/my-claims')
        .query({ status: 'CLAIMED' })
        .set('Authorization', `Bearer ${signToken(ngo)}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('an invalid status filter is cleanly rejected, not passed through to the database', async () => {
      const ngo = await createUser('NGO', 'myclaims-filter-invalid');
      const res = await request(app)
        .get('/api/donations/my-claims')
        .query({ status: 'NOT_A_REAL_STATUS' })
        .set('Authorization', `Bearer ${signToken(ngo)}`);

      expect(res.status).toBe(400);
    });
  });
});
