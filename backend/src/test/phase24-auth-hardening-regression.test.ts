import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { authService } from '../services/auth.service.js';
import { userService } from '../services/user.service.js';
import { config } from '../config/index.js';

// Phase 24: consolidated regression proof that hardening the authentication
// architecture (shorter JWT lifetime, per-account login throttle,
// cross-tab frontend sync) did not weaken any of the existing revocation/
// authorization guarantees. Each of these is already covered in depth
// elsewhere (password-reset.test.ts, user-lifecycle.test.ts,
// auth-security.test.ts) - this file is deliberately a single, explicit
// place proving every guarantee named in the Phase 24 brief still holds,
// rather than relying on scattered coverage to imply it.

const TEST_EMAIL_SUFFIX = '@test.foodbridge.local';

type Role = 'ADMIN' | 'DONOR' | 'NGO' | 'VOLUNTEER';

async function createUser(
  role: Role,
  suffix: string,
  overrides: { isApproved?: boolean; isActive?: boolean; password?: string } = {}
) {
  const password = overrides.password ?? 'RegressionPass123';
  return {
    plaintextPassword: password,
    user: await prisma.user.create({
      data: {
        email: `p24-${role.toLowerCase()}-${suffix}${TEST_EMAIL_SUFFIX}`,
        password: await bcrypt.hash(password, 4),
        name: `${role} ${suffix}`,
        role,
        isApproved: overrides.isApproved ?? true,
        isActive: overrides.isActive ?? true,
      },
    }),
  };
}

function signToken(
  user: { id: string; email: string; role: string; name: string },
  options: jwt.SignOptions = { expiresIn: config.jwt.expiresIn }
) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, config.jwt.secret, options);
}

function hashResetToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function createResetTokenFor(userId: string) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  return rawToken;
}

describe('Phase 24: authentication hardening regression suite', () => {
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

  it('password reset invalidates tokens issued before the change; a fresh login still works', async () => {
    const { user } = await createUser('DONOR', 'reset');
    const preResetToken = signToken(user);

    const beforeRes = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${preResetToken}`);
    expect(beforeRes.status).toBe(200);

    // passwordChangedAt is compared to the JWT's iat in whole seconds -
    // advance past that resolution before resetting.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const rawResetToken = await createResetTokenFor(user.id);
    await authService.resetPassword(rawResetToken, 'BrandNewRegressionPass456');

    const afterRes = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${preResetToken}`);
    expect(afterRes.status).toBe(401);

    const freshLogin = await authService.login({ email: user.email, password: 'BrandNewRegressionPass456' });
    const freshRes = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${freshLogin.token}`);
    expect(freshRes.status).toBe(200);
  });

  it('suspending a user invalidates their access on the very next API request', async () => {
    const { user } = await createUser('VOLUNTEER', 'suspend');
    const token = signToken(user);

    const beforeRes = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
    expect(beforeRes.status).toBe(200);

    await userService.suspendUser(user.id);

    const afterRes = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
    expect(afterRes.status).toBe(401);
    expect(afterRes.body.error).toMatch(/inactive/i);
  });

  it('a rejected user remains unable to reach any authenticated route, including profile', async () => {
    const { user: pendingNgo } = await createUser('NGO', 'reject-src', { isApproved: false, isActive: true });
    await userService.rejectUser(pendingNgo.id);
    const rejected = await prisma.user.findUniqueOrThrow({ where: { id: pendingNgo.id } });
    const token = signToken(rejected);

    const profileRes = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
    expect(profileRes.status).toBe(401);

    const businessRes = await request(app).get('/api/donations/my-donations').set('Authorization', `Bearer ${token}`);
    expect(businessRes.status).toBe(401);
  });

  it('a pending (never-reviewed) user keeps profile access but is blocked from business routes', async () => {
    const { user } = await createUser('NGO', 'pending', { isApproved: false, isActive: true });
    const token = signToken(user);

    const profileRes = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
    expect(profileRes.status).toBe(200);

    const businessRes = await request(app)
      .get('/api/donations/my-claims')
      .set('Authorization', `Bearer ${token}`);
    expect(businessRes.status).toBe(403);
    expect(businessRes.body.error).toMatch(/pending approval/i);
  });

  it('an approved, active user is unaffected by any of the above gates', async () => {
    const { user } = await createUser('NGO', 'approved');
    const token = signToken(user);

    const profileRes = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
    expect(profileRes.status).toBe(200);

    const businessRes = await request(app)
      .get('/api/donations/my-claims')
      .set('Authorization', `Bearer ${token}`);
    expect(businessRes.status).toBe(200);
  });

  it('a tampered JWT (mutated signature) is rejected', async () => {
    const { user } = await createUser('DONOR', 'tamper');
    const token = signToken(user);
    const tampered = token.slice(0, -4) + (token.slice(-4) === 'abcd' ? 'wxyz' : 'abcd');

    const res = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid token');
  });

  it('a JWT signed with a different secret is rejected', async () => {
    const { user } = await createUser('DONOR', 'wrongsecret');
    const forged = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      'a-completely-different-secret-that-is-also-long-enough',
      { expiresIn: '1h' }
    );

    const res = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('an expired JWT is rejected', async () => {
    const { user } = await createUser('DONOR', 'expired');
    const expiredToken = signToken(user, { expiresIn: '-10s' });

    const res = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid token');
  });

  it('a real login signs its token using the currently configured JWT_EXPIRES_IN', async () => {
    // Deliberately compares against config.jwt.expiresIn itself rather
    // than a hardcoded literal - this environment's own .env may set
    // JWT_EXPIRES_IN to something other than the shipped 24h default (see
    // resolveJwtExpiresIn's own unit tests in config-validation.test.ts
    // for proof of the default itself). What this test actually regression-
    // guards is that authService.login's generateToken() still uses
    // config.jwt.expiresIn end-to-end, whatever that value is.
    const { user, plaintextPassword } = await createUser('DONOR', 'defaultexpiry');
    const result = await authService.login({ email: user.email, password: plaintextPassword });
    const decoded = jwt.decode(result.token) as { iat: number; exp: number };

    const referenceToken = jwt.sign({ probe: true }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    const reference = jwt.decode(referenceToken) as { iat: number; exp: number };

    expect(decoded.exp - decoded.iat).toBe(reference.exp - reference.iat);
  });

  it('no Authorization header at all is rejected with a clean 401, not a crash', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });
});
