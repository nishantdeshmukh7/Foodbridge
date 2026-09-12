import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import prisma from '../models/prisma.js';
import { config } from '../config/index.js';
import { emailService } from './email.service.js';
import { notificationService } from './notification.service.js';
import { getLoginThrottleDelayMs, recordLoginFailure, clearLoginThrottle, sleep } from './loginThrottle.js';

// SHA-256 of the raw, cryptographically-random reset token - never the
// token itself. A fast hash is the right choice here (unlike
// User.password's bcrypt): the input already has 256 bits of entropy from
// crypto.randomBytes(), so there's no dictionary/brute-force risk a slow,
// salted hash exists to defend against; this only needs to be a
// collision-resistant one-way map from token to a DB-lookupable value.
function hashResetToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export type UserRole = 'ADMIN' | 'DONOR' | 'NGO' | 'VOLUNTEER';

// ADMIN is deliberately excluded from the roles the public registration
// endpoint can grant - it must never be reachable through unauthenticated
// self-service, regardless of what a caller sends. ADMIN accounts are
// provisioned out of band (prisma/seed.ts or direct DB/Prisma Studio
// access) - see the Phase 3 report for why that's the current model.
export type PublicRegistrationRole = 'DONOR' | 'NGO' | 'VOLUNTEER';

export const PUBLIC_REGISTRATION_ROLES: readonly PublicRegistrationRole[] = [
  'DONOR',
  'NGO',
  'VOLUNTEER',
];

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  phone?: string;
  location?: string;
  organization?: string;
  role: PublicRegistrationRole;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    isApproved: boolean;
  };
  token: string;
}

function generateToken(payload: object): string {
  const options: SignOptions = {
    expiresIn: config.jwt.expiresIn,
  };
  return jwt.sign(payload, config.jwt.secret, options);
}

