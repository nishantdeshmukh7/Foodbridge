import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { pickupService } from '../services/pickup.service.js';
import { config } from '../config/index.js';

// Phase 7: donor/volunteer contact-information privacy on donation and
// pickup APIs. All authorization behaviour goes through the real Express
// app via supertest; JWTs are signed directly (not via POST /auth/login)
// to avoid Phase 3's shared per-process login rate limiter.

const TEST_EMAIL_SUFFIX = '@test.foodbridge.local';

type Role = 'ADMIN' | 'DONOR' | 'NGO' | 'VOLUNTEER';

async function createUser(role: Role, suffix: string) {
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}${TEST_EMAIL_SUFFIX}`,
      password: await bcrypt.hash('password123', 4),
      name: `${role} ${suffix}`,
      phone: `+1-555-${suffix.slice(0, 4).padEnd(4, '0')}`,
      role,
      isApproved: true,
      isActive: true,
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

describe('Phase 7: donor/volunteer contact-information privacy', () => {
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

  describe('Anonymous privacy (Tests 1-5)', () => {
    it('Test 1 & 2: anonymous GET /donations exposes no donor phone or email', async () => {
      const donor = await createUser('DONOR', 'anon1');
      await createAvailableDonation(donor.id, 'anon1');

      const res = await request(app).get('/api/donations');

      expect(res.status).toBe(200);
      const mine = res.body.find((d: { donorId: string }) => d.donorId === donor.id);
      expect(mine.donor.phone).toBeFalsy();
      expect(mine.donor).not.toHaveProperty('email');
    });

    it('Test 3: anonymous GET /donations/:id exposes no donor phone or email', async () => {
      const donor = await createUser('DONOR', 'anon2');
      const donation = await createAvailableDonation(donor.id, 'anon2');

      const res = await request(app).get(`/api/donations/${donation.id}`);

      expect(res.status).toBe(200);
      expect(res.body.donor.phone).toBeFalsy();
      expect(res.body.donor).not.toHaveProperty('email');
    });

    it('Test 4: anonymous GET /pickups/available exposes no private contact information', async () => {
      const donor = await createUser('DONOR', 'anon3');
      const ngo = await createUser('NGO', 'anon3');
      const donation = await createAvailableDonation(donor.id, 'anon3');
      await donationService.claim(donation.id, ngo.id);

      const res = await request(app).get('/api/pickups/available');

      expect(res.status).toBe(200);
      const mine = res.body.find((p: { donationId: string }) => p.donationId === donation.id);
      expect(mine.donation.donor).not.toHaveProperty('phone');
    });

    it('Test 5: anonymous GET /pickups/:id is rejected outright (401), no data at all', async () => {
      const donor = await createUser('DONOR', 'anon4');
      const ngo = await createUser('NGO', 'anon4');
      const donation = await createAvailableDonation(donor.id, 'anon4');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });

      const res = await request(app).get(`/api/pickups/${pickupRequest.id}`);

      expect(res.status).toBe(401);
      expect(res.body).not.toHaveProperty('donation');
    });
  });

  describe('Donor (Tests 6-7)', () => {
    it('Test 6: a donor sees their own phone number on their own donation detail', async () => {
      const donor = await createUser('DONOR', 'donor1');
      const donation = await createAvailableDonation(donor.id, 'donor1');
      const token = signToken(donor);

      const res = await request(app)
        .get(`/api/donations/${donation.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.donor.phone).toBe(donor.phone);
    });

    it('Test 7 & 15: a donor cannot see another donor’s phone by changing the donation id', async () => {
      const donorA = await createUser('DONOR', 'donor2a');
      const donorB = await createUser('DONOR', 'donor2b');
      const donationB = await createAvailableDonation(donorB.id, 'donor2b');
      const token = signToken(donorA);

      const res = await request(app)
        .get(`/api/donations/${donationB.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200); // donation browsing itself stays visible
      expect(res.body.donor.phone).toBeFalsy(); // but the phone is redacted
    });
  });

  describe('NGO (Tests 8-10, revised Phase 31 - closes the Phase 30 P2 finding)', () => {
    // Phase 7 originally let ANY approved NGO see a donor's phone on an
    // AVAILABLE, not-yet-claimed donation (a "contact the donor before
    // claiming" feature). The Phase 30 independent audit found no caller
    // anywhere in this codebase or its frontend that actually relies on
    // that broader grant, and flagged it as unnecessary PII exposure
    // (P2). Phase 31 closes it: phone visibility now requires an actual
    // relationship to the specific donation - see canSeeDonorPhone() in
    // donation.service.ts. This test replaces the old Test 8, which
    // asserted the now-deliberately-removed behavior.
    it('Test 8 (revised): an NGO that has NOT claimed a donation does not see the donor phone, even while browsing AVAILABLE listings', async () => {
      const donor = await createUser('DONOR', 'ngo1');
      const ngo = await createUser('NGO', 'ngo1');
      await createAvailableDonation(donor.id, 'ngo1');
      const token = signToken(ngo);

      const listRes = await request(app)
        .get('/api/donations?status=AVAILABLE')
        .set('Authorization', `Bearer ${token}`);
      const mineInList = listRes.body.find((d: { donorId: string }) => d.donorId === donor.id);
      expect(mineInList.donor.phone).toBeFalsy();
    });

    it('Test 9: the claiming NGO can see the contact info needed to coordinate', async () => {
      const donor = await createUser('DONOR', 'ngo2');
      const ngo = await createUser('NGO', 'ngo2');
      const donation = await createAvailableDonation(donor.id, 'ngo2');
      await donationService.claim(donation.id, ngo.id);
      const token = signToken(ngo);

      const res = await request(app)
        .get(`/api/donations/${donation.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.donor.phone).toBe(donor.phone);
    });

    it('Test 9b: the same claiming NGO also sees the phone in its own donation list (per-row, not list-wide)', async () => {
      const donor = await createUser('DONOR', 'ngo2b');
      const ngo = await createUser('NGO', 'ngo2b');
      const donation = await createAvailableDonation(donor.id, 'ngo2b');
      await donationService.claim(donation.id, ngo.id);
      const token = signToken(ngo);

      const res = await request(app)
        .get('/api/donations')
        .set('Authorization', `Bearer ${token}`);
      const mine = res.body.find((d: { id: string }) => d.id === donation.id);
      expect(mine.donor.phone).toBe(donor.phone);
    });

    it('Test 9c: NGO B (unrelated) does not see the phone on a donation NGO A claimed, on either the list or the detail view', async () => {
      const donor = await createUser('DONOR', 'ngo2c');
      const ngoA = await createUser('NGO', 'ngo2c-a');
      const ngoB = await createUser('NGO', 'ngo2c-b');
      const donation = await createAvailableDonation(donor.id, 'ngo2c');
      await donationService.claim(donation.id, ngoA.id);
      const tokenB = signToken(ngoB);

      const detailRes = await request(app)
        .get(`/api/donations/${donation.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(detailRes.status).toBe(200); // the donation itself is still visible
      expect(detailRes.body.donor.phone).toBeFalsy(); // the phone is not

      const listRes = await request(app)
        .get('/api/donations')
        .set('Authorization', `Bearer ${tokenB}`);
      const mine = listRes.body.find((d: { id: string }) => d.id === donation.id);
      expect(mine.donor.phone).toBeFalsy();
    });

    it('Test 9d: NGO B cannot obtain another donor’s phone by requesting a different donation id it also has no relationship to', async () => {
      const donorA = await createUser('DONOR', 'ngo2d-a');
      const donorB = await createUser('DONOR', 'ngo2d-b');
      const ngoB = await createUser('NGO', 'ngo2d-ngo');
      const donationA = await createAvailableDonation(donorA.id, 'ngo2d-a');
      await createAvailableDonation(donorB.id, 'ngo2d-b');
      const tokenB = signToken(ngoB);

      const res = await request(app)
        .get(`/api/donations/${donationA.id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.donor.phone).toBeFalsy();
    });

    it('Test 10: even with phone visible, an NGO never sees a donor’s email - the boundary is deliberate, not absent', async () => {
      const donor = await createUser('DONOR', 'ngo3');
      const ngo = await createUser('NGO', 'ngo3');
      const donation = await createAvailableDonation(donor.id, 'ngo3');
      await donationService.claim(donation.id, ngo.id);
      const token = signToken(ngo);

      const listRes = await request(app)
        .get('/api/donations')
        .set('Authorization', `Bearer ${token}`);
      const mine = listRes.body.find((d: { donorId: string }) => d.donorId === donor.id);
      expect(mine.donor).not.toHaveProperty('email');

      const detailRes = await request(app)
        .get(`/api/donations/${donation.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detailRes.body.donor).not.toHaveProperty('email');
    });
  });

  describe('Volunteer (Tests 11-13)', () => {
    async function createAssignedPickup(suffix: string) {
      const donor = await createUser('DONOR', `${suffix}-donor`);
      const ngo = await createUser('NGO', `${suffix}-ngo`);
      const volunteer = await createUser('VOLUNTEER', `${suffix}-vol`);
      const donation = await createAvailableDonation(donor.id, suffix);
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      return { donor, ngo, volunteer, donation, pickupRequest };
    }

    it('Test 11 & 13: an unassigned volunteer cannot fetch another volunteer’s pickup by id', async () => {
      const { pickupRequest } = await createAssignedPickup('vol1');
      const otherVolunteer = await createUser('VOLUNTEER', 'vol1-other');
      const token = signToken(otherVolunteer);

      const res = await request(app)
        .get(`/api/pickups/${pickupRequest.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty('donation');
    });

    it('Test 12: the assigned volunteer can see the contact info needed to complete the pickup', async () => {
      const { donor, volunteer, pickupRequest } = await createAssignedPickup('vol2');
      const token = signToken(volunteer);

      const res = await request(app)
        .get(`/api/pickups/${pickupRequest.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.donation.donor.phone).toBe(donor.phone);
    });

    // Phase 31: the same relationship also has to hold on the donation
    // endpoint (donationService.getById/getAll), not just the pickup
    // endpoint above - this exercises the exact function this phase
    // changed (canSeeDonorPhone).
    it('Test 12b (Phase 31): the assigned volunteer also sees the donor phone via GET /donations/:id', async () => {
      const { donor, volunteer, donation } = await createAssignedPickup('vol2b');
      const token = signToken(volunteer);

      const res = await request(app)
        .get(`/api/donations/${donation.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.donor.phone).toBe(donor.phone);
    });

    it('Test 12c (Phase 31): an unrelated volunteer (not assigned to this donation’s pickup) does not see the donor phone via GET /donations/:id', async () => {
      const { donation } = await createAssignedPickup('vol2c');
      const unrelatedVolunteer = await createUser('VOLUNTEER', 'vol2c-other');
      const token = signToken(unrelatedVolunteer);

      const res = await request(app)
        .get(`/api/donations/${donation.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.donor.phone).toBeFalsy();
    });

    it('Test 12d (Phase 31): a volunteer who hasn’t accepted any pickup yet does not see the donor phone while browsing', async () => {
      const donor = await createUser('DONOR', 'vol2d-donor');
      const volunteer = await createUser('VOLUNTEER', 'vol2d-vol');
      await createAvailableDonation(donor.id, 'vol2d');
      const token = signToken(volunteer);

      const res = await request(app)
        .get('/api/donations')
        .set('Authorization', `Bearer ${token}`);
      const mine = res.body.find((d: { donorId: string }) => d.donorId === donor.id);

      expect(mine.donor.phone).toBeFalsy();
    });
  });

  describe('Pending/rejected/suspended NGO identity alone is not a relationship (Phase 31)', () => {
    // GET /donations and GET /donations/:id use optionalAuth (see
    // donation.routes.ts), which attaches req.user for any token whose
    // account is still isActive - it does not check isApproved. A pending
    // NGO's token therefore still reaches donationService with
    // role: 'NGO' populated. Before Phase 31, that alone was enough to see
    // every donor's phone (canSeeDonorContact's blanket role check) -
    // these tests prove that merely holding an NGO identity, approved or
    // not, is no longer sufficient on its own.
    it('a pending (never-approved) NGO does not see donor phone merely by having role=NGO', async () => {
      const donor = await createUser('DONOR', 'pend1-donor');
      const pendingNgo = await prisma.user.create({
        data: {
          email: `ngo-pend1${TEST_EMAIL_SUFFIX}`,
          password: await bcrypt.hash('password123', 4),
          name: 'Pending NGO',
          role: 'NGO',
          isApproved: false,
          isActive: true,
        },
      });
      await createAvailableDonation(donor.id, 'pend1');
      const token = signToken(pendingNgo);

      const res = await request(app)
        .get('/api/donations')
        .set('Authorization', `Bearer ${token}`);
      const mine = res.body.find((d: { donorId: string }) => d.donorId === donor.id);

      expect(mine.donor.phone).toBeFalsy();
    });

    it('a suspended NGO’s old token cannot be used to see donor phone (authenticate()/optionalAuth already reject it - re-confirmed here)', async () => {
      const donor = await createUser('DONOR', 'susp1-donor');
      const suspendedNgo = await prisma.user.create({
        data: {
          email: `ngo-susp1${TEST_EMAIL_SUFFIX}`,
          password: await bcrypt.hash('password123', 4),
          name: 'Suspended NGO',
          role: 'NGO',
          isApproved: true,
          isActive: false,
        },
      });
      await createAvailableDonation(donor.id, 'susp1');
      const token = signToken(suspendedNgo);

      const res = await request(app)
        .get('/api/donations')
        .set('Authorization', `Bearer ${token}`);
      // optionalAuth silently continues unauthenticated for an inactive
      // account rather than rejecting the request outright - either way,
      // no donor phone can leak through this identity.
      const mine = res.body.find((d: { donorId: string }) => d.donorId === donor.id);
      expect(mine.donor.phone).toBeFalsy();
    });
  });

  describe('Admin (Test 14)', () => {
    it('Test 14: admin retains full contact access on both donations and pickups', async () => {
      const donor = await createUser('DONOR', 'admin1');
      const ngo = await createUser('NGO', 'admin1');
      const volunteer = await createUser('VOLUNTEER', 'admin1');
      const admin = await createUser('ADMIN', 'admin1');
      const donation = await createAvailableDonation(donor.id, 'admin1');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donation.id },
      });
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      const token = signToken(admin);

      const donationRes = await request(app)
        .get(`/api/donations/${donation.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(donationRes.body.donor.phone).toBe(donor.phone);

      const pickupRes = await request(app)
        .get(`/api/pickups/${pickupRequest.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(pickupRes.status).toBe(200);
      expect(pickupRes.body.donation.donor.phone).toBe(donor.phone);
    });
  });

  describe('IDOR (Tests 15-16)', () => {
    it('Test 16: changing the pickup id does not expose an unrelated volunteer’s contact info', async () => {
      const scenarioA = await (async () => {
        const donor = await createUser('DONOR', 'idorA-donor');
        const ngo = await createUser('NGO', 'idorA-ngo');
        const volunteer = await createUser('VOLUNTEER', 'idorA-vol');
        const donation = await createAvailableDonation(donor.id, 'idorA');
        await donationService.claim(donation.id, ngo.id);
        const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({
          where: { donationId: donation.id },
        });
        await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
        return { volunteer, pickupRequest };
      })();

      const donorB = await createUser('DONOR', 'idorB-donor');
      const ngoB = await createUser('NGO', 'idorB-ngo');
      const volunteerB = await createUser('VOLUNTEER', 'idorB-vol');
      const donationB = await createAvailableDonation(donorB.id, 'idorB');
      await donationService.claim(donationB.id, ngoB.id);
      const pickupRequestB = await prisma.pickupRequest.findUniqueOrThrow({
        where: { donationId: donationB.id },
      });
      await pickupService.acceptPickup(pickupRequestB.id, volunteerB.id);

      // Volunteer B, authenticated, tries scenario A's pickup id.
      const token = signToken(volunteerB);
      const res = await request(app)
        .get(`/api/pickups/${scenarioA.pickupRequest.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Response hygiene (Tests 17-18)', () => {
    it('Test 17: no donation/pickup endpoint returns a password field', async () => {
      const donor = await createUser('DONOR', 'hygiene1');
      const ngo = await createUser('NGO', 'hygiene1');
      const donation = await createAvailableDonation(donor.id, 'hygiene1');
      await donationService.claim(donation.id, ngo.id);
      const admin = await createUser('ADMIN', 'hygiene1');
      const token = signToken(admin);

      const listRes = await request(app).get('/api/donations');
      expect(JSON.stringify(listRes.body)).not.toContain('"password"');

      const detailRes = await request(app)
        .get(`/api/donations/${donation.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(JSON.stringify(detailRes.body)).not.toContain('"password"');

      const availableRes = await request(app).get('/api/pickups/available');
      expect(JSON.stringify(availableRes.body)).not.toContain('"password"');
    });

    it('Test 18: an anonymous donation response carries no unnecessary user fields (isApproved/isActive/email)', async () => {
      const donor = await createUser('DONOR', 'hygiene2');
      await createAvailableDonation(donor.id, 'hygiene2');

      const res = await request(app).get('/api/donations');
      const mine = res.body.find((d: { donorId: string }) => d.donorId === donor.id);

      expect(mine.donor).not.toHaveProperty('email');
      expect(mine.donor).not.toHaveProperty('isApproved');
      expect(mine.donor).not.toHaveProperty('isActive');
      expect(mine.donor).not.toHaveProperty('password');
    });
  });
});
