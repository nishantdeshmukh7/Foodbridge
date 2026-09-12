import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { config } from '../config/index.js';

// Phase 18: regression coverage for the Phase 17 P0 finding. A standalone
// `POST /api/pickups` route used to let any approved NGO create a
// PickupRequest for an arbitrary donationId, with no check that the
// donation was AVAILABLE or that the caller had claimed it. Because
// PickupRequest.donationId is @unique, that could permanently block the
// real claim flow for a donation; accepting the resulting pickup would also
// force ANY donation (including DELIVERED/CANCELLED ones) back to CLAIMED,
// since pickupService's donation update there is unconditional. The fix was
// to remove the route entirely (see pickup.routes.ts) rather than patch it
// - no legitimate caller existed anywhere in the frontend or test suite.
//
// These tests prove two things: (1) the route is genuinely gone - no
// combination of actor or donation state can reach it - and (2) the
// canonical claim -> pickup -> delivery flow this route used to bypass
// still works end-to-end over real HTTP.

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

async function createDonation(
  donorId: string,
  suffix: string,
  overrides: Partial<{ status: string; claimedById: string | null }> = {}
) {
  return prisma.donation.create({
    data: {
      foodType: 'Test Meal',
      quantity: '10 servings',
      expiryTime: new Date(Date.now() + 60 * 60 * 1000),
      pickupLocation: `Test Kitchen ${suffix}`,
      status: (overrides.status as never) ?? 'AVAILABLE',
      donorId,
      claimedById: overrides.claimedById ?? null,
    },
  });
}

// Same rationale as admin-assignment.test.ts: signs a real JWT directly
// rather than going through POST /auth/login, which is behind a shared
// in-memory rate limiter across the whole test run.
function signToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

