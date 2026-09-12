import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { config } from '../config/index.js';

// Phase 6: user/profile IDOR, enumeration, and response-data hardening.
// All authorization behaviour is exercised through the real Express app via
// supertest (JWTs signed directly rather than via POST /auth/login, to
// avoid Phase 3's shared per-process login rate limiter - see prior phases'
// test files for the same rationale).

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

function signToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

describe('Phase 6: user/profile authorization, enumeration & response hygiene', () => {
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

  describe('GET /users/:id - the discovered IDOR (Tests 1-7)', () => {
    it('Test 1: a user can fetch their own profile via GET /users/:id', async () => {
      const donor = await createUser('DONOR', 'own1');
      const token = signToken(donor);

      const res = await request(app)
        .get(`/api/users/${donor.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(donor.id);
    });

    it('Test 2: DONOR cannot access another user’s profile - 403', async () => {
      const donorA = await createUser('DONOR', 'idorA');
      const donorB = await createUser('DONOR', 'idorB');
      const token = signToken(donorA);

      const res = await request(app)
        .get(`/api/users/${donorB.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty('email');
    });

    it('Test 3: NGO cannot access another user’s profile - 403', async () => {
      const ngo = await createUser('NGO', 'idorC');
      const other = await createUser('DONOR', 'idorD');
      const token = signToken(ngo);

      const res = await request(app)
        .get(`/api/users/${other.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('Test 4: VOLUNTEER cannot access another user’s profile - 403', async () => {
      const volunteer = await createUser('VOLUNTEER', 'idorE');
      const other = await createUser('NGO', 'idorF');
      const token = signToken(volunteer);

      const res = await request(app)
        .get(`/api/users/${other.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('Test 5: ADMIN can access another user’s profile', async () => {
      const admin = await createUser('ADMIN', 'idorG');
      const target = await createUser('NGO', 'idorH');
      const token = signToken(admin);

      const res = await request(app)
        .get(`/api/users/${target.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(target.id);
    });

    it('Test 6: unauthenticated request gets 401', async () => {
      const target = await createUser('DONOR', 'idorI');
      const res = await request(app).get(`/api/users/${target.id}`);
      expect(res.status).toBe(401);
    });

    it('Test 7: admin requesting a non-existent user gets a clean 404', async () => {
      const admin = await createUser('ADMIN', 'idorJ');
      const token = signToken(admin);

      const res = await request(app)
        .get('/api/users/does-not-exist')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'User not found' });
    });
  });

  describe('User enumeration via GET /users (Tests 8-9)', () => {
    it('Test 8: a normal (non-admin) user cannot list all users - 403', async () => {
      const donor = await createUser('DONOR', 'enum1');
      const token = signToken(donor);

      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('Test 9: admin retains the full user-list functionality', async () => {
      const admin = await createUser('ADMIN', 'enum2');
      await createUser('DONOR', 'enum2-target');
      const token = signToken(admin);

      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('Write IDOR on profile/lifecycle endpoints (Tests 10-12)', () => {
    it('Test 10: PUT /auth/profile can only ever change the caller’s own row', async () => {
      const actor = await createUser('DONOR', 'write1-actor');
      const victim = await createUser('DONOR', 'write1-victim');
      const token = signToken(actor);

      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed By Actor' });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(actor.id);

      const victimUnchanged = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
      expect(victimUnchanged.name).toBe(`DONOR write1-victim`);
    });

    it('Test 11: a non-admin cannot suspend another user’s account', async () => {
      const target = await createUser('DONOR', 'write2-target');
      const actor = await createUser('NGO', 'write2-actor');
      const token = signToken(actor);

      const res = await request(app)
        .post(`/api/users/${target.id}/suspend`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);

      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(unchanged.isActive).toBe(true);
    });

    it('Test 12: admin lifecycle operations still work end-to-end', async () => {
      const ngo = await createUser('NGO', 'write3', { isApproved: false, isActive: true });
      const admin = await createUser('ADMIN', 'write3-admin');
      const token = signToken(admin);

      const res = await request(app)
        .post(`/api/users/${ngo.id}/approve`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.isApproved).toBe(true);
    });
  });

  describe('Privilege escalation through PUT /auth/profile (Tests 13-16)', () => {
    it('Test 13: a user cannot change their own role to ADMIN', async () => {
      const donor = await createUser('DONOR', 'esc1');
      const token = signToken(donor);

      await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'ADMIN', name: 'Still A Donor' });

      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: donor.id } });
      expect(unchanged.role).toBe('DONOR');
    });

    it('Test 14: a pending NGO cannot set isApproved=true on itself', async () => {
      const ngo = await createUser('NGO', 'esc2', { isApproved: false, isActive: true });
      const token = signToken(ngo);

      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ isApproved: true, name: 'Self Approved Attempt' });

      expect(res.status).toBe(200); // the update itself succeeds - just not for that field
      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: ngo.id } });
      expect(unchanged.isApproved).toBe(false);
    });

    it('Test 15: a suspended user cannot reach PUT /auth/profile at all, let alone set isActive=true', async () => {
      const suspended = await createUser('DONOR', 'esc3', { isApproved: true, isActive: false });
      const token = signToken(suspended);

      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: true });

      // authenticate() rejects inactive accounts before the request ever
      // reaches the profile-update logic - the strongest possible guarantee.
      expect(res.status).toBe(401);

      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: suspended.id } });
      expect(unchanged.isActive).toBe(false);
    });

    it('Test 16: a single generic update cannot move any privileged field at once', async () => {
      const ngo = await createUser('NGO', 'esc4', { isApproved: false, isActive: true });
      const token = signToken(ngo);

      await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'ADMIN', isApproved: true, isActive: true, name: 'Escalation Attempt' });

      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: ngo.id } });
      expect(unchanged.role).toBe('NGO');
      expect(unchanged.isApproved).toBe(false);
      expect(unchanged.isActive).toBe(true); // was already true - just confirming it wasn't otherwise touched
      expect(unchanged.name).toBe('Escalation Attempt'); // the one legitimate field DID update
    });
  });

  describe('Response hygiene (Tests 17-18)', () => {
    it('Test 17: none of the lifecycle mutation responses include a password field', async () => {
      const admin = await createUser('ADMIN', 'hygiene1-admin');
      const token = signToken(admin);

      const pending = await createUser('NGO', 'hygiene1-pending', { isApproved: false, isActive: true });
      const approveRes = await request(app)
        .post(`/api/users/${pending.id}/approve`)
        .set('Authorization', `Bearer ${token}`);
      expect(approveRes.body).not.toHaveProperty('password');

      const toReject = await createUser('NGO', 'hygiene1-reject', { isApproved: false, isActive: true });
      const rejectRes = await request(app)
        .post(`/api/users/${toReject.id}/reject`)
        .set('Authorization', `Bearer ${token}`);
      expect(rejectRes.body).not.toHaveProperty('password');

      const toSuspend = await createUser('DONOR', 'hygiene1-suspend');
      const suspendRes = await request(app)
        .post(`/api/users/${toSuspend.id}/suspend`)
        .set('Authorization', `Bearer ${token}`);
      expect(suspendRes.body).not.toHaveProperty('password');

      const toReactivate = await createUser('DONOR', 'hygiene1-react', { isActive: false });
      const activateRes = await request(app)
        .post(`/api/users/${toReactivate.id}/activate`)
        .set('Authorization', `Bearer ${token}`);
      expect(activateRes.body).not.toHaveProperty('password');

      // Belt and suspenders: no response body anywhere contains the literal
      // word "password" as a key, across all four.
      for (const body of [approveRes.body, rejectRes.body, suspendRes.body, activateRes.body]) {
        expect(Object.keys(body)).not.toContain('password');
      }
    });

    it('Test 17b: GET /users, GET /users/:id and GET /auth/profile never include a password field', async () => {
      const admin = await createUser('ADMIN', 'hygiene2-admin');
      const target = await createUser('DONOR', 'hygiene2-target');
      const adminToken = signToken(admin);
      const targetToken = signToken(target);

      const listRes = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
      expect((listRes.body as Record<string, unknown>[]).every((u) => !('password' in u))).toBe(true);

      const byIdRes = await request(app)
        .get(`/api/users/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(byIdRes.body).not.toHaveProperty('password');

      const profileRes = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${targetToken}`);
      expect(profileRes.body).not.toHaveProperty('password');
    });

    it('Test 18: a 403 from an unauthorized profile request leaks no target data', async () => {
      const donorA = await createUser('DONOR', 'hygiene3a');
      const donorB = await createUser('DONOR', 'hygiene3b');
      const token = signToken(donorA);

      const res = await request(app)
        .get(`/api/users/${donorB.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(Object.keys(res.body)).toEqual(['error']);
      expect(JSON.stringify(res.body)).not.toContain(donorB.email);
    });
  });
});
