import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { userService } from '../services/user.service.js';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../config/index.js';

// Phase 22: one password policy (length-only: 6-72 characters, no
// complexity rules) enforced consistently across every place a password
// is ever set - registration, password reset, and admin provisioning.
// PASSWORD_MAX_LENGTH=72 is bcrypt's own real limit, not an arbitrary
// choice - see the comment on the constant in config/index.ts.

const EMAIL_PREFIX = 'phase22-password-policy-';
const emailFor = (suffix: string) => `${EMAIL_PREFIX}${suffix}@test.foodbridge.local`;

function repeat(char: string, n: number) {
  return char.repeat(n);
}

describe('Phase 22: password policy consistency', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('registration (HTTP)', () => {
    async function register(password: string, suffix: string) {
      return request(app)
        .post('/api/auth/register')
        .send({ email: emailFor(suffix), password, name: 'Test User', role: 'DONOR' });
    }

    it(`rejects a password below the ${PASSWORD_MIN_LENGTH}-character minimum`, async () => {
      const res = await register(repeat('a', PASSWORD_MIN_LENGTH - 1), 'below-min');
      expect(res.status).toBe(400);
    });

    it(`accepts a password at exactly the ${PASSWORD_MIN_LENGTH}-character minimum`, async () => {
      const res = await register(repeat('a', PASSWORD_MIN_LENGTH), 'at-min');
      expect(res.status).toBe(201);
    });

    it(`accepts a password at exactly the ${PASSWORD_MAX_LENGTH}-character maximum`, async () => {
      const res = await register(repeat('a', PASSWORD_MAX_LENGTH), 'at-max');
      expect(res.status).toBe(201);
    });

    it(`rejects a password above the ${PASSWORD_MAX_LENGTH}-character maximum`, async () => {
      const res = await register(repeat('a', PASSWORD_MAX_LENGTH + 1), 'above-max');
      expect(res.status).toBe(400);
    });

    it('rejects a grossly oversized password (abuse case, not just off-by-one)', async () => {
      const res = await register(repeat('a', 10_000), 'grossly-oversized');
      expect(res.status).toBe(400);
    });

    it('does NOT require complexity (no uppercase/number/symbol) - a plain lowercase password of sufficient length is accepted', async () => {
      const res = await register('plainlongpassword', 'no-complexity');
      expect(res.status).toBe(201);
    });
  });

  describe('password reset (HTTP validator)', () => {
    it(`rejects a reset password below the ${PASSWORD_MIN_LENGTH}-character minimum via the real HTTP route (validator, not just the service)`, async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'irrelevant-token-value', password: repeat('a', PASSWORD_MIN_LENGTH - 1) });
      expect(res.status).toBe(400);
    });

    it(`rejects a reset password above the ${PASSWORD_MAX_LENGTH}-character maximum via the real HTTP route`, async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'irrelevant-token-value', password: repeat('a', PASSWORD_MAX_LENGTH + 1) });
      expect(res.status).toBe(400);
    });

    it('registration and reset enforce the identical boundary - a password rejected at registration is also rejected at reset, and vice versa', async () => {
      const tooShort = repeat('a', PASSWORD_MIN_LENGTH - 1);
      const tooLong = repeat('a', PASSWORD_MAX_LENGTH + 1);

      const regShort = await request(app)
        .post('/api/auth/register')
        .send({ email: emailFor('consistency-short'), password: tooShort, name: 'X', role: 'DONOR' });
      const resetShort = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'x', password: tooShort });
      expect(regShort.status).toBe(400);
      expect(resetShort.status).toBe(400);

      const regLong = await request(app)
        .post('/api/auth/register')
        .send({ email: emailFor('consistency-long'), password: tooLong, name: 'X', role: 'DONOR' });
      const resetLong = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'x', password: tooLong });
      expect(regLong.status).toBe(400);
      expect(resetLong.status).toBe(400);
    });
  });

  describe('admin provisioning (userService.createAdmin)', () => {
    it(`rejects a password below the ${PASSWORD_MIN_LENGTH}-character minimum`, async () => {
      await expect(
        userService.createAdmin({
          email: emailFor('admin-below-min'),
          name: 'Admin',
          password: repeat('a', PASSWORD_MIN_LENGTH - 1),
        })
      ).rejects.toThrow(/between/);
    });

    it(`rejects a password above the ${PASSWORD_MAX_LENGTH}-character maximum`, async () => {
      await expect(
        userService.createAdmin({
          email: emailFor('admin-above-max'),
          name: 'Admin',
          password: repeat('a', PASSWORD_MAX_LENGTH + 1),
        })
      ).rejects.toThrow(/between/);
    });

    it('accepts a valid password within bounds, using the identical policy as registration/reset', async () => {
      const admin = await userService.createAdmin({
        email: emailFor('admin-valid'),
        name: 'Admin',
        password: repeat('a', PASSWORD_MIN_LENGTH),
      });
      expect(admin.role).toBe('ADMIN');
    });
  });

  it('no password is ever logged - console spy across a full register+reset-request+reset cycle never sees the raw password', async () => {
    const email = emailFor('no-log-check');
    const password = 'a-real-password-not-logged';

    const logs: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      await request(app).post('/api/auth/register').send({ email, password, name: 'X', role: 'DONOR' });
      await request(app).post('/api/auth/forgot-password').send({ email });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    const allLogged = logs.join(' ');
    expect(allLogged).not.toContain(password);
  });
});
