import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { pickupService } from '../services/pickup.service.js';
import { authService } from '../services/auth.service.js';
import { authenticate, authorize, requireApproved, AuthRequest } from '../middleware/auth.js';
import { config } from '../config/index.js';

// Integration tests against a real Postgres test database (see
// src/test/setup.ts). Authorization behaviour is exercised by calling the
// real middleware functions with real signed JWTs and real DB-backed users -
// only the Express req/res/next objects are lightweight stand-ins, which is
// the normal way to unit-test middleware in isolation without booting an
// HTTP server.

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

async function createAvailableDonation(donorId: string, suffix: string) {
  return prisma.donation.create({
    data: {
      foodType: 'Test Meal',
      quantity: '10 servings',
      expiryTime: new Date(Date.now() + 60 * 60 * 1000),
      pickupLocation: `Test Kitchen ${suffix}`,
      status: 'AVAILABLE',
      donorId,
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

// Minimal Express req/res/next harness.
function mockContext(token?: string) {
  const req = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as AuthRequest;

  let statusCode: number | undefined;
  let body: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  return {
    req,
    res,
    next,
    statusCode: () => statusCode,
    body: () => body,
    nextCalled: () => nextCalled,
  };
}

describe('Phase 2: security, authorization & state integrity', () => {
  beforeAll(async () => {
    await prisma.delivery.deleteMany();
    await prisma.pickupRequest.deleteMany();
    await prisma.donation.deleteMany();
    await prisma.adminLog.deleteMany();
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_SUFFIX } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Part A: server-side approval enforcement', () => {
    it('registering as DONOR or VOLUNTEER auto-approves; registering as NGO does not', async () => {
      const donorResult = await authService.register({
        email: `donor-approval${TEST_EMAIL_SUFFIX}`,
        password: 'password123',
        name: 'Auto Approved Donor',
        role: 'DONOR',
      });
      expect(donorResult.user.isApproved).toBe(true);

      const volunteerResult = await authService.register({
        email: `volunteer-approval${TEST_EMAIL_SUFFIX}`,
        password: 'password123',
        name: 'Auto Approved Volunteer',
        role: 'VOLUNTEER',
      });
      expect(volunteerResult.user.isApproved).toBe(true);

      const ngoResult = await authService.register({
        email: `ngo-approval${TEST_EMAIL_SUFFIX}`,
        password: 'password123',
        name: 'Pending NGO',
        role: 'NGO',
      });
      expect(ngoResult.user.isApproved).toBe(false);
    });

    it('authenticate() lets an unapproved NGO through (valid, active account), but requireApproved blocks it', async () => {
      const pendingNgo = await createUser('NGO', 'pending', { isApproved: false });
      const token = signToken(pendingNgo);

      const auth = mockContext(token);
      await authenticate(auth.req, auth.res, auth.next);
      expect(auth.nextCalled()).toBe(true);
      expect(auth.req.user?.isApproved).toBe(false);

      const gate = mockContext();
      gate.req.user = auth.req.user;
      requireApproved(gate.req, gate.res, gate.next);

      expect(gate.nextCalled()).toBe(false);
      expect(gate.statusCode()).toBe(403);
      expect(gate.body()).toMatchObject({ error: expect.stringContaining('pending approval') });
    });

    it('an approved NGO passes requireApproved and can claim a donation end to end', async () => {
      const donor = await createUser('DONOR', 'appr1');
      const approvedNgo = await createUser('NGO', 'appr1', { isApproved: true });
      const donation = await createAvailableDonation(donor.id, 'appr1');
      const token = signToken(approvedNgo);

      const auth = mockContext(token);
      await authenticate(auth.req, auth.res, auth.next);

      const gate = mockContext();
      gate.req.user = auth.req.user;
      requireApproved(gate.req, gate.res, gate.next);
      expect(gate.nextCalled()).toBe(true);

      const roleGate = mockContext();
      roleGate.req.user = auth.req.user;
      authorize('NGO')(roleGate.req, roleGate.res, roleGate.next);
      expect(roleGate.nextCalled()).toBe(true);

      const claimed = await donationService.claim(donation.id, approvedNgo.id);
      expect(claimed.status).toBe('CLAIMED');
    });

    it('authenticate() rejects a suspended (inactive) account outright', async () => {
      const suspended = await createUser('DONOR', 'suspended', { isActive: false });
      const token = signToken(suspended);

      const auth = mockContext(token);
      await authenticate(auth.req, auth.res, auth.next);

      expect(auth.nextCalled()).toBe(false);
      expect(auth.statusCode()).toBe(401);
    });

    it('closes the audited vulnerability: an unapproved NGO cannot reach a claim through the same middleware chain the route uses', async () => {
      const donor = await createUser('DONOR', 'vuln1');
      const pendingNgo = await createUser('NGO', 'vuln1', { isApproved: false });
      const donation = await createAvailableDonation(donor.id, 'vuln1');
      const token = signToken(pendingNgo);

      // authenticate -> requireApproved -> authorize('NGO'), same order as
      // donation.routes.ts POST /:id/claim.
      const auth = mockContext(token);
      await authenticate(auth.req, auth.res, auth.next);
      expect(auth.nextCalled()).toBe(true); // the JWT itself is valid

      const gate = mockContext();
      gate.req.user = auth.req.user;
      requireApproved(gate.req, gate.res, gate.next);
      expect(gate.nextCalled()).toBe(false); // the chain stops here in production, before authorize/controller

      const donationAfter = await prisma.donation.findUnique({ where: { id: donation.id } });
      expect(donationAfter?.status).toBe('AVAILABLE');
    });
  });

  describe('Part B: donation ownership (IDOR)', () => {
    it('Donor B cannot cancel a donation owned by Donor A', async () => {
      const donorA = await createUser('DONOR', 'ownA');
      const donorB = await createUser('DONOR', 'ownB');
      const donation = await createAvailableDonation(donorA.id, 'own');

      await expect(
        donationService.cancel(donation.id, { id: donorB.id, role: 'DONOR' })
      ).rejects.toThrow('You can only cancel your own donations');

      const stillAvailable = await prisma.donation.findUnique({ where: { id: donation.id } });
      expect(stillAvailable?.status).toBe('AVAILABLE');
    });

    it('Donor A can still cancel their own AVAILABLE donation', async () => {
      const donorA = await createUser('DONOR', 'ownA2');
      const donation = await createAvailableDonation(donorA.id, 'own2');

      const cancelled = await donationService.cancel(donation.id, { id: donorA.id, role: 'DONOR' });
      expect(cancelled.status).toBe('CANCELLED');
    });
  });

  describe('Part C: donation state machine', () => {
    it('walks AVAILABLE -> CLAIMED -> PICKED_UP -> DELIVERED with no status skipped, then rejects DELIVERED -> CANCELLED', async () => {
      const donor = await createUser('DONOR', 'sm1');
      const ngo = await createUser('NGO', 'sm1');
      const volunteer = await createUser('VOLUNTEER', 'sm1');
      const donation = await createAvailableDonation(donor.id, 'sm1');

      const claimed = await donationService.claim(donation.id, ngo.id);
      expect(claimed.status).toBe('CLAIMED');

      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });

      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);
      const donationPickedUp = await prisma.donation.findUnique({ where: { id: donation.id } });
      expect(donationPickedUp?.status).toBe('PICKED_UP');

      await pickupService.completeDelivery(pickupRequest.id, volunteer.id);
      const donationDelivered = await prisma.donation.findUnique({ where: { id: donation.id } });
      expect(donationDelivered?.status).toBe('DELIVERED');

      await expect(
        donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' })
      ).rejects.toThrow('Cannot cancel a donation with status DELIVERED');
    });

    it('Phase 12: a DONOR can cancel a CLAIMED donation while the pickup is still PENDING, but not once a volunteer has accepted it; an ADMIN can cancel either way (administrative override)', async () => {
      const donor = await createUser('DONOR', 'sm2');
      const ngo = await createUser('NGO', 'sm2');
      const volunteer = await createUser('VOLUNTEER', 'sm2');
      const admin = await createUser('ADMIN', 'sm2');
      const donationA = await createAvailableDonation(donor.id, 'sm2a');
      const donationB = await createAvailableDonation(donor.id, 'sm2b');
      const donationC = await createAvailableDonation(donor.id, 'sm2c');

      // Still PENDING: the donor can cancel.
      await donationService.claim(donationA.id, ngo.id);
      const donorCancelled = await donationService.cancel(donationA.id, { id: donor.id, role: 'DONOR' });
      expect(donorCancelled.status).toBe('CANCELLED');

      // A volunteer has already accepted: the donor can no longer cancel.
      await donationService.claim(donationB.id, ngo.id);
      const pickupB = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donationB.id } });
      await pickupService.acceptPickup(pickupB.id, volunteer.id);
      await expect(
        donationService.cancel(donationB.id, { id: donor.id, role: 'DONOR' })
      ).rejects.toThrow('already has a volunteer assigned');
      const unchangedB = await prisma.donation.findUniqueOrThrow({ where: { id: donationB.id } });
      expect(unchangedB.status).toBe('CLAIMED');

      // ADMIN's pre-existing unconditional override is untouched by Phase 12.
      await donationService.claim(donationC.id, ngo.id);
      const adminCancelled = await donationService.cancel(donationC.id, { id: admin.id, role: 'ADMIN' });
      expect(adminCancelled.status).toBe('CANCELLED');
    });

    it('an already-cancelled donation cannot be cancelled again', async () => {
      const donor = await createUser('DONOR', 'sm3');
      const donation = await createAvailableDonation(donor.id, 'sm3');
      await donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' });

      await expect(
        donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' })
      ).rejects.toThrow('Cannot cancel a donation with status CANCELLED');
    });
  });

  describe('Part D: pickup request state machine', () => {
    it('rejects marking an unaccepted (PENDING) pickup as picked up', async () => {
      const donor = await createUser('DONOR', 'pd1');
      const ngo = await createUser('NGO', 'pd1');
      const volunteer = await createUser('VOLUNTEER', 'pd1');
      const donation = await createAvailableDonation(donor.id, 'pd1');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });

      await expect(pickupService.markPickedUp(pickupRequest.id, volunteer.id)).rejects.toThrow();
    });

    it('rejects completing a delivery that has not been picked up yet (ACCEPTED -> COMPLETED)', async () => {
      const donor = await createUser('DONOR', 'pd2');
      const ngo = await createUser('NGO', 'pd2');
      const volunteer = await createUser('VOLUNTEER', 'pd2');
      const donation = await createAvailableDonation(donor.id, 'pd2');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });

      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      await expect(
        pickupService.completeDelivery(pickupRequest.id, volunteer.id)
      ).rejects.toThrow('Cannot complete delivery from status ACCEPTED');
    });

    it('rejects re-accepting an already-accepted pickup, even by the same volunteer', async () => {
      const donor = await createUser('DONOR', 'pd3');
      const ngo = await createUser('NGO', 'pd3');
      const volunteer = await createUser('VOLUNTEER', 'pd3');
      const donation = await createAvailableDonation(donor.id, 'pd3');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });

      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      await expect(
        pickupService.acceptPickup(pickupRequest.id, volunteer.id)
      ).rejects.toThrow('Cannot accept a pickup request with status ACCEPTED');
    });

    it('rejects a second volunteer accepting a pickup already accepted by a different volunteer', async () => {
      const donor = await createUser('DONOR', 'pd4');
      const ngo = await createUser('NGO', 'pd4');
      const volunteerA = await createUser('VOLUNTEER', 'pd4a');
      const volunteerB = await createUser('VOLUNTEER', 'pd4b');
      const donation = await createAvailableDonation(donor.id, 'pd4');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });

      await pickupService.acceptPickup(pickupRequest.id, volunteerA.id);

      await expect(
        pickupService.acceptPickup(pickupRequest.id, volunteerB.id)
      ).rejects.toThrow('already been accepted by another volunteer');
    });

    it('a completed delivery cannot be re-accepted, re-picked-up, or re-completed', async () => {
      const donor = await createUser('DONOR', 'pd5');
      const ngo = await createUser('NGO', 'pd5');
      const volunteer = await createUser('VOLUNTEER', 'pd5');
      const donation = await createAvailableDonation(donor.id, 'pd5');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });

      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);
      await pickupService.completeDelivery(pickupRequest.id, volunteer.id);

      await expect(pickupService.acceptPickup(pickupRequest.id, volunteer.id)).rejects.toThrow(
        'Cannot accept a pickup request with status COMPLETED'
      );
      await expect(pickupService.markPickedUp(pickupRequest.id, volunteer.id)).rejects.toThrow(
        'Cannot mark as picked up from status COMPLETED'
      );
      await expect(pickupService.completeDelivery(pickupRequest.id, volunteer.id)).rejects.toThrow(
        'Cannot complete delivery from status COMPLETED'
      );

      const donationFinal = await prisma.donation.findUnique({ where: { id: donation.id } });
      expect(donationFinal?.status).toBe('DELIVERED');
    });
  });

  describe('Part E: pickup acceptance concurrency', () => {
    it('exactly one of two volunteers accepting the same PENDING pickup at the same time succeeds', async () => {
      const donor = await createUser('DONOR', 'conc1');
      const ngo = await createUser('NGO', 'conc1');
      const volunteerA = await createUser('VOLUNTEER', 'conc1a');
      const volunteerB = await createUser('VOLUNTEER', 'conc1b');
      const donation = await createAvailableDonation(donor.id, 'conc1');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });

      const results = await Promise.allSettled([
        pickupService.acceptPickup(pickupRequest.id, volunteerA.id),
        pickupService.acceptPickup(pickupRequest.id, volunteerB.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const final = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: pickupRequest.id } });
      expect(final.status).toBe('ACCEPTED');
      expect([volunteerA.id, volunteerB.id]).toContain(final.volunteerId);
    });
  });

  describe('Part G: RBAC on role-gated routes', () => {
    it('a DONOR token is rejected by an NGO-only route guard', () => {
      const ctx = mockContext();
      ctx.req.user = { id: 'x', email: 'x@x.com', role: 'DONOR', name: 'x', isApproved: true };

      authorize('NGO')(ctx.req, ctx.res, ctx.next);

      expect(ctx.nextCalled()).toBe(false);
      expect(ctx.statusCode()).toBe(403);
    });

    it('a DONOR token is rejected by a VOLUNTEER-only route guard', () => {
      const ctx = mockContext();
      ctx.req.user = { id: 'x', email: 'x@x.com', role: 'DONOR', name: 'x', isApproved: true };

      authorize('VOLUNTEER')(ctx.req, ctx.res, ctx.next);

      expect(ctx.nextCalled()).toBe(false);
      expect(ctx.statusCode()).toBe(403);
    });

    it('an NGO token is rejected by a DONOR-only route guard', () => {
      const ctx = mockContext();
      ctx.req.user = { id: 'x', email: 'x@x.com', role: 'NGO', name: 'x', isApproved: true };

      authorize('DONOR')(ctx.req, ctx.res, ctx.next);

      expect(ctx.nextCalled()).toBe(false);
      expect(ctx.statusCode()).toBe(403);
    });

    it('a volunteer cannot mutate a pickup accepted by a different volunteer', async () => {
      const donor = await createUser('DONOR', 'rbac1');
      const ngo = await createUser('NGO', 'rbac1');
      const volunteerA = await createUser('VOLUNTEER', 'rbac1a');
      const volunteerB = await createUser('VOLUNTEER', 'rbac1b');
      const donation = await createAvailableDonation(donor.id, 'rbac1');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });

      await pickupService.acceptPickup(pickupRequest.id, volunteerA.id);

      await expect(
        pickupService.markPickedUp(pickupRequest.id, volunteerB.id)
      ).rejects.toThrow('Not authorized to update this pickup');
    });
  });
});
