import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { authService } from '../services/auth.service.js';
import { emailService } from '../services/email.service.js';

// Phase 25: what happens to password-reset state when email delivery
// itself fails. Mocks emailService.sendPasswordResetEmail directly (via
// vi.spyOn on the real, already-imported singleton) rather than
// simulating a real SMTP failure end-to-end - the SMTP transport's own
// failure handling (never logging the token/credentials, always
// rethrowing a generic error) is already covered in
// email-smtp-delivery.test.ts. This file is about the layer above that:
// authService.requestPasswordReset's own behavior when the send it
// depends on rejects.

const TEST_EMAIL_SUFFIX = '@test.foodbridge.local';

async function createUser(suffix: string) {
  return prisma.user.create({
    data: {
      email: `emailfail-${suffix}${TEST_EMAIL_SUFFIX}`,
      password: await bcrypt.hash('OriginalPass123', 4),
      name: `Email Fail ${suffix}`,
      role: 'DONOR',
      isApproved: true,
      isActive: true,
    },
  });
}

describe('Phase 25: password-reset behavior when email delivery fails', () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a delivery failure creates no reset token at all - nothing is left dangling/undeliverable', async () => {
    const user = await createUser('nopersist');
    vi.spyOn(emailService, 'sendPasswordResetEmail').mockRejectedValueOnce(
      new Error('Failed to send password reset email.')
    );

    await expect(authService.requestPasswordReset(user.email)).rejects.toThrow();

    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(0);
  });

  it('a delivery failure on a second request does not destroy a still-valid prior token', async () => {
    const user = await createUser('keepprior');

    // First request succeeds (real emailService - DEV_LINK_SUPPRESSED in
    // the test environment, which never throws).
    await authService.requestPasswordReset(user.email);
    const before = await prisma.passwordResetToken.findMany({ where: { userId: user.id, usedAt: null } });
    expect(before).toHaveLength(1);

    // Second request's delivery fails.
    vi.spyOn(emailService, 'sendPasswordResetEmail').mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(authService.requestPasswordReset(user.email)).rejects.toThrow();

    const after = await prisma.passwordResetToken.findMany({ where: { userId: user.id, usedAt: null } });
    // Exactly the same token as before - untouched by the failed attempt.
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].tokenHash).toBe(before[0].tokenHash);
  });

  it('a delivery failure does not prevent the user from later successfully requesting a reset', async () => {
    const user = await createUser('retrylater');
    vi.spyOn(emailService, 'sendPasswordResetEmail').mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(authService.requestPasswordReset(user.email)).rejects.toThrow();
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);

    // Real emailService again (the mock was consumed via mockRejectedValueOnce).
    await authService.requestPasswordReset(user.email);
    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id, usedAt: null } });
    expect(tokens).toHaveLength(1);
  });

  it('HTTP: forgot-password returns the same generic response whether delivery fails or the account does not exist', async () => {
    const user = await createUser('httpenum');
    vi.spyOn(emailService, 'sendPasswordResetEmail').mockRejectedValueOnce(new Error('provider unavailable'));

    const existingButFailed = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const nonexistent = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: `httpenum-nobody${TEST_EMAIL_SUFFIX}` });

    expect(existingButFailed.status).toBe(200);
    expect(existingButFailed.status).toBe(nonexistent.status);
    expect(existingButFailed.body).toEqual(nonexistent.body);

    const bodyText = JSON.stringify(existingButFailed.body).toLowerCase();
    expect(bodyText).not.toMatch(/fail|error|provider|smtp/);
  });

  it('HTTP: a delivery failure never leaks the provider error message or any token to the client', async () => {
    const user = await createUser('httpnoLeak');
    vi.spyOn(emailService, 'sendPasswordResetEmail').mockRejectedValueOnce(
      new Error('535 Authentication credentials invalid for smtp-user@example.com')
    );

    const res = await request(app).post('/api/auth/forgot-password').send({ email: user.email });

    expect(res.status).toBe(200);
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain('535');
    expect(bodyText).not.toContain('Authentication credentials invalid');
    expect(bodyText).not.toContain('smtp-user@example.com');
  });
});
