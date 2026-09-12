import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { pickupService } from '../services/pickup.service.js';

// Integration tests against a real Postgres database (see src/test/setup.ts
// for how DATABASE_URL is pointed at a dedicated "<db>_test" database).
// This exercises the actual Prisma transaction and the real UPDATE/lock
// behaviour the concurrency guarantee depends on - a mocked client couldn't
// tell us whether the claim race is actually closed.

const TEST_EMAIL_SUFFIX = '@test.foodbridge.local';

async function createUser(role: 'DONOR' | 'NGO' | 'VOLUNTEER', suffix: string) {
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}${TEST_EMAIL_SUFFIX}`,
      // Low cost factor: these tests never exercise login, they just need a
      // valid, non-null password hash.
      password: await bcrypt.hash('password123', 4),
      name: `${role} ${suffix}`,
      role,
      isApproved: true,
      isActive: true,
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

describe('donation claim -> pickup request flow', () => {
  beforeAll(async () => {
    // Clean slate, FK-safe order. This database only ever holds test data.
    await prisma.delivery.deleteMany();
    await prisma.pickupRequest.deleteMany();
    await prisma.donation.deleteMany();
    await prisma.adminLog.deleteMany();
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_SUFFIX } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('Test 1: NGO claiming an AVAILABLE donation creates a matching PickupRequest', async () => {
    const donor = await createUser('DONOR', 't1');
    const ngo = await createUser('NGO', 't1');
    const donation = await createAvailableDonation(donor.id, 't1');

    const claimed = await donationService.claim(donation.id, ngo.id);

    expect(claimed.status).toBe('CLAIMED');
    expect(claimed.claimedById).toBe(ngo.id);

    const pickupRequest = await prisma.pickupRequest.findUnique({
      where: { donationId: donation.id },
    });

    expect(pickupRequest).not.toBeNull();
    expect(pickupRequest?.donationId).toBe(donation.id);
    expect(pickupRequest?.status).toBe('PENDING');
    expect(pickupRequest?.volunteerId).toBeNull();
  });

  it('Test 2 & 3: a volunteer can retrieve the pickup and accept it, then complete the existing pickup/delivery flow', async () => {
    const donor = await createUser('DONOR', 't2');
    const ngo = await createUser('NGO', 't2');
    const volunteer = await createUser('VOLUNTEER', 't2');
    const donation = await createAvailableDonation(donor.id, 't2');

    await donationService.claim(donation.id, ngo.id);

    // Test 2: volunteer can retrieve the pickup created by the claim.
    const available = await pickupService.getAvailablePickups();
    const found = available.find((p) => p.donationId === donation.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe('PENDING');

    // Test 3: volunteer can accept it using the resulting PickupRequest.
    const accepted = await pickupService.acceptPickup(found!.id, volunteer.id);
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.volunteerId).toBe(volunteer.id);

    // The rest of the already-existing pickup/delivery flow should still work
    // unmodified on top of the newly-created PickupRequest.
    const pickedUp = await pickupService.markPickedUp(found!.id, volunteer.id);
    expect(pickedUp.status).toBe('PICKED_UP');

    const completed = await pickupService.completeDelivery(found!.id, volunteer.id);
    expect(completed.status).toBe('COMPLETED');

    const finalDonation = await prisma.donation.findUnique({ where: { id: donation.id } });
    expect(finalDonation?.status).toBe('DELIVERED');
  });

  it('Test 5: claiming an already-claimed donation fails cleanly and does not duplicate the pickup request', async () => {
    const donor = await createUser('DONOR', 't3');
    const ngo1 = await createUser('NGO', 't3a');
    const ngo2 = await createUser('NGO', 't3b');
    const donation = await createAvailableDonation(donor.id, 't3');

    await donationService.claim(donation.id, ngo1.id);

    await expect(donationService.claim(donation.id, ngo2.id)).rejects.toThrow(
      'Donation is not available'
    );

    const pickupRequests = await prisma.pickupRequest.findMany({
      where: { donationId: donation.id },
    });
    expect(pickupRequests).toHaveLength(1);

    const finalDonation = await prisma.donation.findUnique({ where: { id: donation.id } });
    expect(finalDonation?.claimedById).toBe(ngo1.id);
  });

  it('claiming a donation that does not exist fails cleanly', async () => {
    const ngo = await createUser('NGO', 't4');

    await expect(donationService.claim('does-not-exist', ngo.id)).rejects.toThrow(
      'Donation not found'
    );
  });

  it('Test 4: exactly one of two concurrent claims on the same donation succeeds', async () => {
    const donor = await createUser('DONOR', 't5');
    const ngoA = await createUser('NGO', 't5a');
    const ngoB = await createUser('NGO', 't5b');
    const donation = await createAvailableDonation(donor.id, 't5');

    const results = await Promise.allSettled([
      donationService.claim(donation.id, ngoA.id),
      donationService.claim(donation.id, ngoB.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe(
      'Donation is not available'
    );

    const pickupRequests = await prisma.pickupRequest.findMany({
      where: { donationId: donation.id },
    });
    expect(pickupRequests).toHaveLength(1);

    const finalDonation = await prisma.donation.findUnique({ where: { id: donation.id } });
    expect(finalDonation?.status).toBe('CLAIMED');
    expect([ngoA.id, ngoB.id]).toContain(finalDonation?.claimedById);
  });
});