describe('Phase 18: standalone pickup-request creation vulnerability is closed', () => {
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
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_SUFFIX } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/pickups no longer exists, for any actor', () => {
    it('unauthenticated request: 404, not 401 - proves the route is gone, not merely newly protected', async () => {
      const donor = await createUser('DONOR', 'gone-anon');
      const donation = await createDonation(donor.id, 'gone-anon');

      const res = await request(app).post('/api/pickups').send({ donationId: donation.id });

      expect(res.status).toBe(404);
    });

    it('an approved NGO (the role the old route allowed) gets 404', async () => {
      const donor = await createUser('DONOR', 'gone-ngo');
      const ngo = await createUser('NGO', 'gone-ngo');
      const donation = await createDonation(donor.id, 'gone-ngo');

      const res = await request(app)
        .post('/api/pickups')
        .set('Authorization', `Bearer ${signToken(ngo)}`)
        .send({ donationId: donation.id });

      expect(res.status).toBe(404);
    });

    it('an unapproved NGO gets 404', async () => {
      const donor = await createUser('DONOR', 'gone-pending');
      const pendingNgo = await createUser('NGO', 'gone-pending-ngo', { isApproved: false });
      const donation = await createDonation(donor.id, 'gone-pending');

      const res = await request(app)
        .post('/api/pickups')
        .set('Authorization', `Bearer ${signToken(pendingNgo)}`)
        .send({ donationId: donation.id });

      expect(res.status).toBe(404);
    });

    it('a donor gets 404', async () => {
      const donor = await createUser('DONOR', 'gone-donor');
      const donation = await createDonation(donor.id, 'gone-donor');

      const res = await request(app)
        .post('/api/pickups')
        .set('Authorization', `Bearer ${signToken(donor)}`)
        .send({ donationId: donation.id });

      expect(res.status).toBe(404);
    });

    it('a volunteer gets 404', async () => {
      const donor = await createUser('DONOR', 'gone-vol');
      const volunteer = await createUser('VOLUNTEER', 'gone-vol');
      const donation = await createDonation(donor.id, 'gone-vol');

      const res = await request(app)
        .post('/api/pickups')
        .set('Authorization', `Bearer ${signToken(volunteer)}`)
        .send({ donationId: donation.id });

      expect(res.status).toBe(404);
    });

    it('an admin gets 404 too - there was never an intended admin path through this route', async () => {
      const donor = await createUser('DONOR', 'gone-admin');
      const admin = await createUser('ADMIN', 'gone-admin');
      const donation = await createDonation(donor.id, 'gone-admin');

      const res = await request(app)
        .post('/api/pickups')
        .set('Authorization', `Bearer ${signToken(admin)}`)
        .send({ donationId: donation.id });

      expect(res.status).toBe(404);
    });
  });

  describe('no donation/pickup state can be corrupted through the removed route, regardless of donation status or ownership', () => {
    async function attemptAndAssertNoChange(
      donation: { id: string; status: string; claimedById: string | null },
      actingNgo: Awaited<ReturnType<typeof createUser>>
    ) {
      const before = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      const pickupsBefore = await prisma.pickupRequest.findMany({ where: { donationId: donation.id } });

      const res = await request(app)
        .post('/api/pickups')
        .set('Authorization', `Bearer ${signToken(actingNgo)}`)
        .send({ donationId: donation.id });

      expect(res.status).toBe(404);

      const after = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(after.status).toBe(before.status);
      expect(after.claimedById).toBe(before.claimedById);

      const pickupsAfter = await prisma.pickupRequest.findMany({ where: { donationId: donation.id } });
      expect(pickupsAfter).toHaveLength(pickupsBefore.length);
    }

    it('AVAILABLE donation: cannot be given a phantom PickupRequest', async () => {
      const donor = await createUser('DONOR', 'state-avail');
      const ngo = await createUser('NGO', 'state-avail');
      const donation = await createDonation(donor.id, 'state-avail');

      await attemptAndAssertNoChange(donation, ngo);
    });

    it("another NGO's CLAIMED donation: cross-NGO manipulation fails, no cross-claim pickup created", async () => {
      const donor = await createUser('DONOR', 'state-crossclaim');
      const owningNgo = await createUser('NGO', 'state-crossclaim-owner');
      const attackerNgo = await createUser('NGO', 'state-crossclaim-attacker');
      const donation = await createDonation(donor.id, 'state-crossclaim');
      const claimed = await donationService.claim(donation.id, owningNgo.id);

      await attemptAndAssertNoChange(claimed, attackerNgo);
    });

    it("the requesting NGO's own CLAIMED donation: the real PickupRequest already exists and is not duplicated", async () => {
      const donor = await createUser('DONOR', 'state-ownclaim');
      const ngo = await createUser('NGO', 'state-ownclaim');
      const donation = await createDonation(donor.id, 'state-ownclaim');
      const claimed = await donationService.claim(donation.id, ngo.id);

      await attemptAndAssertNoChange(claimed, ngo);
    });

    it('ACCEPTED pickup (volunteer already assigned): donation cannot be forced back through the removed route', async () => {
      const donor = await createUser('DONOR', 'state-accepted');
      const ngo = await createUser('NGO', 'state-accepted');
      const volunteer = await createUser('VOLUNTEER', 'state-accepted');
      const donation = await createDonation(donor.id, 'state-accepted');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });
      await prisma.pickupRequest.update({
        where: { id: pickupRequest.id },
        data: { status: 'ACCEPTED', volunteerId: volunteer.id },
      });
      const current = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });

      await attemptAndAssertNoChange(current, ngo);
    });

    it('PICKED_UP donation: cannot be tampered with through the removed route', async () => {
      const donor = await createUser('DONOR', 'state-pickedup');
      const ngo = await createUser('NGO', 'state-pickedup');
      const donation = await createDonation(donor.id, 'state-pickedup', { status: 'PICKED_UP', claimedById: ngo.id });

      await attemptAndAssertNoChange(donation, ngo);
    });

    it('DELIVERED donation: cannot be resurrected back into CLAIMED through the removed route', async () => {
      const donor = await createUser('DONOR', 'state-delivered');
      const ngo = await createUser('NGO', 'state-delivered');
      const donation = await createDonation(donor.id, 'state-delivered', { status: 'DELIVERED', claimedById: ngo.id });

      await attemptAndAssertNoChange(donation, ngo);
    });

    it('CANCELLED donation: cannot be reactivated through the removed route', async () => {
      const donor = await createUser('DONOR', 'state-cancelled');
      const ngo = await createUser('NGO', 'state-cancelled');
      const donation = await createDonation(donor.id, 'state-cancelled', { status: 'CANCELLED' });

      await attemptAndAssertNoChange(donation, ngo);
    });

    it('EXPIRED donation: cannot be claimed-around through the removed route', async () => {
      // No code path currently writes EXPIRED (a pre-existing, separately
      // tracked gap - see the Phase 16/17 reports) - this donation is
      // created directly in that status purely to prove the removed route
      // cannot act on it either, since the schema allows the status to
      // exist even though nothing sets it today.
      const donor = await createUser('DONOR', 'state-expired');
      const ngo = await createUser('NGO', 'state-expired');
      const donation = await createDonation(donor.id, 'state-expired', { status: 'EXPIRED' });

      await attemptAndAssertNoChange(donation, ngo);
    });
  });

  describe('canonical claim -> pickup -> delivery flow still works end-to-end over real HTTP', () => {
    it('donor creates, NGO claims, exactly one PickupRequest exists, volunteer accepts/picks up/delivers', async () => {
      const donor = await createUser('DONOR', 'golden');
      const ngo = await createUser('NGO', 'golden');
      const volunteer = await createUser('VOLUNTEER', 'golden');

      const createRes = await request(app)
        .post('/api/donations')
        .set('Authorization', `Bearer ${signToken(donor)}`)
        .send({
          foodType: 'Golden Path Meal',
          quantity: '12 servings',
          expiryTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          pickupLocation: 'Golden Path Kitchen',
        });
      expect(createRes.status).toBe(201);
      const donationId = createRes.body.id as string;

      const claimRes = await request(app)
        .post(`/api/donations/${donationId}/claim`)
        .set('Authorization', `Bearer ${signToken(ngo)}`)
        .send();
      expect(claimRes.status).toBe(200);
      expect(claimRes.body.status).toBe('CLAIMED');
      expect(claimRes.body.claimedById).toBe(ngo.id);

      const pickupRequests = await prisma.pickupRequest.findMany({ where: { donationId } });
      expect(pickupRequests).toHaveLength(1);
      const pickupRequestId = pickupRequests[0].id;
      expect(pickupRequests[0].status).toBe('PENDING');
      expect(pickupRequests[0].volunteerId).toBeNull();

      const acceptRes = await request(app)
        .post(`/api/pickups/${pickupRequestId}/accept`)
        .set('Authorization', `Bearer ${signToken(volunteer)}`)
        .send();
      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.status).toBe('ACCEPTED');
      expect(acceptRes.body.volunteerId).toBe(volunteer.id);

      const pickupRes = await request(app)
        .post(`/api/pickups/${pickupRequestId}/pickup`)
        .set('Authorization', `Bearer ${signToken(volunteer)}`)
        .send();
      expect(pickupRes.status).toBe(200);
      expect(pickupRes.body.status).toBe('PICKED_UP');

      const completeRes = await request(app)
        .post(`/api/pickups/${pickupRequestId}/complete`)
        .set('Authorization', `Bearer ${signToken(volunteer)}`)
        .send();
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.status).toBe('COMPLETED');

      const finalDonation = await prisma.donation.findUniqueOrThrow({ where: { id: donationId } });
      expect(finalDonation.status).toBe('DELIVERED');
    });
  });
});
