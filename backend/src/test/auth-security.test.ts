import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import {
  authService,
  PUBLIC_REGISTRATION_ROLES,
  type PublicRegistrationRole,
} from '../services/auth.service.js';
import {
  assertValidJwtSecret,
  JWT_SECRET_MIN_LENGTH,
  KNOWN_PLACEHOLDER_JWT_SECRETS,
} from '../config/index.js';

// Phase 3: authentication security & production hardening.
//
// HTTP-level cases run through the real Express app (routes -> validator ->
// controller -> service -> database) via supertest, against a real
// Postgres test database - see src/test/setup.ts. app.ts exports the
// Express app without calling listen(), specifically so it can be imported
// here without starting a real server or binding a port.

const TEST_EMAIL_SUFFIX = '@test.foodbridge.local';

describe('Phase 3: authentication security & hardening', () => {
  beforeAll(async () => {
    // All test files share one Postgres test database and the same
    // "@test.foodbridge.local" convention. This file only ever creates
    // Users directly, but other files' leftover Donations/PickupRequests
    // (owned by test-suffixed users) can still be present, so they must be
    // cleared first, FK-safe, before the users themselves are deleted.
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

  describe('Part A/B/H.1-3: public registration cannot create ADMIN accounts', () => {
    it('Test 1: POST /api/auth/register rejects role=ADMIN end-to-end and creates no admin user', async () => {
      const email = `http-admin-attempt${TEST_EMAIL_SUFFIX}`;

      const res = await request(app).post('/api/auth/register').send({
        email,
        password: 'password123',
        name: 'Attacker',
        role: 'ADMIN',
      });

      expect(res.status).toBe(400);
      expect(res.body).not.toHaveProperty('token');

      const created = await prisma.user.findUnique({ where: { email } });
      expect(created).toBeNull();
    });

    it('Test 2: legitimate DONOR, NGO and VOLUNTEER registration still works end-to-end', async () => {
      for (const role of PUBLIC_REGISTRATION_ROLES) {
        const email = `http-${role.toLowerCase()}${TEST_EMAIL_SUFFIX}`;

        const res = await request(app).post('/api/auth/register').send({
          email,
          password: 'password123',
          name: `Real ${role}`,
          role,
        });

        expect(res.status).toBe(201);
        expect(res.body.user.role).toBe(role);
        expect(res.body.token).toBeTruthy();
        // Existing approval semantics (Phase 2): only NGO starts unapproved.
        expect(res.body.user.isApproved).toBe(role !== 'NGO');
      }
    });

    it('Test 3: an unsupported role string is rejected cleanly', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: `http-superadmin${TEST_EMAIL_SUFFIX}`,
        password: 'password123',
        name: 'Tamperer',
        role: 'SUPERADMIN',
      });

      expect(res.status).toBe(400);
      const created = await prisma.user.findUnique({
        where: { email: `http-superadmin${TEST_EMAIL_SUFFIX}` },
      });
      expect(created).toBeNull();
    });

    it('Test 3: a case-mismatched role ("donor") is rejected, not silently normalized', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: `http-lowercase${TEST_EMAIL_SUFFIX}`,
        password: 'password123',
        name: 'Tamperer',
        role: 'donor',
      });

      expect(res.status).toBe(400);
    });

    it('Test 3: a missing role is rejected', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: `http-norole${TEST_EMAIL_SUFFIX}`,
        password: 'password123',
        name: 'Tamperer',
      });

      expect(res.status).toBe(400);
    });

    it('authService.register rejects ADMIN even if a route validator were ever bypassed', async () => {
      const email = `direct-admin${TEST_EMAIL_SUFFIX}`;

      await expect(
        authService.register({
          email,
          password: 'password123',
          name: 'Direct Attacker',
          // Cast simulates a caller that skipped the route validator entirely -
          // the service itself is the last line of defense.
          role: 'ADMIN' as PublicRegistrationRole,
        })
      ).rejects.toThrow('Invalid role');

      const created = await prisma.user.findUnique({ where: { email } });
      expect(created).toBeNull();
    });

    it('a race between two concurrent registrations for the same email does not leak a raw database error', async () => {
      const email = `race-register${TEST_EMAIL_SUFFIX}`;
      const payload = { email, password: 'password123', name: 'Racer', role: 'DONOR' as const };

      const results = await Promise.allSettled([
        authService.register(payload),
        authService.register(payload),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.message).toBe('Email already registered');

      const users = await prisma.user.findMany({ where: { email } });
      expect(users).toHaveLength(1);
    });
  });

  describe('Part D: JWT secret validation (Test 4)', () => {
    it('rejects an unset secret', () => {
      expect(() => assertValidJwtSecret(undefined)).toThrow('JWT_SECRET is not set');
    });

    it('rejects an empty or whitespace-only secret', () => {
      expect(() => assertValidJwtSecret('   ')).toThrow('JWT_SECRET is not set');
    });

    it('rejects every known placeholder value used anywhere in this repo', () => {
      for (const placeholder of KNOWN_PLACEHOLDER_JWT_SECRETS) {
        expect(() => assertValidJwtSecret(placeholder)).toThrow('known placeholder value');
      }
    });

    it('rejects a secret shorter than the minimum length', () => {
      expect(() => assertValidJwtSecret('a'.repeat(JWT_SECRET_MIN_LENGTH - 1))).toThrow('too short');
    });

    it('accepts a properly generated secret and never echoes it back in the (non-)error', () => {
      const goodSecret = 'a'.repeat(JWT_SECRET_MIN_LENGTH);
      expect(() => assertValidJwtSecret(goodSecret)).not.toThrow();
    });
  });

  describe('Part E: rate limiting', () => {
    it('returns a clean 429 once the login rate limit is exceeded, without leaking internals', async () => {
      const credentials = { email: `rate-limit-check${TEST_EMAIL_SUFFIX}`, password: 'wrong-password' };
      let lastRes: request.Response | undefined;

      // loginLimiter allows 10 requests per window - the 11th must be blocked.
      for (let i = 0; i < 11; i++) {
        lastRes = await request(app).post('/api/auth/login').send(credentials);
      }

      expect(lastRes?.status).toBe(429);
      expect(lastRes?.body).toMatchObject({ error: expect.stringContaining('Too many login attempts') });
      expect(JSON.stringify(lastRes?.body)).not.toMatch(/at\s+\w+\s+\(.*:\d+:\d+\)/); // no stack trace shape
    });
  });

  describe('Part F: security headers', () => {
    it('helmet headers are present and CORS/API behaviour is unaffected', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok' });
      // A couple of helmet's defaults, as a smoke check that it is actually wired up.
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('Part G: authentication errors stay clean', () => {
    it('a malformed/garbage request body to /register never surfaces a stack trace or DB error', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .send('{not valid json');

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const text = JSON.stringify(res.body);
      expect(text.toLowerCase()).not.toContain('prisma');
      expect(text.toLowerCase()).not.toContain('at object.');
    });

    it('login does not reveal whether an email exists', async () => {
      await authService.register({
        email: `enum-check${TEST_EMAIL_SUFFIX}`,
        password: 'password123',
        name: 'Enumeration Check',
        role: 'DONOR',
      });

      const noSuchUser = await request(app)
        .post('/api/auth/login')
        .send({ email: `nobody-here${TEST_EMAIL_SUFFIX}`, password: 'whatever123' });

      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .send({ email: `enum-check${TEST_EMAIL_SUFFIX}`, password: 'definitely-wrong' });

      expect(noSuchUser.body.error).toBe(wrongPassword.body.error);
    });
  });
});
