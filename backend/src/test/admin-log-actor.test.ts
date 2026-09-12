import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { config } from '../config/index.js';

// Phase 20: AdminLog.actorId (migration 20260911084043_add_adminlog_actor)
// makes the acting administrator a real, indexed foreign key instead of
// only free text inside `details`. These tests prove: every writer
// populates it correctly from the authenticated request's own JWT/user
// context; a client cannot influence it via request body content; and rows
// written before this field existed (actorId always null) remain readable.

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

async function latestAdminLogFor(userId: string, action: string) {
  return prisma.adminLog.findFirst({
    where: { userId, action },
    orderBy: { createdAt: 'desc' },
  });
}

describe('Phase 20: AdminLog structural actor identity', () => {
  beforeAll(async () => {
    const testUsers = await prisma.user.findMany({
      where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
      select: { id: true },
    });
    const testUserIds = testUsers.map((u) => u.id);

    await prisma.adminLog.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.delivery.deleteMany({ where: { pickupRequest: { donation: { donorId: { in: testUserIds } } } } });
    await prisma.pickupRequest.deleteMany({ where: { donation: { donorId: { in: testUserIds } } } });
    await prisma.donation.deleteMany({ where: { donorId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_SUFFIX } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('approving a user records the acting admin as actorId, and the target as userId', async () => {
    const admin = await createUser('ADMIN', 'approve-actor');
    const pendingNgo = await createUser('NGO', 'approve-target', { isApproved: false, isActive: true });

    const res = await request(app)
      .post(`/api/users/${pendingNgo.id}/approve`)
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send();

    expect(res.status).toBe(200);

    const log = await latestAdminLogFor(pendingNgo.id, 'USER_APPROVED');
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(admin.id);
    expect(log!.userId).toBe(pendingNgo.id);
  });

  it('rejecting a user records the acting admin as actorId', async () => {
    const admin = await createUser('ADMIN', 'reject-actor');
    const pendingNgo = await createUser('NGO', 'reject-target', { isApproved: false, isActive: true });

    const res = await request(app)
      .post(`/api/users/${pendingNgo.id}/reject`)
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send();

    expect(res.status).toBe(200);

    const log = await latestAdminLogFor(pendingNgo.id, 'USER_REJECTED');
    expect(log!.actorId).toBe(admin.id);
  });

  it('suspending a user records the acting admin as actorId', async () => {
    const admin = await createUser('ADMIN', 'suspend-actor');
    const activeDonor = await createUser('DONOR', 'suspend-target');

    const res = await request(app)
      .post(`/api/users/${activeDonor.id}/suspend`)
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send();

    expect(res.status).toBe(200);

    const log = await latestAdminLogFor(activeDonor.id, 'USER_SUSPENDED');
    expect(log!.actorId).toBe(admin.id);
  });

  it('reactivating a user records the acting admin as actorId', async () => {
    const admin = await createUser('ADMIN', 'activate-actor');
    const suspended = await createUser('VOLUNTEER', 'activate-target', { isApproved: true, isActive: false });

    const res = await request(app)
      .post(`/api/users/${suspended.id}/activate`)
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send();

    expect(res.status).toBe(200);

    const log = await latestAdminLogFor(suspended.id, 'USER_REACTIVATED');
    expect(log!.actorId).toBe(admin.id);
  });

  it('a client-supplied actorId in the request body is ignored entirely - the real authenticated admin always wins', async () => {
    const admin = await createUser('ADMIN', 'spoof-actor');
    const decoy = await createUser('ADMIN', 'spoof-decoy');
    const pendingNgo = await createUser('NGO', 'spoof-target', { isApproved: false, isActive: true });

    const res = await request(app)
      .post(`/api/users/${pendingNgo.id}/approve`)
      .set('Authorization', `Bearer ${signToken(admin)}`)
      // None of these routes read an actor/user id from the body at all -
      // this proves it, rather than assuming it from reading the code.
      .send({ actorId: decoy.id, userId: decoy.id, id: decoy.id });

    expect(res.status).toBe(200);

    const log = await latestAdminLogFor(pendingNgo.id, 'USER_APPROVED');
    expect(log!.actorId).toBe(admin.id);
    expect(log!.actorId).not.toBe(decoy.id);
  });

  it('admin donation-cancel records the acting admin as actorId via the real HTTP route', async () => {
    const admin = await createUser('ADMIN', 'cancel-actor');
    const donor = await createUser('DONOR', 'cancel-donor');
    const donation = await prisma.donation.create({
      data: {
        foodType: 'Test Meal',
        quantity: '5 servings',
        expiryTime: new Date(Date.now() + 60 * 60 * 1000),
        pickupLocation: 'Test Kitchen',
        status: 'AVAILABLE',
        donorId: donor.id,
      },
    });

    const res = await request(app)
      .post(`/api/donations/${donation.id}/cancel`)
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send();

    expect(res.status).toBe(200);

    const log = await prisma.adminLog.findFirst({
      where: { userId: donor.id, action: 'DONATION_CANCELLED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(admin.id);
  });

  it('a donor cancelling their own donation is self-service, not an admin action - no AdminLog row is written at all', async () => {
    const donor = await createUser('DONOR', 'selfcancel-donor');
    const donation = await prisma.donation.create({
      data: {
        foodType: 'Self Cancel Meal',
        quantity: '5 servings',
        expiryTime: new Date(Date.now() + 60 * 60 * 1000),
        pickupLocation: 'Test Kitchen',
        status: 'AVAILABLE',
        donorId: donor.id,
      },
    });

    await donationService.cancel(donation.id, { id: donor.id, role: 'DONOR', email: donor.email });

    const log = await prisma.adminLog.findFirst({
      where: { userId: donor.id, action: 'DONATION_CANCELLED' },
    });
    expect(log).toBeNull();
  });

  it('historical rows with no actorId (written before this field existed) remain queryable and readable', async () => {
    const target = await createUser('NGO', 'legacy-target');

    const legacyRow = await prisma.adminLog.create({
      data: {
        action: 'USER_APPROVED',
        details: `User ${target.email} approved`,
        level: 'success',
        userId: target.id,
        // actorId deliberately omitted - simulates a row written before
        // Phase 20, which the migration leaves untouched (nullable
        // column, no backfill).
      },
    });

    const fetched = await prisma.adminLog.findUnique({ where: { id: legacyRow.id } });
    expect(fetched).not.toBeNull();
    expect(fetched!.actorId).toBeNull();
    expect(fetched!.userId).toBe(target.id);
  });

  it('actorId is indexed and queryable directly: "everything this admin did" is a real, cheap query', async () => {
    const admin = await createUser('ADMIN', 'query-actor');
    const target1 = await createUser('NGO', 'query-target1', { isApproved: false, isActive: true });
    const target2 = await createUser('DONOR', 'query-target2');

    await request(app)
      .post(`/api/users/${target1.id}/approve`)
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send();
    await request(app)
      .post(`/api/users/${target2.id}/suspend`)
      .set('Authorization', `Bearer ${signToken(admin)}`)
      .send();

    const actions = await prisma.adminLog.findMany({ where: { actorId: admin.id } });
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(actions.every((a) => a.actorId === admin.id)).toBe(true);
  });
});
