import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { userService } from '../services/user.service.js';
import { authService } from '../services/auth.service.js';
import { config } from '../config/index.js';

// Phase 5: user lifecycle (pending / rejected / active / suspended) and
// admin reactivation. Service-level cases give precise error-message
// assertions against the real test database; the authorization matrix goes
// through the real Express app via supertest (JWTs signed directly, not via
// POST /auth/login, to avoid Phase 3's login rate limiter, which is shared
// per-process across every test file that imports app.js).

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

// Convenience wrappers matching the three lifecycle states relevant here.
const pendingNgo = (suffix: string) => createUser('NGO', suffix, { isApproved: false, isActive: true });
const rejectedNgo = (suffix: string) => createUser('NGO', suffix, { isApproved: false, isActive: false });
const suspendedUser = (role: Role, suffix: string) =>
  createUser(role, suffix, { isApproved: true, isActive: false });

describe('Phase 5: user lifecycle, approval, rejection, suspension, reactivation', () => {
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

  describe('Approval (Tests 1-3)', () => {
    it('Test 1: a pending NGO can be approved by admin', async () => {
      const ngo = await pendingNgo('appr1');
      const approved = await userService.approveUser(ngo.id);
      expect(approved.isApproved).toBe(true);
      expect(approved.isActive).toBe(true);
    });

    it('Test 3: an already-approved user cannot be approved again', async () => {
      const ngo = await pendingNgo('appr2');
      await userService.approveUser(ngo.id);

      await expect(userService.approveUser(ngo.id)).rejects.toThrow('User is not pending approval');
    });

    it('a rejected NGO cannot be approved directly - it must be reactivated to PENDING first', async () => {
      const ngo = await rejectedNgo('appr3');

      await expect(userService.approveUser(ngo.id)).rejects.toThrow('User is not pending approval');
    });

    it('approving a non-existent user fails cleanly', async () => {
      await expect(userService.approveUser('does-not-exist')).rejects.toThrow('User not found');
    });

    it('an admin account cannot be modified through approveUser', async () => {
      const admin = await createUser('ADMIN', 'appr4');
      await expect(userService.approveUser(admin.id)).rejects.toThrow(
        'Cannot modify an admin account through this operation'
      );
    });
  });

  describe('Rejection (Tests 4-7)', () => {
    it('Test 4: a pending NGO can be rejected by admin', async () => {
      const ngo = await pendingNgo('rej1');
      const rejected = await userService.rejectUser(ngo.id);
      expect(rejected.isApproved).toBe(false);
      expect(rejected.isActive).toBe(false);
    });

    it('Test 6: a rejected NGO is distinguishable from a pending one in getAll/getPendingApprovals', async () => {
      const pending = await pendingNgo('rej2a');
      const toReject = await pendingNgo('rej2b');
      await userService.rejectUser(toReject.id);

      const pendingList = await userService.getPendingApprovals();
      const pendingIds = pendingList.map((u) => u.id);
      expect(pendingIds).toContain(pending.id);
      expect(pendingIds).not.toContain(toReject.id); // rejected must not linger as "pending"

      const allNgos = await userService.getAll({ role: 'NGO' });
      const rejectedRow = allNgos.find((u) => u.id === toReject.id);
      expect(rejectedRow?.isApproved).toBe(false);
      expect(rejectedRow?.isActive).toBe(false);
    });

    it('Test 7: a rejected NGO cannot claim a donation (no approved-NGO functionality)', async () => {
      const donor = await createUser('DONOR', 'rej3');
      const ngo = await rejectedNgo('rej3');
      const donation = await prisma.donation.create({
        data: {
          foodType: 'Test Meal',
          quantity: '5',
          expiryTime: new Date(Date.now() + 60 * 60 * 1000),
          pickupLocation: 'Test Kitchen',
          status: 'AVAILABLE',
          donorId: donor.id,
        },
      });

      // Rejected -> isActive=false, so authenticate() itself already blocks
      // them (see login-behavior tests below); this confirms the account
      // has no legitimate claim capability at the service/data level either.
      const token = signToken(ngo);
      const res = await request(app)
        .post(`/api/donations/${donation.id}/claim`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      const unchanged = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
      expect(unchanged.status).toBe('AVAILABLE');
    });

    it('rejecting an already-active (approved) user is illegal - use suspend for that', async () => {
      const ngo = await createUser('NGO', 'rej4', { isApproved: true, isActive: true });
      await expect(userService.rejectUser(ngo.id)).rejects.toThrow('User is not pending approval');
    });

    it('rejecting an already-rejected user is illegal (no double rejection)', async () => {
      const ngo = await rejectedNgo('rej5');
      await expect(userService.rejectUser(ngo.id)).rejects.toThrow('User is not pending approval');
    });
  });

  describe('Suspension (Test 8-9)', () => {
    it('Test 8: a suspended donor cannot create a donation', async () => {
      const donor = await suspendedUser('DONOR', 'susp1');
      const token = signToken(donor);

      const res = await request(app)
        .post('/api/donations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          foodType: 'X',
          quantity: '1',
          expiryTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          pickupLocation: 'X',
        });

      expect(res.status).toBe(401); // authenticate() rejects inactive accounts outright
    });

    it('suspending a pending (never-approved) user is illegal', async () => {
      const ngo = await pendingNgo('susp2');
      await expect(userService.suspendUser(ngo.id)).rejects.toThrow('User is not currently active');
    });

    it('suspending an already-suspended user is illegal', async () => {
      const donor = await suspendedUser('DONOR', 'susp3');
      await expect(userService.suspendUser(donor.id)).rejects.toThrow('User is not currently active');
    });

    it('an admin account cannot be suspended through this operation', async () => {
      const admin = await createUser('ADMIN', 'susp4');
      await expect(userService.suspendUser(admin.id)).rejects.toThrow(
        'Cannot modify an admin account through this operation'
      );
    });
  });

  describe('Reactivation (Tests 10, 12, 13)', () => {
    it('Test 10: admin can reactivate a legitimately suspended user, restoring full active state', async () => {
      const volunteer = await suspendedUser('VOLUNTEER', 'react1');
      const reactivated = await userService.activateUser(volunteer.id);
      expect(reactivated.isActive).toBe(true);
      expect(reactivated.isApproved).toBe(true);
    });

    it('Test 12: reactivating a REJECTED NGO returns it to PENDING, not to APPROVED', async () => {
      const ngo = await rejectedNgo('react2');
      const reactivated = await userService.activateUser(ngo.id);
      expect(reactivated.isActive).toBe(true);
      expect(reactivated.isApproved).toBe(false); // must NOT be auto-approved

      // And it must be visible again in the pending queue for real re-review.
      const pendingList = await userService.getPendingApprovals();
      expect(pendingList.map((u) => u.id)).toContain(ngo.id);
    });

    it('Test 13: reactivating an already-active user is rejected', async () => {
      const donor = await createUser('DONOR', 'react3');
      await expect(userService.activateUser(donor.id)).rejects.toThrow('User is already active');
    });

    it('reactivating a still-pending (never rejected/suspended) user is rejected - it was never inactive', async () => {
      const ngo = await pendingNgo('react4');
      await expect(userService.activateUser(ngo.id)).rejects.toThrow('User is already active');
    });

    it('reactivating a non-existent user fails cleanly', async () => {
      await expect(userService.activateUser('does-not-exist')).rejects.toThrow('User not found');
    });

    it('an admin account cannot be reactivated through this operation', async () => {
      const admin = await createUser('ADMIN', 'react5');
      await expect(userService.activateUser(admin.id)).rejects.toThrow(
        'Cannot modify an admin account through this operation'
      );
    });
  });

  describe('Authorization / IDOR (Tests 14-17)', () => {
    it('Test 14: operating on one user id never affects a different user', async () => {
      const ngoA = await pendingNgo('idor1a');
      const ngoB = await pendingNgo('idor1b');

      await userService.approveUser(ngoA.id);

      const untouchedB = await prisma.user.findUniqueOrThrow({ where: { id: ngoB.id } });
      expect(untouchedB.isApproved).toBe(false);
      expect(untouchedB.isActive).toBe(true);
    });

    it('Test 2 & 15: a non-admin (including the NGO itself) cannot approve via HTTP - 403', async () => {
      const ngo = await pendingNgo('rbac1');
      const token = signToken(ngo);

      const res = await request(app)
        .post(`/api/users/${ngo.id}/approve`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('Test 5 & 15: a non-admin (including the NGO itself) cannot reject via HTTP - 403', async () => {
      const ngo = await pendingNgo('rbac2');
      const token = signToken(ngo);

      const res = await request(app)
        .post(`/api/users/${ngo.id}/reject`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('Test 9 & 16: a VOLUNTEER cannot suspend anyone via HTTP - 403', async () => {
      const target = await createUser('DONOR', 'rbac3-target');
      const volunteer = await createUser('VOLUNTEER', 'rbac3-actor');
      const token = signToken(volunteer);

      const res = await request(app)
        .post(`/api/users/${target.id}/suspend`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('Test 11 & 17: a DONOR cannot reactivate anyone via HTTP - 403', async () => {
      const target = await suspendedUser('VOLUNTEER', 'rbac4-target');
      const donor = await createUser('DONOR', 'rbac4-actor');
      const token = signToken(donor);

      const res = await request(app)
        .post(`/api/users/${target.id}/activate`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('an unauthenticated request to any lifecycle endpoint is rejected with 401', async () => {
      const target = await pendingNgo('rbac5');

      const res = await request(app).post(`/api/users/${target.id}/approve`);

      expect(res.status).toBe(401);
    });

    it('ADMIN succeeds via the real HTTP route (positive control for the matrix above)', async () => {
      const ngo = await pendingNgo('rbac6-target');
      const admin = await createUser('ADMIN', 'rbac6-actor');
      const token = signToken(admin);

      const res = await request(app)
        .post(`/api/users/${ngo.id}/approve`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.isApproved).toBe(true);
    });
  });

  describe('Login behavior per lifecycle state (Tests 18-21)', () => {
    it('Test 18: a pending NGO gets the pending-approval message', async () => {
      const ngo = await pendingNgo('login1');
      await expect(
        authService.login({ email: ngo.email, password: 'password123' })
      ).rejects.toThrow('Your account is pending approval');
    });

    it('Test 19: a rejected NGO gets a distinct not-approved message', async () => {
      const ngo = await rejectedNgo('login2');
      await expect(
        authService.login({ email: ngo.email, password: 'password123' })
      ).rejects.toThrow('Your registration was not approved');
    });

    it('Test 20: a suspended user (donor, NGO, or volunteer) gets the deactivated message', async () => {
      const donor = await suspendedUser('DONOR', 'login3a');
      const ngo = await suspendedUser('NGO', 'login3b');
      const volunteer = await suspendedUser('VOLUNTEER', 'login3c');

      for (const user of [donor, ngo, volunteer]) {
        await expect(
          authService.login({ email: user.email, password: 'password123' })
        ).rejects.toThrow('Account is deactivated');
      }
    });

    it('Test 21: an active user logs in successfully', async () => {
      const donor = await createUser('DONOR', 'login4');
      const result = await authService.login({ email: donor.email, password: 'password123' });
      expect(result.token).toBeTruthy();
      expect(result.user.isApproved).toBe(true);
    });

    it('login does not reveal whether an account exists (Phase 3 behaviour preserved)', async () => {
      const donor = await createUser('DONOR', 'login5');

      let noSuchUserMessage = '';
      try {
        await authService.login({ email: 'nobody-here@test.foodbridge.local', password: 'whatever' });
      } catch (e) {
        noSuchUserMessage = e instanceof Error ? e.message : '';
      }

      let wrongPasswordMessage = '';
      try {
        await authService.login({ email: donor.email, password: 'definitely-wrong' });
      } catch (e) {
        wrongPasswordMessage = e instanceof Error ? e.message : '';
      }

      expect(noSuchUserMessage).toBe(wrongPasswordMessage);
      expect(noSuchUserMessage).toBe('Invalid email or password');
    });
  });
});
