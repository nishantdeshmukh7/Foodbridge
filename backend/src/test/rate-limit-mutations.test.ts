import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { config } from '../config/index.js';

// Phase 21: donationMutationLimiter/pickupMutationLimiter/adminActionLimiter/
// profileUpdateLimiter (see middleware/rateLimit.ts) protect the
// highest-impact authenticated mutation routes. Unlike the pre-existing
// login/register/forgot-password/reset-password limiters (IP-keyed,
// necessarily - those routes run before any token exists), these are keyed
// by the authenticated user's own id, so each test below uses a fresh user
// per limiter it exercises rather than needing to run last-in-file the way
// the IP-keyed limiter tests do.

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

function signToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function donationPayload(suffix: string) {
  return {
    foodType: 'Test Meal',
    quantity: '5 servings',
    expiryTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    pickupLocation: `Test Kitchen ${suffix}`,
  };
}

describe('Phase 21: rate limiting on high-impact authenticated mutations', () => {
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

  it(`donation creation: exactly ${config.rateLimits.donationMutationsPerWindow} requests within the window succeed, the next is rejected with 429`, async () => {
    const donor = await createUser('DONOR', 'rl-donation');
    const token = signToken(donor);
    const limit = config.rateLimits.donationMutationsPerWindow;

    for (let i = 0; i < limit; i++) {
      const res = await request(app)
        .post('/api/donations')
        .set('Authorization', `Bearer ${token}`)
        .send(donationPayload(`rl-${i}`));
      expect(res.status).toBe(201);
    }

    const overLimit = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${token}`)
      .send(donationPayload('rl-over'));

    expect(overLimit.status).toBe(429);
    expect(overLimit.body).toMatchObject({ error: expect.stringContaining('Too many requests') });

    // The 429 response itself must not leak anything sensitive - just the
    // generic message, same shape as the pre-existing limiters.
    expect(Object.keys(overLimit.body)).toEqual(['error']);
  }, 20000);

  it("a different donor is completely unaffected by the first donor's rate limit (keyed per-user, not globally)", async () => {
    const throttledDonor = await createUser('DONOR', 'rl-throttled');
    const freshDonor = await createUser('DONOR', 'rl-fresh');
    const throttledToken = signToken(throttledDonor);
    const freshToken = signToken(freshDonor);
    const limit = config.rateLimits.donationMutationsPerWindow;

    for (let i = 0; i < limit; i++) {
      await request(app)
        .post('/api/donations')
        .set('Authorization', `Bearer ${throttledToken}`)
        .send(donationPayload(`rl-throttled-${i}`));
    }
    const throttledOverLimit = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${throttledToken}`)
      .send(donationPayload('rl-throttled-over'));
    expect(throttledOverLimit.status).toBe(429);

    // A completely different (fresh) user hitting the exact same route
    // succeeds normally - proves the limiter is keyed per-user, not
    // per-route globally.
    const freshRes = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${freshToken}`)
      .send(donationPayload('rl-fresh-1'));
    expect(freshRes.status).toBe(201);
  }, 20000);

  it(`profile update: exactly ${config.rateLimits.profileUpdatesPerWindow} requests succeed, the next is rejected`, async () => {
    const donor = await createUser('DONOR', 'rl-profile');
    const token = signToken(donor);
    const limit = config.rateLimits.profileUpdatesPerWindow;

    for (let i = 0; i < limit; i++) {
      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Updated Name ${i}` });
      expect(res.status).toBe(200);
    }

    const overLimit = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'One Too Many' });

    expect(overLimit.status).toBe(429);
  }, 20000);

  it('legitimate normal usage stays well under the limit: a handful of real actions in one session never trips it', async () => {
    const donor = await createUser('DONOR', 'rl-normal');
    const token = signToken(donor);

    // A realistic session: create two listings, cancel one. Far below any
    // of the configured limits.
    const first = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${token}`)
      .send(donationPayload('normal-1'));
    const second = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${token}`)
      .send(donationPayload('normal-2'));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const cancelRes = await request(app)
      .post(`/api/donations/${first.body.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(cancelRes.status).toBe(200);
  });
});
