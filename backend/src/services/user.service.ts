import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import prisma from '../models/prisma.js';
import { notificationService } from './notification.service.js';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../config/index.js';

// Same injectable-transaction-client convention as pickupService/
// donationService: each lifecycle mutation below runs its user.update(),
// its AdminLog write, and its notification through one `tx`, so all three
// commit or roll back together.
type Db = Prisma.TransactionClient | typeof prisma;

// Authoritative user lifecycle, expressed entirely through the existing
// (isApproved, isActive) pair - no new schema field needed. The pair forms
// a complete 4-state lattice:
//
//   isApproved=false, isActive=true  -> PENDING   (registered, never reviewed)
//   isApproved=false, isActive=false -> REJECTED  (reviewed and declined)
//   isApproved=true,  isActive=true  -> ACTIVE    (in good standing)
//   isApproved=true,  isActive=false -> SUSPENDED (was active, deactivated)
//
// Only NGO signups ever start at isApproved=false (see authService.register);
// every other role is created isApproved=true and can only ever move
// ACTIVE <-> SUSPENDED. Each function below only allows the one transition
// its name promises, out of exactly the state that transition is legal from.

async function getExistingUser(userId: string, db: Db = prisma) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }
  return user;
}

function assertNotAdmin(user: { role: string }) {
  if (user.role === 'ADMIN') {
    throw new Error('Cannot modify an admin account through this operation');
  }
}

// Every response that serializes a User row - list, detail, or a lifecycle
// mutation's result - must go through an explicit select like this one.
// Prisma's update()/findUnique() return every scalar field, bcrypt password
// hash included, when no select is given; without this, that hash would go
// straight into the HTTP response body.
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  location: true,
  organization: true,
  role: true,
  isApproved: true,
  isActive: true,
  createdAt: true,
} as const;

