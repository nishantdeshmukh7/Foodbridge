import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { config } from '../config/index.js';

// Phase 21: `DELETE /api/donations/:id` used to exist (hard-delete,
// AVAILABLE donations only). The route allowed ADMIN, but the service only
// ever checked `donation.donorId !== donorId` - an admin calling it on a
// donation they didn't personally own always got "Not authorized" (fails
// safe, not exploitable, but broken). Audited and removed rather than
// fixed: it had no live frontend caller, no test coverage, and
// POST /:id/cancel already does everything it was for, correctly, with a
// working admin override, and without destroying history via a hard
// delete. These tests prove the route is genuinely gone for every actor
// and state, and that POST /:id/cancel remains the one, correctly-working
// moderation path.

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

function signToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

describe('Phase 21: DELETE /api/donations/:id is removed', () => {
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

  async function attemptDeleteAndAssertUnchanged(
    donationId: string,
    token: string | null
  ) {
    const before = await prisma.donation.findUnique({ where: { id: donationId } });

    const req = request(app).delete(`/api/donations/${donationId}`);
    const res = await (token ? req.set('Authorization', `Bearer ${token}`) : req).send();

    expect(res.status).toBe(404);

    const after = await prisma.donation.findUnique({ where: { id: donationId } });
    expect(after).toEqual(before);
  }

  it('unauthenticated request: 404, not 401 - proves the route is gone, not merely newly protected', async () => {
    const donor = await createUser('DONOR', 'anon');
    const donation = await createDonation(donor.id, 'anon');

    await attemptDeleteAndAssertUnchanged(donation.id, null);
  });

  it('ADMIN gets 404 on an AVAILABLE donation, and the donation is untouched', async () => {
    const admin = await createUser('ADMIN', 'del-admin');
    const donor = await createUser('DONOR', 'del-admin-target');
    const donation = await createDonation(donor.id, 'del-admin');

    await attemptDeleteAndAssertUnchanged(donation.id, signToken(admin));
  });

  it('the owning DONOR gets 404 on their own AVAILABLE donation - it is not deletable through this removed route either', async () => {
    const donor = await createUser('DONOR', 'del-own');
    const donation = await createDonation(donor.id, 'del-own');

    await attemptDeleteAndAssertUnchanged(donation.id, signToken(donor));
  });

  it("a DONOR gets 404 attempting another donor's donation", async () => {
    const owner = await createUser('DONOR', 'del-other-owner');
    const attacker = await createUser('DONOR', 'del-other-attacker');
    const donation = await createDonation(owner.id, 'del-other');

    await attemptDeleteAndAssertUnchanged(donation.id, signToken(attacker));
  });

  it('NGO gets 404', async () => {
    const donor = await createUser('DONOR', 'del-ngo-target');
    const ngo = await createUser('NGO', 'del-ngo');
    const donation = await createDonation(donor.id, 'del-ngo');

    await attemptDeleteAndAssertUnchanged(donation.id, signToken(ngo));
  });

  it('VOLUNTEER gets 404', async () => {
    const donor = await createUser('DONOR', 'del-vol-target');
    const volunteer = await createUser('VOLUNTEER', 'del-vol');
    const donation = await createDonation(donor.id, 'del-vol');

    await attemptDeleteAndAssertUnchanged(donation.id, signToken(volunteer));
  });

  it('an invalid/non-existent donation ID also 404s (no leak of "route exists but ID is wrong" vs "route does not exist")', async () => {
    const admin = await createUser('ADMIN', 'del-invalid');

    const res = await request(app)
      .delete('/api/donations/does-not-exist')
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send();

    expect(res.status).toBe(404);
  });

  it('CLAIMED donation: admin gets 404, PickupRequest and claim remain fully intact', async () => {
    const admin = await createUser('ADMIN', 'del-claimed-admin');
    const donor = await createUser('DONOR', 'del-claimed-donor');
    const ngo = await createUser('NGO', 'del-claimed-ngo');
    const donation = await createDonation(donor.id, 'del-claimed');
    await donationService.claim(donation.id, ngo.id);

    const res = await request(app)
      .delete(`/api/donations/${donation.id}`)
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send();
    expect(res.status).toBe(404);

    const afterDonation = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
    expect(afterDonation.status).toBe('CLAIMED');
    expect(afterDonation.claimedById).toBe(ngo.id);
    const pickupRequest = await prisma.pickupRequest.findUnique({ where: { donationId: donation.id } });
    expect(pickupRequest).not.toBeNull();
  });

  it('DELIVERED donation: attempting the removed route 404s and the completed record is untouched', async () => {
    const admin = await createUser('ADMIN', 'del-delivered-admin');
    const donor = await createUser('DONOR', 'del-delivered-donor');
    const ngo = await createUser('NGO', 'del-delivered-ngo');
    const donation = await createDonation(donor.id, 'del-delivered', { status: 'DELIVERED', claimedById: ngo.id });

    await attemptDeleteAndAssertUnchanged(donation.id, signToken(admin));
  });

  it('the working replacement (POST /:id/cancel) still lets an admin moderate an AVAILABLE donation this removed route used to cover', async () => {
    const admin = await createUser('ADMIN', 'del-replacement-admin');
    const donor = await createUser('DONOR', 'del-replacement-donor');
    const donation = await createDonation(donor.id, 'del-replacement');

    const res = await request(app)
      .post(`/api/donations/${donation.id}/cancel`)
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');

    const afterDonation = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
    expect(afterDonation.status).toBe('CANCELLED');
  });
});
