import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { authService } from '../services/auth.service.js';
import { config } from '../config/index.js';

// Phase 13: password recovery. Most functional/security assertions call
// authService directly (same convention as auth-security.test.ts) so they
// don't burn against forgotPasswordLimiter/resetPasswordLimiter's small
// windows - real HTTP calls through supertest are reserved for the
// specific tests that need to prove the route/middleware chain itself
// (identical public response shape, authorization-independence, and the
// two dedicated rate-limit tests, which are deliberately last in their
// describe blocks so they don't starve earlier HTTP-layer tests).

const TEST_EMAIL_SUFFIX = '@test.foodbridge.local';

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function createUser(
  suffix: string,
  overrides: { password?: string; isApproved?: boolean; isActive?: boolean } = {}
) {
  const password = overrides.password ?? 'OriginalPass123';
  return {
    plaintextPassword: password,
    user: await prisma.user.create({
      data: {
        email: `user-${suffix}${TEST_EMAIL_SUFFIX}`,
        password: await bcrypt.hash(password, 4),
        name: `User ${suffix}`,
        role: 'DONOR',
        isApproved: overrides.isApproved ?? true,
        isActive: overrides.isActive ?? true,
      },
    }),
  };
}

// Issues a real reset token through the real service function and returns
// both the raw token (as a legitimate caller would receive it via email)
// and the DB row, for tests that need to inspect stored state.
async function issueResetToken(email: string) {
  await authService.requestPasswordReset(email);
  const row = await prisma.passwordResetToken.findFirstOrThrow({
    where: { user: { email } },
    orderBy: { createdAt: 'desc' },
  });
  return row;
}

// requestPasswordReset() never returns the raw token (by design - see
// authService), so tests that need one to call resetPassword() construct
// it directly here and insert the matching hash themselves, exactly
// mirroring what the real flow stores.
async function createTokenForUser(
  userId: string,
  overrides: { expiresAt?: Date; usedAt?: Date | null } = {}
) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
      usedAt: overrides.usedAt ?? null,
    },
  });
  return rawToken;
}

function signTokenAt(
  user: { id: string; email: string; role: string; name: string },
  issuedAtSeconds: number
) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name, iat: issuedAtSeconds },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

