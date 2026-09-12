import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { donationService } from '../services/donation.service.js';
import { pickupService } from '../services/pickup.service.js';
import { userService } from '../services/user.service.js';
import { notificationService } from '../services/notification.service.js';
import { config } from '../config/index.js';

// Phase 11: in-app notifications. Two concerns, tested separately:
//   - notificationService itself (Part A): creation, isolation, read state.
//   - every workflow integration point (Part B): a successful state
//     transition must create the right notification(s) for the right
//     recipient(s), inside the same transaction - a failed or losing
//     transition must create none.
// Part C then proves the HTTP layer (route -> authenticate -> controller)
// actually enforces recipient-only access, the same way
// admin-assignment.test.ts proves authorization through supertest rather
// than only at the service layer.

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
      foodType: `Test Meal ${suffix}`,
      quantity: '10 servings',
      expiryTime: new Date(Date.now() + 60 * 60 * 1000),
      pickupLocation: `Test Kitchen ${suffix}`,
      status: 'AVAILABLE',
      donorId,
    },
  });
}

async function notificationsFor(recipientId: string) {
  return prisma.notification.findMany({ where: { recipientId }, orderBy: { createdAt: 'asc' } });
}

function signToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

describe('Phase 11: in-app notifications', () => {
  beforeAll(async () => {
    const testUsers = await prisma.user.findMany({
      where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
      select: { id: true },
    });
    const testUserIds = testUsers.map((u) => u.id);

    // Notification.recipientId cascades on user delete, so no separate
    // notification cleanup is required here - deleting the test users
    // below removes their notifications along with everything else.
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

  describe('Part A: notificationService', () => {
    it('creates a notification for the given recipient, type, and reference, unread by default', async () => {
      const user = await createUser('DONOR', 'svc1');

      const created = await notificationService.create({
        recipientId: user.id,
        type: 'DONATION_CLAIMED',
        title: 'Test title',
        message: 'Test message',
        donationId: 'donation-123',
      });

      expect(created.recipientId).toBe(user.id);
      expect(created.type).toBe('DONATION_CLAIMED');
      expect(created.title).toBe('Test title');
      expect(created.message).toBe('Test message');
      expect(created.donationId).toBe('donation-123');
      expect(created.pickupRequestId).toBeNull();
      expect(created.isRead).toBe(false);
    });

    it('list() returns only the given recipient\'s notifications, newest first', async () => {
      const userA = await createUser('DONOR', 'svc2a');
      const userB = await createUser('DONOR', 'svc2b');

      await notificationService.create({
        recipientId: userA.id,
        type: 'DONATION_CLAIMED',
        title: 'First',
        message: 'm',
      });
      await notificationService.create({
        recipientId: userB.id,
        type: 'DONATION_CLAIMED',
        title: 'Not yours',
        message: 'm',
      });
      await notificationService.create({
        recipientId: userA.id,
        type: 'DONATION_CANCELLED',
        title: 'Second',
        message: 'm',
      });

      const list = await notificationService.list(userA.id);
      expect(list).toHaveLength(2);
      expect(list.every((n) => n.recipientId === userA.id)).toBe(true);
      // newest first
      expect(list[0].title).toBe('Second');
      expect(list[1].title).toBe('First');
    });

    it('list() respects and caps the limit', async () => {
      const user = await createUser('DONOR', 'svc3');
      for (let i = 0; i < 5; i++) {
        await notificationService.create({
          recipientId: user.id,
          type: 'DONATION_CLAIMED',
          title: `n${i}`,
          message: 'm',
        });
      }

      const limited = await notificationService.list(user.id, { limit: 2 });
      expect(limited).toHaveLength(2);

      const overCap = await notificationService.list(user.id, { limit: 9999 });
      expect(overCap.length).toBeLessThanOrEqual(50);
    });

    it('unreadCount() counts only unread notifications for that recipient', async () => {
      const user = await createUser('DONOR', 'svc4');
      const n1 = await notificationService.create({
        recipientId: user.id,
        type: 'DONATION_CLAIMED',
        title: 'a',
        message: 'm',
      });
      await notificationService.create({
        recipientId: user.id,
        type: 'DONATION_CLAIMED',
        title: 'b',
        message: 'm',
      });

      expect(await notificationService.unreadCount(user.id)).toBe(2);

      await notificationService.markRead(n1.id, user.id);
      expect(await notificationService.unreadCount(user.id)).toBe(1);
    });

    it('markRead() only succeeds for the owning recipient', async () => {
      const owner = await createUser('DONOR', 'svc5a');
      const stranger = await createUser('DONOR', 'svc5b');
      const notification = await notificationService.create({
        recipientId: owner.id,
        type: 'DONATION_CLAIMED',
        title: 'a',
        message: 'm',
      });

      await expect(notificationService.markRead(notification.id, stranger.id)).rejects.toThrow(
        'Notification not found'
      );

      const unchanged = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
      expect(unchanged.isRead).toBe(false);

      await notificationService.markRead(notification.id, owner.id);
      const updated = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
      expect(updated.isRead).toBe(true);
    });

    it('markRead() on a non-existent notification fails the same way as marking someone else\'s', async () => {
      const user = await createUser('DONOR', 'svc6');
      await expect(notificationService.markRead('does-not-exist', user.id)).rejects.toThrow(
        'Notification not found'
      );
    });

    it('markAllRead() marks only the given recipient\'s unread notifications', async () => {
      const userA = await createUser('DONOR', 'svc7a');
      const userB = await createUser('DONOR', 'svc7b');
      await notificationService.create({ recipientId: userA.id, type: 'DONATION_CLAIMED', title: 'a1', message: 'm' });
      await notificationService.create({ recipientId: userA.id, type: 'DONATION_CLAIMED', title: 'a2', message: 'm' });
      await notificationService.create({ recipientId: userB.id, type: 'DONATION_CLAIMED', title: 'b1', message: 'm' });

      await notificationService.markAllRead(userA.id);

      expect(await notificationService.unreadCount(userA.id)).toBe(0);
      expect(await notificationService.unreadCount(userB.id)).toBe(1);
    });
  });

  describe('Part B: workflow integration (transactional correctness)', () => {
    it('1. NGO claims a donation -> the donor is notified, addressed correctly, unread', async () => {
      const donor = await createUser('DONOR', 'wf1');
      const ngo = await createUser('NGO', 'wf1');
      const donation = await createAvailableDonation(donor.id, 'wf1');

      await donationService.claim(donation.id, ngo.id);

      const notes = await notificationsFor(donor.id);
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe('DONATION_CLAIMED');
      expect(notes[0].donationId).toBe(donation.id);
      expect(notes[0].isRead).toBe(false);
      expect(notes[0].message).toContain(donation.foodType);

      // The claiming NGO is not itself a recipient of this notification.
      expect(await notificationsFor(ngo.id)).toHaveLength(0);
    });

    it('a failed claim (already claimed) creates no notification at all', async () => {
      const donor = await createUser('DONOR', 'wf2');
      const ngo1 = await createUser('NGO', 'wf2a');
      const ngo2 = await createUser('NGO', 'wf2b');
      const donation = await createAvailableDonation(donor.id, 'wf2');

      await donationService.claim(donation.id, ngo1.id);
      const afterFirstClaim = await notificationsFor(donor.id);
      expect(afterFirstClaim).toHaveLength(1);

      await expect(donationService.claim(donation.id, ngo2.id)).rejects.toThrow(
        'Donation is not available'
      );

      // Still exactly one - the failed second claim added nothing.
      const afterFailedClaim = await notificationsFor(donor.id);
      expect(afterFailedClaim).toHaveLength(1);
    });

    it('a claim on a non-existent donation creates no notification', async () => {
      const ngo = await createUser('NGO', 'wf3');
      await expect(donationService.claim('does-not-exist', ngo.id)).rejects.toThrow(
        'Donation not found'
      );
      // Nothing to assert a recipient against - just confirm no orphaned rows appeared.
      const orphaned = await prisma.notification.findMany({ where: { donationId: 'does-not-exist' } });
      expect(orphaned).toHaveLength(0);
    });

    it('concurrent claims on the same donation produce exactly one donor notification, not two', async () => {
      const donor = await createUser('DONOR', 'wf4');
      const ngoA = await createUser('NGO', 'wf4a');
      const ngoB = await createUser('NGO', 'wf4b');
      const donation = await createAvailableDonation(donor.id, 'wf4');

      await Promise.allSettled([
        donationService.claim(donation.id, ngoA.id),
        donationService.claim(donation.id, ngoB.id),
      ]);

      const notes = await notificationsFor(donor.id);
      expect(notes).toHaveLength(1);
    });

    it('2. Admin assigns a volunteer -> the volunteer is notified, and the claiming NGO is notified', async () => {
      const donor = await createUser('DONOR', 'wf5');
      const ngo = await createUser('NGO', 'wf5');
      const volunteer = await createUser('VOLUNTEER', 'wf5');
      const donation = await createAvailableDonation(donor.id, 'wf5');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });

      await pickupService.assignVolunteer(pickupRequest.id, volunteer.id);

      const volunteerNotes = await notificationsFor(volunteer.id);
      expect(volunteerNotes).toHaveLength(1);
      expect(volunteerNotes[0].type).toBe('PICKUP_ASSIGNED');
      expect(volunteerNotes[0].pickupRequestId).toBe(pickupRequest.id);

      const ngoNotes = await notificationsFor(ngo.id);
      expect(ngoNotes).toHaveLength(1);
      expect(ngoNotes[0].type).toBe('PICKUP_ACCEPTED');
      expect(ngoNotes[0].pickupRequestId).toBe(pickupRequest.id);

      // The donor has only the earlier DONATION_CLAIMED notification -
      // assignment is not on the donor's notification list.
      const donorNotes = await notificationsFor(donor.id);
      expect(donorNotes.map((n) => n.type)).toEqual(['DONATION_CLAIMED']);
    });

    it('3. Volunteer self-accepts a pickup -> the NGO is notified, but the volunteer is not notified of their own action', async () => {
      const donor = await createUser('DONOR', 'wf6');
      const ngo = await createUser('NGO', 'wf6');
      const volunteer = await createUser('VOLUNTEER', 'wf6');
      const donation = await createAvailableDonation(donor.id, 'wf6');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });

      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      const ngoNotes = await notificationsFor(ngo.id);
      expect(ngoNotes).toHaveLength(1);
      expect(ngoNotes[0].type).toBe('PICKUP_ACCEPTED');

      expect(await notificationsFor(volunteer.id)).toHaveLength(0);
    });

    it('a rejected concurrent accept/assign produces no duplicate PICKUP_ACCEPTED notification for the NGO', async () => {
      const donor = await createUser('DONOR', 'wf7');
      const ngo = await createUser('NGO', 'wf7');
      const volunteerA = await createUser('VOLUNTEER', 'wf7a');
      const volunteerB = await createUser('VOLUNTEER', 'wf7b');
      const donation = await createAvailableDonation(donor.id, 'wf7');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });

      await Promise.allSettled([
        pickupService.acceptPickup(pickupRequest.id, volunteerA.id),
        pickupService.acceptPickup(pickupRequest.id, volunteerB.id),
      ]);

      const ngoNotes = (await notificationsFor(ngo.id)).filter((n) => n.type === 'PICKUP_ACCEPTED');
      expect(ngoNotes).toHaveLength(1);
    });

    it('an already-accepted pickup rejects a second assignment and creates no further notifications', async () => {
      const donor = await createUser('DONOR', 'wf8');
      const ngo = await createUser('NGO', 'wf8');
      const volunteer1 = await createUser('VOLUNTEER', 'wf8a');
      const volunteer2 = await createUser('VOLUNTEER', 'wf8b');
      const donation = await createAvailableDonation(donor.id, 'wf8');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });

      await pickupService.acceptPickup(pickupRequest.id, volunteer1.id);
      const ngoNotesAfterFirst = await notificationsFor(ngo.id);
      expect(ngoNotesAfterFirst.filter((n) => n.type === 'PICKUP_ACCEPTED')).toHaveLength(1);

      await expect(pickupService.assignVolunteer(pickupRequest.id, volunteer2.id)).rejects.toThrow(
        'already been accepted by another volunteer'
      );

      expect(await notificationsFor(volunteer2.id)).toHaveLength(0);
      const ngoNotesAfterFailedAssign = await notificationsFor(ngo.id);
      expect(ngoNotesAfterFailedAssign.filter((n) => n.type === 'PICKUP_ACCEPTED')).toHaveLength(1);
    });

    it('4. Volunteer marks a pickup as picked up -> both donor and NGO are notified', async () => {
      const donor = await createUser('DONOR', 'wf9');
      const ngo = await createUser('NGO', 'wf9');
      const volunteer = await createUser('VOLUNTEER', 'wf9');
      const donation = await createAvailableDonation(donor.id, 'wf9');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);

      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);

      const donorNotes = (await notificationsFor(donor.id)).filter((n) => n.type === 'PICKUP_STARTED');
      const ngoNotes = (await notificationsFor(ngo.id)).filter((n) => n.type === 'PICKUP_STARTED');
      expect(donorNotes).toHaveLength(1);
      expect(ngoNotes).toHaveLength(1);
      expect(donorNotes[0].pickupRequestId).toBe(pickupRequest.id);
    });

    it('an unauthorized volunteer marking a pickup as picked up creates no notification', async () => {
      const donor = await createUser('DONOR', 'wf10');
      const ngo = await createUser('NGO', 'wf10');
      const assignedVolunteer = await createUser('VOLUNTEER', 'wf10a');
      const otherVolunteer = await createUser('VOLUNTEER', 'wf10b');
      const donation = await createAvailableDonation(donor.id, 'wf10');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });
      await pickupService.acceptPickup(pickupRequest.id, assignedVolunteer.id);

      await expect(pickupService.markPickedUp(pickupRequest.id, otherVolunteer.id)).rejects.toThrow(
        'Not authorized to update this pickup'
      );

      expect((await notificationsFor(donor.id)).filter((n) => n.type === 'PICKUP_STARTED')).toHaveLength(0);
      expect((await notificationsFor(ngo.id)).filter((n) => n.type === 'PICKUP_STARTED')).toHaveLength(0);
    });

    it('5. Volunteer completes a delivery -> both donor and NGO are notified', async () => {
      const donor = await createUser('DONOR', 'wf11');
      const ngo = await createUser('NGO', 'wf11');
      const volunteer = await createUser('VOLUNTEER', 'wf11');
      const donation = await createAvailableDonation(donor.id, 'wf11');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);

      await pickupService.completeDelivery(pickupRequest.id, volunteer.id);

      const donorNotes = (await notificationsFor(donor.id)).filter((n) => n.type === 'DELIVERY_COMPLETED');
      const ngoNotes = (await notificationsFor(ngo.id)).filter((n) => n.type === 'DELIVERY_COMPLETED');
      expect(donorNotes).toHaveLength(1);
      expect(ngoNotes).toHaveLength(1);
    });

    it('completing an already-completed delivery fails and adds no further notification', async () => {
      const donor = await createUser('DONOR', 'wf12');
      const ngo = await createUser('NGO', 'wf12');
      const volunteer = await createUser('VOLUNTEER', 'wf12');
      const donation = await createAvailableDonation(donor.id, 'wf12');
      await donationService.claim(donation.id, ngo.id);
      const pickupRequest = await prisma.pickupRequest.findUniqueOrThrow({ where: { donationId: donation.id } });
      await pickupService.acceptPickup(pickupRequest.id, volunteer.id);
      await pickupService.markPickedUp(pickupRequest.id, volunteer.id);
      await pickupService.completeDelivery(pickupRequest.id, volunteer.id);

      await expect(pickupService.completeDelivery(pickupRequest.id, volunteer.id)).rejects.toThrow(
        'Cannot complete delivery from status COMPLETED'
      );

      expect(
        (await notificationsFor(donor.id)).filter((n) => n.type === 'DELIVERY_COMPLETED')
      ).toHaveLength(1);
    });

    it('Admin cancelling a CLAIMED donation notifies both the donor and the claiming NGO', async () => {
      const donor = await createUser('DONOR', 'wf13');
      const ngo = await createUser('NGO', 'wf13');
      const admin = await createUser('ADMIN', 'wf13');
      const donation = await createAvailableDonation(donor.id, 'wf13');
      await donationService.claim(donation.id, ngo.id);

      await donationService.cancel(donation.id, { id: admin.id, role: 'ADMIN' });

      const donorNotes = (await notificationsFor(donor.id)).filter((n) => n.type === 'DONATION_CANCELLED');
      const ngoNotes = (await notificationsFor(ngo.id)).filter((n) => n.type === 'DONATION_CANCELLED');
      expect(donorNotes).toHaveLength(1);
      expect(ngoNotes).toHaveLength(1);
    });

    it('a donor cancelling their own still-AVAILABLE donation does not notify themselves', async () => {
      const donor = await createUser('DONOR', 'wf14');
      const donation = await createAvailableDonation(donor.id, 'wf14');

      await donationService.cancel(donation.id, { id: donor.id, role: 'DONOR' });

      expect(await notificationsFor(donor.id)).toHaveLength(0);
    });

    it('6. Admin approves a pending NGO -> a USER_APPROVED notification exists for that NGO', async () => {
      const ngo = await createUser('NGO', 'wf15', { isApproved: false, isActive: true });

      await userService.approveUser(ngo.id);

      const notes = await notificationsFor(ngo.id);
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe('USER_APPROVED');
    });

    it('7. Admin rejects a pending NGO -> a USER_REJECTED notification exists for that NGO', async () => {
      const ngo = await createUser('NGO', 'wf16', { isApproved: false, isActive: true });

      await userService.rejectUser(ngo.id);

      const notes = await notificationsFor(ngo.id);
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe('USER_REJECTED');
    });

    it('8. Admin suspends an active user -> a USER_SUSPENDED notification exists for that user', async () => {
      const volunteer = await createUser('VOLUNTEER', 'wf17');

      await userService.suspendUser(volunteer.id);

      const notes = await notificationsFor(volunteer.id);
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe('USER_SUSPENDED');
    });

    it('Admin reactivates a suspended user -> a USER_REACTIVATED notification exists', async () => {
      const volunteer = await createUser('VOLUNTEER', 'wf18', { isActive: false });

      await userService.activateUser(volunteer.id);

      const notes = await notificationsFor(volunteer.id);
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe('USER_REACTIVATED');
    });

    it('a failed lifecycle transition (double-approve) creates no extra notification', async () => {
      const ngo = await createUser('NGO', 'wf19', { isApproved: false, isActive: true });
      await userService.approveUser(ngo.id);
      expect(await notificationsFor(ngo.id)).toHaveLength(1);

      await expect(userService.approveUser(ngo.id)).rejects.toThrow('User is not pending approval');

      expect(await notificationsFor(ngo.id)).toHaveLength(1);
    });
  });

  describe('Part C: notification API authorization (via the real HTTP route)', () => {
    it('a user can list only their own notifications', async () => {
      const userA = await createUser('DONOR', 'api1a');
      const userB = await createUser('DONOR', 'api1b');
      await notificationService.create({ recipientId: userA.id, type: 'DONATION_CLAIMED', title: 'mine', message: 'm' });
      await notificationService.create({ recipientId: userB.id, type: 'DONATION_CLAIMED', title: 'not mine', message: 'm' });

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${signToken(userA)}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('mine');
    });

    it('an unauthenticated request to list notifications is rejected', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });

    it('unread-count reflects only the caller\'s own unread notifications', async () => {
      const userA = await createUser('DONOR', 'api2a');
      const userB = await createUser('DONOR', 'api2b');
      await notificationService.create({ recipientId: userA.id, type: 'DONATION_CLAIMED', title: 'a1', message: 'm' });
      await notificationService.create({ recipientId: userA.id, type: 'DONATION_CLAIMED', title: 'a2', message: 'm' });
      await notificationService.create({ recipientId: userB.id, type: 'DONATION_CLAIMED', title: 'b1', message: 'm' });

      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${signToken(userA)}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });

    it('a user cannot mark another user\'s notification as read through the API', async () => {
      const owner = await createUser('DONOR', 'api3a');
      const stranger = await createUser('DONOR', 'api3b');
      const notification = await notificationService.create({
        recipientId: owner.id,
        type: 'DONATION_CLAIMED',
        title: 'a',
        message: 'm',
      });

      const res = await request(app)
        .post(`/api/notifications/${notification.id}/read`)
        .set('Authorization', `Bearer ${signToken(stranger)}`);

      expect(res.status).toBe(400);

      const unchanged = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
      expect(unchanged.isRead).toBe(false);
    });

    it('a user can mark their own notification as read through the API', async () => {
      const owner = await createUser('DONOR', 'api4');
      const notification = await notificationService.create({
        recipientId: owner.id,
        type: 'DONATION_CLAIMED',
        title: 'a',
        message: 'm',
      });

      const res = await request(app)
        .post(`/api/notifications/${notification.id}/read`)
        .set('Authorization', `Bearer ${signToken(owner)}`);

      expect(res.status).toBe(200);
      const updated = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
      expect(updated.isRead).toBe(true);
    });

    it('mark-all-read through the API only affects the caller\'s own notifications', async () => {
      const userA = await createUser('DONOR', 'api5a');
      const userB = await createUser('DONOR', 'api5b');
      await notificationService.create({ recipientId: userA.id, type: 'DONATION_CLAIMED', title: 'a1', message: 'm' });
      await notificationService.create({ recipientId: userA.id, type: 'DONATION_CLAIMED', title: 'a2', message: 'm' });
      const bNote = await notificationService.create({ recipientId: userB.id, type: 'DONATION_CLAIMED', title: 'b1', message: 'm' });

      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${signToken(userA)}`);

      expect(res.status).toBe(200);
      expect(await notificationService.unreadCount(userA.id)).toBe(0);

      const bUnchanged = await prisma.notification.findUniqueOrThrow({ where: { id: bNote.id } });
      expect(bUnchanged.isRead).toBe(false);
    });

    it('an ADMIN cannot read another user\'s notification inbox through these endpoints', async () => {
      const admin = await createUser('ADMIN', 'api6-admin');
      const donor = await createUser('DONOR', 'api6-donor');
      await notificationService.create({ recipientId: donor.id, type: 'DONATION_CLAIMED', title: 'private', message: 'm' });

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${signToken(admin)}`);

      expect(res.status).toBe(200);
      // These endpoints are self-scoped for every role, including ADMIN -
      // there is no admin override built into this API surface.
      expect(res.body).toHaveLength(0);
    });
  });
});