export const authService = {
  async register(data: RegisterData): Promise<AuthResult> {
    // Defense in depth: the route validator (auth.routes.ts) already
    // restricts the accepted role values, but this is the function that
    // actually creates the account, so it re-asserts the same allowlist
    // rather than trusting the caller. Nothing - not the route, not this
    // service - ever grants ADMIN through this path.
    if (!PUBLIC_REGISTRATION_ROLES.includes(data.role)) {
      throw new Error('Invalid role');
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new Error('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const isApproved = data.role === 'VOLUNTEER' || data.role === 'DONOR';

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email: data.email,
          password: hashedPassword,
          name: data.name,
          phone: data.phone,
          location: data.location,
          organization: data.organization || '',
          role: data.role,
          isApproved,
        },
      });
    } catch (error) {
      // Closes a TOCTOU race: two concurrent registrations with the same
      // email can both pass the findUnique check above; the loser hits
      // this unique constraint instead of the findUnique check, and would
      // otherwise leak a raw Prisma error message.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Error('Email already registered');
      }
      throw error;
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isApproved: user.isApproved,
      },
      token,
    };
  },

  async login(data: LoginData): Promise<AuthResult> {
    // Phase 24: see loginThrottle.ts. Applied before the lookup/compare
    // below (not after) so the delay is felt identically whether this
    // email has an account or not - consistent with every other
    // enumeration-safety measure in this function.
    const throttleDelayMs = getLoginThrottleDelayMs(data.email);
    if (throttleDelayMs > 0) {
      await sleep(throttleDelayMs);
    }

    const user = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user) {
      recordLoginFailure(data.email);
      throw new Error('Invalid email or password');
    }

    const isValidPassword = await bcrypt.compare(data.password, user.password);
    if (!isValidPassword) {
      recordLoginFailure(data.email);
      throw new Error('Invalid email or password');
    }

    // The correct password was just supplied - this identifier is no
    // longer under a credential-guessing attempt (or the real owner has
    // regained control), regardless of what the isActive/isApproved
    // checks below decide. Those checks reject a *correct* password on
    // lifecycle grounds, not a brute-force signal, so they must never
    // record a throttle failure themselves.
    clearLoginThrottle(data.email);

    // These messages only ever reach someone who has already supplied the
    // correct password, so distinguishing them doesn't create a pre-auth
    // account-enumeration oracle (see Phase 3). Distinguishing REJECTED from
    // a generic "deactivated" is deliberate: the frontend needs to tell a
    // rejected applicant something different from a suspended account.
    if (!user.isActive) {
      if (!user.isApproved) {
        // isApproved=false AND isActive=false = REJECTED (an NGO that was
        // reviewed and declined, not merely never-reviewed).
        throw new Error('Your registration was not approved. Please contact an administrator.');
      }
      throw new Error('Account is deactivated');
    }

    // isApproved=false AND isActive=true = PENDING (never reviewed yet).
    if (!user.isApproved) {
      throw new Error('Your account is pending approval. Please contact admin.');
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isApproved: user.isApproved,
      },
      token,
    };
  },

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
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

    if (!user) {
      throw new Error('User not found');
    }

    return user;
  },

  async updateProfile(userId: string, data: Partial<RegisterData>) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        name: data.name,
        phone: data.phone,
        location: data.location,
        organization: data.organization,
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      location: user.location,
      organization: user.organization,
      role: user.role,
    };
  },

  // Phase 13, step 1 of password recovery. Returns void, not a
  // user/boolean/anything else - that's deliberate. Every branch below
  // (account doesn't exist vs. does) must be indistinguishable to the
  // caller, and the only way to guarantee that at the type level is for
  // this function to have nothing to return. authController.forgotPassword
  // sends one fixed response regardless of what happens here.
  //
  // No isApproved/isActive check: a rejected/suspended/pending account can
  // still legitimately reset its password (e.g. ahead of being
  // reactivated) - the login gate independently blocks them afterward
  // regardless of password correctness, so allowing it here is harmless
  // and, more importantly, avoids adding an internal branch that could
  // ever become a second account-state oracle.
  async requestPasswordReset(rawEmail: string): Promise<void> {
    const email = rawEmail.trim();
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + config.passwordReset.tokenExpiryMinutes * 60 * 1000);
    // Built from config.cors.origin (FRONTEND_URL) - operator-configured,
    // never taken from the request - plus the token itself. Never an
    // arbitrary/attacker-supplied URL.
    const resetUrl = `${config.cors.origin}/reset-password?token=${rawToken}`;

    // Phase 25: the send is attempted BEFORE the token is persisted, and
    // the token is written only if that attempt succeeds (does not
    // throw). This matters now that a real provider exists and can
    // genuinely fail (see email.service.ts's SMTP_PROVIDER path) - the
    // three no-provider/dev-log modes never throw, so this preserves
    // their exact prior behavior unchanged. Persisting first, as before,
    // would mean a delivery failure both destroys any still-valid prior
    // token (the deleteMany below) AND leaves a new, undeliverable token
    // that nobody can ever use - strictly worse than not having tried at
    // all. Attempting the send first means a failure leaves the account's
    // existing reset state exactly as it was.
    await emailService.sendPasswordResetEmail({
      to: user.email,
      resetUrl,
      expiresInMinutes: config.passwordReset.tokenExpiryMinutes,
    });

    await prisma.$transaction(async (tx) => {
      // At most one outstanding reset token per user - an older link
      // (possibly already forwarded/exposed) stops working the instant a
      // newer one is requested.
      await tx.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      });

      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });
    });
  },

  // Phase 13, step 2. Looks the token up by its hash (never by scanning
  // raw values), and unifies "doesn't exist" / "expired" / "already used"
  // into one message and one code path throughout - a caller probing
  // tokens learns nothing about which case applied, and nothing here runs
  // measurably faster or slower for one case vs. another.
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashResetToken(rawToken);
    // Hashed before the transaction opens - bcrypt is pure CPU work with
    // no DB dependency, so there's no reason to hold a transaction/
    // connection open across it. If the transaction below ends up
    // rejecting the token, this hash is simply discarded.
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction(async (tx) => {
      const resetToken = await tx.passwordResetToken.findUnique({ where: { tokenHash } });

      const isUsable =
        !!resetToken && resetToken.usedAt === null && resetToken.expiresAt.getTime() > Date.now();

      if (!isUsable) {
        throw new Error('This password reset link is invalid or has expired.');
      }

      // Conditional update - only succeeds if still unused at write time.
      // Closes the race between two concurrent reset attempts presenting
      // the same token: same pattern as donationService.claim()'s
      // conditional updateMany elsewhere in this codebase.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken!.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      if (consumed.count === 0) {
        throw new Error('This password reset link is invalid or has expired.');
      }

      const changedAt = new Date();
      await tx.user.update({
        where: { id: resetToken!.userId },
        data: { password: hashedPassword, passwordChangedAt: changedAt },
      });

      // Security notification, not a workflow one - see the
      // PASSWORD_RESET doc comment in schema.prisma. Doesn't reveal
      // anything an attacker with the token didn't already accomplish;
      // it's for the legitimate account holder, if they still have an
      // active session anywhere (see middleware/auth.ts for how existing
      // JWTs are handled after this).
      await notificationService.create(
        {
          recipientId: resetToken!.userId,
          type: 'PASSWORD_RESET',
          title: 'Your password was changed',
          message:
            "Your password was successfully reset. If you didn't do this, contact an administrator immediately.",
        },
        tx
      );
    });
  },
};