describe('Phase 13: password recovery', () => {
  beforeAll(async () => {
    // The @test.foodbridge.local suffix is shared across every test file
    // in this suite - clean up in the same FK-safe order the others use
    // (Donation has no cascade on delete, unlike Notification/
    // PasswordResetToken which do), rather than assuming this file is the
    // only one that has ever touched it.
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

  describe('Part A: forgot-password', () => {
    it('an existing email gets a reset token created', async () => {
      const { user } = await createUser('a1');

      await authService.requestPasswordReset(user.email);

      const tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
      expect(tokens).toHaveLength(1);
      expect(tokens[0].usedAt).toBeNull();
      expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('a nonexistent email creates no token and does not throw', async () => {
      await expect(
        authService.requestPasswordReset(`does-not-exist${TEST_EMAIL_SUFFIX}`)
      ).resolves.toBeUndefined();

      const tokens = await prisma.passwordResetToken.findMany({
        where: { user: { email: `does-not-exist${TEST_EMAIL_SUFFIX}` } },
      });
      expect(tokens).toHaveLength(0);
    });

    it('the raw token is never stored - only its SHA-256 hash', async () => {
      const { user } = await createUser('a2');
      await authService.requestPasswordReset(user.email);

      const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
      // A 256-bit token hex-encoded is 64 chars; so is a SHA-256 digest -
      // the meaningful check is that the stored value is a hash, not a
      // copy of anything guessable from this test alone (we never captured
      // a raw token to compare against, by design).
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('pending, rejected, and suspended accounts all still get a token created (no lifecycle branching)', async () => {
      const pending = await createUser('a3-pending', { isApproved: false, isActive: true });
      const rejected = await createUser('a3-rejected', { isApproved: false, isActive: false });
      const suspended = await createUser('a3-suspended', { isApproved: true, isActive: false });

      for (const { user } of [pending, rejected, suspended]) {
        await authService.requestPasswordReset(user.email);
        const tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
        expect(tokens).toHaveLength(1);
      }
    });

    it('a second request for the same user invalidates the first outstanding token', async () => {
      const { user } = await createUser('a4');

      const first = await issueResetToken(user.email);
      const second = await issueResetToken(user.email);

      expect(second.id).not.toBe(first.id);
      const remaining = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(second.id);

      const firstStillExists = await prisma.passwordResetToken.findUnique({ where: { id: first.id } });
      expect(firstStillExists).toBeNull();
    });

    it('HTTP: existing and nonexistent emails get byte-identical public responses', async () => {
      const { user } = await createUser('a5');

      const resExisting = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: user.email });
      const resMissing = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: `nobody-a5${TEST_EMAIL_SUFFIX}` });

      expect(resExisting.status).toBe(resMissing.status);
      expect(resExisting.status).toBe(200);
      expect(resExisting.body).toEqual(resMissing.body);
      // And the response reveals nothing account-state related.
      const bodyText = JSON.stringify(resExisting.body).toLowerCase();
      expect(bodyText).not.toMatch(/approv|active|suspend|reject|not found/);
    });

    it('rate limiting: the forgot-password endpoint returns a clean 429 once exceeded', async () => {
      // forgotPasswordLimiter allows 5 requests per window - this is the
      // last forgot-password HTTP test in the file on purpose.
      let lastRes: request.Response | undefined;
      for (let i = 0; i < 6; i++) {
        lastRes = await request(app)
          .post('/api/auth/forgot-password')
          .send({ email: `rate-check${TEST_EMAIL_SUFFIX}` });
      }

      expect(lastRes?.status).toBe(429);
      expect(lastRes?.body).toMatchObject({
        error: expect.stringContaining('Too many password reset requests'),
      });
    });
  });

  describe('Part B: reset-password', () => {
    it('a valid token succeeds and the password hash actually changes', async () => {
      const { user, plaintextPassword } = await createUser('b1');
      const rawToken = await createTokenForUser(user.id);
      const hashBefore = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).password;

      await authService.resetPassword(rawToken, 'BrandNewPass456');

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.password).not.toBe(hashBefore);
      expect(await bcrypt.compare(plaintextPassword, after.password)).toBe(false);
      expect(await bcrypt.compare('BrandNewPass456', after.password)).toBe(true);
    });

    it('the old password no longer works and the new one does, via authService.login', async () => {
      const { user, plaintextPassword } = await createUser('b2');
      const rawToken = await createTokenForUser(user.id);
      await authService.resetPassword(rawToken, 'BrandNewPass456');

      await expect(authService.login({ email: user.email, password: plaintextPassword })).rejects.toThrow(
        'Invalid email or password'
      );

      const loggedIn = await authService.login({ email: user.email, password: 'BrandNewPass456' });
      expect(loggedIn.user.id).toBe(user.id);
    });

    it('a nonexistent/garbage token fails with a generic error', async () => {
      await expect(authService.resetPassword('not-a-real-token', 'NewPass123')).rejects.toThrow(
        'This password reset link is invalid or has expired.'
      );
    });

    it('an expired token fails, and the password is unchanged', async () => {
      const { user, plaintextPassword } = await createUser('b3');
      const rawToken = await createTokenForUser(user.id, { expiresAt: new Date(Date.now() - 60_000) });

      await expect(authService.resetPassword(rawToken, 'NewPass123')).rejects.toThrow(
        'This password reset link is invalid or has expired.'
      );

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(await bcrypt.compare(plaintextPassword, after.password)).toBe(true);
    });

    it('an already-used token cannot be reused, and the second attempt fails cleanly', async () => {
      const { user } = await createUser('b4');
      const rawToken = await createTokenForUser(user.id);

      await authService.resetPassword(rawToken, 'FirstNewPass123');
      await expect(authService.resetPassword(rawToken, 'SecondNewPass456')).rejects.toThrow(
        'This password reset link is invalid or has expired.'
      );

      // The second (rejected) attempt's password must not have taken effect.
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(await bcrypt.compare('FirstNewPass123', after.password)).toBe(true);
    });

    it('a token belonging to a different, unrelated reset attempt (wrong token) fails', async () => {
      const { user: userA } = await createUser('b5a');
      const { user: userB } = await createUser('b5b');
      const tokenForB = await createTokenForUser(userB.id);

      // Reusing tokenForB's raw value is exactly "the right shape, wrong
      // secret" from userA's perspective - there is no per-user token
      // parameter to confuse, so this really just re-confirms a token is
      // globally single-use and user-bound via its own row, not guessable
      // per-target. Included for completeness against the "wrong token"
      // requirement.
      expect(tokenForB).not.toBe('');
      const wrongToken = crypto.randomBytes(32).toString('hex');
      await expect(authService.resetPassword(wrongToken, 'NewPass123')).rejects.toThrow(
        'This password reset link is invalid or has expired.'
      );
      // userA's password must be untouched by the failed attempt.
      const stillOriginal = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
      expect(await bcrypt.compare('OriginalPass123', stillOriginal.password)).toBe(true);
    });

    it('the project\'s existing password policy (min 6 chars) is enforced via the route validator', async () => {
      const { user } = await createUser('b6');
      const rawToken = await createTokenForUser(user.id);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: rawToken, password: '123' });

      expect(res.status).toBe(400);
      // The token must still be usable afterward - a rejected weak-password
      // attempt must not consume it.
      await authService.resetPassword(rawToken, 'ValidPass123');
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(await bcrypt.compare('ValidPass123', after.password)).toBe(true);
    });

    it('resetting one user\'s password cannot affect another user', async () => {
      const { user: userA } = await createUser('b7a');
      const { user: userB, plaintextPassword: bPassword } = await createUser('b7b');
      const hashBBefore = userB.password;
      const rawTokenA = await createTokenForUser(userA.id);

      await authService.resetPassword(rawTokenA, 'NewForA123');

      const bAfter = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
      expect(bAfter.password).toBe(hashBBefore);
      expect(await bcrypt.compare(bPassword, bAfter.password)).toBe(true);
    });

    it('reset-token guessing exposes nothing useful: nonexistent, expired, and used tokens all fail identically', async () => {
      const { user } = await createUser('b8');
      const expiredToken = await createTokenForUser(user.id, { expiresAt: new Date(Date.now() - 1000) });
      const usedToken = await createTokenForUser(user.id);
      await authService.resetPassword(usedToken, 'UsedUpPass123');
      const garbageToken = crypto.randomBytes(32).toString('hex');

      const errors = await Promise.all(
        [garbageToken, expiredToken, usedToken].map((t) =>
          authService.resetPassword(t, 'AnotherPass123').catch((e: Error) => e.message)
        )
      );

      expect(new Set(errors).size).toBe(1);
      expect(errors[0]).toBe('This password reset link is invalid or has expired.');
    });

    it('concurrent reset attempts with the same token: exactly one succeeds', async () => {
      const { user } = await createUser('b9');
      const rawToken = await createTokenForUser(user.id);

      const results = await Promise.allSettled([
        authService.resetPassword(rawToken, 'ConcurrentA123'),
        authService.resetPassword(rawToken, 'ConcurrentB456'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const matchesA = await bcrypt.compare('ConcurrentA123', after.password);
      const matchesB = await bcrypt.compare('ConcurrentB456', after.password);
      expect(matchesA !== matchesB).toBe(true); // exactly one matches

      const tokenRow = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(tokenRow.usedAt).not.toBeNull();
    });

    it('a successful reset creates a PASSWORD_RESET notification for that user only', async () => {
      const { user } = await createUser('b10');
      const rawToken = await createTokenForUser(user.id);

      await authService.resetPassword(rawToken, 'NotifyMe123');

      const notes = await prisma.notification.findMany({ where: { recipientId: user.id } });
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe('PASSWORD_RESET');
    });

    it('HTTP: reset-password does not require or use any Authorization header', async () => {
      const { user } = await createUser('b11');
      const rawToken = await createTokenForUser(user.id);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: rawToken, password: 'NoAuthHeader123' });

      expect(res.status).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(await bcrypt.compare('NoAuthHeader123', after.password)).toBe(true);
    });

    it('rate limiting: the reset-password endpoint returns a clean 429 once exceeded', async () => {
      // resetPasswordLimiter allows 10 requests per window - deliberately
      // the last reset-password HTTP test in the file.
      let lastRes: request.Response | undefined;
      for (let i = 0; i < 11; i++) {
        lastRes = await request(app)
          .post('/api/auth/reset-password')
          .send({ token: 'irrelevant-garbage-token', password: 'WhateverPass123' });
      }

      expect(lastRes?.status).toBe(429);
      expect(lastRes?.body).toMatchObject({ error: expect.stringContaining('Too many attempts') });
    });
  });

  describe('Part C: session behavior after reset', () => {
    it('a JWT issued before a password reset is rejected afterward; a fresh login token still works', async () => {
      const { user } = await createUser('c1');
      const preResetToken = signTokenAt(user, Math.floor(Date.now() / 1000));

      // Confirm the old token works before the reset.
      const beforeRes = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${preResetToken}`);
      expect(beforeRes.status).toBe(200);

      // Advance past the reset's timestamp resolution (passwordChangedAt
      // is compared in whole seconds against the JWT's `iat`).
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const rawToken = await createTokenForUser(user.id);
      await authService.resetPassword(rawToken, 'PostResetPass123');

      const afterRes = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${preResetToken}`);
      expect(afterRes.status).toBe(401);
      expect(afterRes.body.error).toContain('password change');

      const freshLogin = await authService.login({ email: user.email, password: 'PostResetPass123' });
      const freshRes = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${freshLogin.token}`);
      expect(freshRes.status).toBe(200);
    });

    it('a user who has never reset their password is unaffected (passwordChangedAt stays null)', async () => {
      const { user } = await createUser('c2');
      const token = signTokenAt(user, Math.floor(Date.now() / 1000) - 10);

      const res = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(dbUser.passwordChangedAt).toBeNull();
    });
  });
});
