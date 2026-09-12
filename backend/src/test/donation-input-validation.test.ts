import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { config } from '../config/index.js';

// Phase 22: donation.routes.ts's POST / validator was previously
// notEmpty()-only on foodType/quantity/pickupLocation, isISO8601()-only on
// expiryTime (no bounds - an already-past or absurdly-far-future date both
// passed), and had zero validation at all on description/imageUrl/isUrgent.
// These tests prove the tightened validator rejects the gaps that mattered
// and still accepts every legitimate real-world value the app's own
// DonorDashboard form can produce.

const TEST_EMAIL_SUFFIX = '@test.foodbridge.local';

async function createUser(role: 'DONOR' | 'NGO', suffix: string) {
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

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    foodType: 'Rice & Curry',
    quantity: '10 servings',
    pickupLocation: 'Test Kitchen, MG Road',
    expiryTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4h from now
    ...overrides,
  };
}

describe('Phase 22: donation creation input validation', () => {
  let donor: Awaited<ReturnType<typeof createUser>>;
  let token: string;

  beforeAll(async () => {
    await prisma.donation.deleteMany({ where: { pickupLocation: { contains: 'phase22-validation' } } });
    const testUsers = await prisma.user.findMany({
      where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
      select: { id: true },
    });
    await prisma.donation.deleteMany({ where: { donorId: { in: testUsers.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_SUFFIX } } });

    donor = await createUser('DONOR', 'validation');
    token = signToken(donor);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function post(body: Record<string, unknown>) {
    return request(app).post('/api/donations').set('Authorization', `Bearer ${token}`).send(body);
  }

  describe('required fields', () => {
    it('rejects a request missing foodType', async () => {
      const { foodType: _drop, ...rest } = validPayload();
      const res = await post(rest);
      expect(res.status).toBe(400);
    });

    it('rejects an empty-string foodType', async () => {
      const res = await post(validPayload({ foodType: '' }));
      expect(res.status).toBe(400);
    });

    it('rejects a whitespace-only foodType (trimmed to empty)', async () => {
      const res = await post(validPayload({ foodType: '   ' }));
      expect(res.status).toBe(400);
    });

    it('rejects a whitespace-only pickupLocation', async () => {
      const res = await post(validPayload({ pickupLocation: '\t\n  ' }));
      expect(res.status).toBe(400);
    });

    it('rejects a whitespace-only quantity', async () => {
      const res = await post(validPayload({ quantity: '   ' }));
      expect(res.status).toBe(400);
    });
  });

  describe('string length bounds', () => {
    it('rejects an oversized foodType (>100 chars)', async () => {
      const res = await post(validPayload({ foodType: 'x'.repeat(101) }));
      expect(res.status).toBe(400);
    });

    it('accepts foodType at exactly the 100-char boundary', async () => {
      const res = await post(validPayload({ foodType: 'x'.repeat(100) }));
      expect(res.status).toBe(201);
    });

    it('rejects an oversized pickupLocation (>300 chars)', async () => {
      const res = await post(validPayload({ pickupLocation: 'x'.repeat(301) }));
      expect(res.status).toBe(400);
    });

    it('rejects an oversized description (>1000 chars)', async () => {
      const res = await post(validPayload({ description: 'x'.repeat(1001) }));
      expect(res.status).toBe(400);
    });

    it('accepts a normal-length description', async () => {
      const res = await post(validPayload({ description: 'Freshly prepared, still warm.' }));
      expect(res.status).toBe(201);
    });

    it('trims leading/trailing whitespace rather than rejecting it, and does not truncate content', async () => {
      const res = await post(validPayload({ foodType: '  Chicken Biryani  ' }));
      expect(res.status).toBe(201);
      expect(res.body.foodType).toBe('Chicken Biryani');
    });
  });

  describe('expiryTime', () => {
    it('rejects a malformed date string', async () => {
      const res = await post(validPayload({ expiryTime: 'not-a-date' }));
      expect(res.status).toBe(400);
    });

    it('rejects an expiry time already in the past', async () => {
      const res = await post(validPayload({ expiryTime: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
      expect(res.status).toBe(400);
    });

    it('rejects an expiry time absurdly far in the future (beyond the 7-day sanity ceiling)', async () => {
      const res = await post(
        validPayload({ expiryTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() })
      );
      expect(res.status).toBe(400);
    });

    it('accepts every real value the app UI actually offers (1-24 hours from now)', async () => {
      for (const hours of [1, 2, 4, 6, 12, 24]) {
        const res = await post(validPayload({ expiryTime: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() }));
        expect(res.status).toBe(201);
      }
    });
  });

  describe('isUrgent / imageUrl', () => {
    it('rejects a non-boolean isUrgent', async () => {
      const res = await post(validPayload({ isUrgent: 'yes-please' }));
      expect(res.status).toBe(400);
    });

    it('accepts a real boolean isUrgent', async () => {
      const res = await post(validPayload({ isUrgent: true }));
      expect(res.status).toBe(201);
      expect(res.body.isUrgent).toBe(true);
    });

    it('rejects an imageUrl that is not a valid URL', async () => {
      const res = await post(validPayload({ imageUrl: 'not a url at all' }));
      expect(res.status).toBe(400);
    });

    it('accepts a real imageUrl', async () => {
      const res = await post(validPayload({ imageUrl: 'https://example.com/photo.jpg' }));
      expect(res.status).toBe(201);
    });
  });

  describe('malformed/unexpected payload shapes', () => {
    it('rejects a completely empty body', async () => {
      const res = await post({});
      expect(res.status).toBe(400);
    });

    it('a client-supplied status field is silently ignored, not honored - the donation is still created AVAILABLE', async () => {
      const res = await post(validPayload({ status: 'DELIVERED' }));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('AVAILABLE');
    });

    it('a client-supplied donorId is silently ignored - the donation is owned by the authenticated caller, not the spoofed value', async () => {
      const otherDonor = await createUser('DONOR', 'spoof-target');
      const res = await post(validPayload({ donorId: otherDonor.id }));
      expect(res.status).toBe(201);
      expect(res.body.donorId).toBe(donor.id);
      expect(res.body.donorId).not.toBe(otherDonor.id);
    });
  });
});
