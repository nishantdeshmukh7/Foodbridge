import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { config } from '../config/index.js';

// Phase 22: GET /api/users (admin only) previously read role/isApproved/
// search from req.query with no validation - role went straight into a
// Prisma where.role filter as whatever string the client sent, isApproved
// silently treated anything besides the exact strings "true"/"false" as
// "no filter" rather than rejecting it, and search had no length bound.

// Phase 22: distinct prefix, not the shared generic "@test.foodbridge.local"
// suffix every other file uses - this file's own users never own a
// Donation, so its cleanup doesn't need FK-ordered deletes, but a blanket
// delete scoped to the generic suffix can still collide with another
// file's still-live donation-owning users (hit exactly this during
// development - same class of issue as admin-provisioning.test.ts, Phase 20).
const EMAIL_PREFIX = 'phase22-admin-users-query-';
const emailFor = (role: string, suffix: string) => `${EMAIL_PREFIX}${role.toLowerCase()}-${suffix}@test.foodbridge.local`;

type Role = 'ADMIN' | 'DONOR' | 'NGO' | 'VOLUNTEER';

async function createUser(role: Role, suffix: string) {
  return prisma.user.create({
    data: {
      email: emailFor(role, suffix),
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

describe('Phase 22: GET /api/users query validation', () => {
  let admin: Awaited<ReturnType<typeof createUser>>;
  let donor: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    admin = await createUser('ADMIN', 'query-admin');
    donor = await createUser('DONOR', 'query-donor');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const adminAuth = () => `Bearer ${signToken(admin)}`;

  it('a valid query (real role, real isApproved, short search) succeeds', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ role: 'DONOR', isApproved: 'true', search: 'query-donor' })
      .set('Authorization', adminAuth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('no query params at all still succeeds (all params are optional)', async () => {
    const res = await request(app).get('/api/users').set('Authorization', adminAuth());
    expect(res.status).toBe(200);
  });

  it('rejects an invalid role enum value with a clean 400, not a raw Prisma error', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ role: 'SUPERADMIN' })
      .set('Authorization', adminAuth());

    expect(res.status).toBe(400);
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/PrismaClient|at \/|node_modules/);
  });

  it('rejects a role value that is a real enum in a different case (case-sensitive, no silent coercion)', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ role: 'donor' })
      .set('Authorization', adminAuth());

    expect(res.status).toBe(400);
  });

  it('rejects an isApproved value that is not exactly "true" or "false"', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ isApproved: '1' })
      .set('Authorization', adminAuth());

    expect(res.status).toBe(400);
  });

  it('rejects a malformed/garbage isApproved value', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ isApproved: 'maybe' })
      .set('Authorization', adminAuth());

    expect(res.status).toBe(400);
  });

  it('rejects an excessively long search string', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ search: 'x'.repeat(201) })
      .set('Authorization', adminAuth());

    expect(res.status).toBe(400);
  });

  it('accepts a search string at exactly the 200-char boundary', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ search: 'x'.repeat(200) })
      .set('Authorization', adminAuth());

    expect(res.status).toBe(200);
  });

  it('unauthorized: a non-admin (DONOR) gets 403, not a filtered/degraded result', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ role: 'DONOR' })
      .set('Authorization', `Bearer ${signToken(donor)}`);

    expect(res.status).toBe(403);
  });

  it('unauthorized: an unauthenticated request gets 401', async () => {
    const res = await request(app).get('/api/users').query({ role: 'DONOR' });
    expect(res.status).toBe(401);
  });

  it('an invalid filter never widens the result set - a rejected request returns no user data at all', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ role: 'NOT_REAL' })
      .set('Authorization', adminAuth());

    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('users');
    expect(Array.isArray(res.body)).toBe(false);
  });
});