export const userService = {
  async getAll(filters?: {
    role?: string;
    isApproved?: boolean;
    search?: string;
  }) {
    const where: Record<string, unknown> = {};

    if (filters?.role) {
      where.role = filters.role;
    }

    if (filters?.isApproved !== undefined) {
      where.isApproved = filters.isApproved;
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { organization: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        location: true,
        organization: true,
        role: true,
        isApproved: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            donations: true,
            claims: true,
            pickups: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  },

  async getById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        location: true,
        organization: true,
        role: true,
        isApproved: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            donations: true,
            claims: true,
            pickups: true,
          },
        },
      },
    });

    return user;
  },

  // PENDING -> ACTIVE. Legal only from PENDING - an already-approved user or
  // a REJECTED one (isActive already false) cannot be "approved" through
  // this operation; a rejected NGO must go through activateUser() first
  // (back to PENDING) before it can be approved again.
  // actorId: the acting admin's own id, from the authenticated JWT/user
  // context (userController passes req.user!.id) - optional so existing
  // direct service-level tests/callers that don't need an audit trail
  // don't have to supply one; a real HTTP request always does. Never taken
  // from client-supplied input.
  async approveUser(userId: string, actorId?: string) {
    const target = await getExistingUser(userId);
    assertNotAdmin(target);

    if (target.isApproved || !target.isActive) {
      throw new Error('User is not pending approval');
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { isApproved: true },
        select: SAFE_USER_SELECT,
      });

      await tx.adminLog.create({
        data: {
          action: 'USER_APPROVED',
          details: `User ${user.email} approved`,
          level: 'success',
          userId,
          actorId,
        },
      });

      await notificationService.create(
        {
          recipientId: userId,
          type: 'USER_APPROVED',
          title: 'Your account was approved',
          message: 'Your account has been approved. You can now sign in and start using FoodBridge.',
        },
        tx
      );

      return user;
    });
  },

  // PENDING -> REJECTED. Legal only from PENDING, so this can't be used as a
  // generic "deactivate anyone" action (that's suspendUser, below) and can't
  // be called twice on the same account.
  async rejectUser(userId: string, actorId?: string) {
    const target = await getExistingUser(userId);
    assertNotAdmin(target);

    if (target.isApproved || !target.isActive) {
      throw new Error('User is not pending approval');
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
        select: SAFE_USER_SELECT,
      });

      await tx.adminLog.create({
        data: {
          action: 'USER_REJECTED',
          details: `User ${user.email} rejected`,
          level: 'warning',
          userId,
          actorId,
        },
      });

      // Reaches an inbox the recipient cannot currently open - a rejected
      // account is isActive=false and blocked at authenticate() (and at
      // login() before that). It's still written: durable, harmless, and
      // becomes visible retroactively if an admin later reactivates and
      // approves this account. There's no email channel in this phase (by
      // design - see the Phase 11 report) to reach them any sooner.
      await notificationService.create(
        {
          recipientId: userId,
          type: 'USER_REJECTED',
          title: 'Your registration was not approved',
          message: 'Your registration was reviewed and not approved. Contact an administrator for details.',
        },
        tx
      );

      return user;
    });
  },

  // ACTIVE -> SUSPENDED. Legal only from ACTIVE - a still-pending or
  // already-inactive (rejected/suspended) account has nothing to suspend.
  async suspendUser(userId: string, actorId?: string) {
    const target = await getExistingUser(userId);
    assertNotAdmin(target);

    if (!target.isApproved || !target.isActive) {
      throw new Error('User is not currently active');
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
        select: SAFE_USER_SELECT,
      });

      await tx.adminLog.create({
        data: {
          action: 'USER_SUSPENDED',
          details: `User ${user.email} suspended`,
          level: 'warning',
          userId,
          actorId,
        },
      });

      // Same reachability caveat as rejectUser(): suspended = isActive=false,
      // so this notification is invisible until the account is reactivated.
      await notificationService.create(
        {
          recipientId: userId,
          type: 'USER_SUSPENDED',
          title: 'Your account was suspended',
          message: 'Your account has been suspended by an administrator.',
        },
        tx
      );

      return user;
    });
  },

  // REJECTED or SUSPENDED -> isActive=true. Legal only from a currently
  // inactive account. This NEVER touches isApproved: a suspended user
  // (already isApproved=true) returns straight to ACTIVE, while a rejected
  // NGO (isApproved=false) returns to PENDING for re-review - never
  // straight to ACTIVE. That is deliberate: reactivating an account must
  // never be a backdoor around NGO approval.
  async activateUser(userId: string, actorId?: string) {
    const target = await getExistingUser(userId);
    assertNotAdmin(target);

    if (target.isActive) {
      throw new Error('User is already active');
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { isActive: true },
        select: SAFE_USER_SELECT,
      });

      await tx.adminLog.create({
        data: {
          action: 'USER_REACTIVATED',
          details: `User ${user.email} reactivated`,
          level: 'success',
          userId,
          actorId,
        },
      });

      // The one lifecycle notification guaranteed to be visible right away
      // in the common case: a reactivated SUSPENDED account is immediately
      // isApproved=true/isActive=true again and can log in and see this. A
      // reactivated REJECTED NGO instead lands back at PENDING - not yet
      // visible until a subsequent approval, same as USER_REJECTED above.
      await notificationService.create(
        {
          recipientId: userId,
          type: 'USER_REACTIVATED',
          title: 'Your account was reactivated',
          message: user.isApproved
            ? 'Your account has been reactivated. You can sign in again.'
            : 'Your account has been reactivated and is pending admin approval again.',
        },
        tx
      );

      return user;
    });
  },

  async getStats() {
    const [totalUsers, totalDonors, totalNgos, totalVolunteers, pendingNgos] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'DONOR' } }),
      prisma.user.count({ where: { role: 'NGO' } }),
      prisma.user.count({ where: { role: 'VOLUNTEER' } }),
      // isActive:true excludes REJECTED NGOs (isApproved=false, isActive=false)
      // from the pending count - only genuinely-never-reviewed NGOs count.
      prisma.user.count({ where: { role: 'NGO', isApproved: false, isActive: true } }),
    ]);

    return {
      total: totalUsers,
      donors: totalDonors,
      ngos: totalNgos,
      volunteers: totalVolunteers,
      pendingApprovals: pendingNgos,
    };
  },

  async getPendingApprovals() {
    const users = await prisma.user.findMany({
      where: {
        isApproved: false,
        // Excludes REJECTED NGOs (isActive=false) - a rejected NGO must not
        // keep showing up as "pending" forever.
        isActive: true,
        role: 'NGO',
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        location: true,
        organization: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return users;
  },

  // Phase 20: the sanctioned way to provision an additional ADMIN account
  // outside prisma/seed.ts (which must never run against production - see
  // its own NODE_ENV guard) or direct database access. There is no HTTP
  // route anywhere that calls this - it exists solely for
  // backend/scripts/create-admin.ts, a CLI tool an operator runs directly
  // against the target database, never something reachable over the
  // network. Public registration (POST /auth/register) is entirely
  // separate code (authService.register) and continues to reject ADMIN
  // regardless of what a caller sends - this function doesn't touch that
  // path and isn't a way around it.
  async createAdmin(data: { email: string; password: string; name: string }) {
    const email = data.email.trim();

    // Phase 22: this service function is the actual authoritative boundary
    // for this path (there's no HTTP route in front of it to validate at)
    // - backend/scripts/create-admin.ts already checks this before ever
    // calling here, but that's a convenience for the CLI's own error
    // messaging, not a substitute for the service enforcing its own
    // policy independent of any particular caller.
    if (data.password.length < PASSWORD_MIN_LENGTH || data.password.length > PASSWORD_MAX_LENGTH) {
      throw new Error(`Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Fails safely rather than silently overwriting whatever account
      // already owns this email - including turning some other role into
      // an admin by accident, or resetting an existing admin's password
      // without the operator explicitly intending that.
      throw new Error(`A user with email ${email} already exists (role: ${existing.role}).`);
    }

    // Same hashing mechanism and cost factor as authService.register() -
    // one password-hashing policy for every account in this codebase, not
    // a second one invented for this path.
    const hashedPassword = await bcrypt.hash(data.password, 12);

    const admin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: data.name.trim(),
        role: 'ADMIN',
        isApproved: true,
        isActive: true,
      },
      select: SAFE_USER_SELECT,
    });

    return admin;
  },
};

