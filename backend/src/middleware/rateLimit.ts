import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthRequest } from './auth.js';
import { config } from '../config/index.js';

// Scoped to POST /auth/login and POST /auth/register only (see
// auth.routes.ts) - never applied globally, so health checks and normal
// authenticated traffic are unaffected.

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  },
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many registration attempts. Please try again later.' });
  },
});

// Phase 13. Tighter than loginLimiter - this endpoint's abuse case isn't
// "guess a password" but "probe whether an email has an account" (by
// timing/volume) or spam a real inbox with reset links, so it gets a
// stricter cap.
export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many password reset requests. Please try again later.' });
  },
});

// Guessing a 256-bit reset token is already computationally infeasible
// regardless of rate limiting (see authService.resetPassword) - this is
// defense in depth against automated attempts, not the primary control.
export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  },
});

// Phase 21: the four limiters below protect the highest-impact
// *authenticated* mutation routes (donation/pickup marketplace actions,
// admin lifecycle actions, profile edits) - everything above this point
// protects pre-auth abuse (credential stuffing, account enumeration);
// these protect a valid-but-possibly-compromised-or-scripted account from
// hammering the marketplace state machine or another user's experience.
//
// Keyed by the authenticated user's own id (from the JWT, already
// verified by authenticate() before any of these run), not by IP -
// req.user is always populated by the time these run since every route
// they're mounted on requires authenticate() first. This is deliberately
// more precise than IP-based keying for these routes: it can't
// false-positive multiple legitimate users sharing an office/NAT IP
// against each other, and it doesn't depend on TRUST_PROXY being
// configured correctly the way req.ip-based keying does (Phase 19) - so
// this doesn't touch or weaken that fix, it simply doesn't need it. The
// ipKeyGenerator() fallback (IPv6-subnet-aware, per express-rate-limit's
// own guidance) only matters if one of these were ever mounted without
// authenticate() running first, which none currently are.
function userOrIpKey(req: Request): string {
  const userId = (req as AuthRequest).user?.id;
  return userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? 'unknown');
}

// Donor/NGO marketplace actions: create, cancel, release, claim a
// donation. A legitimate user rarely performs more than a handful of
// these per session; a script rapid-firing claims across many donations,
// or spam-creating/cancelling listings, is exactly the abuse case this
// closes without affecting normal usage.
export const donationMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimits.donationMutationsPerWindow,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
  },
});

// Volunteer pickup actions: accept, mark picked up, complete delivery.
export const pickupMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimits.pickupMutationsPerWindow,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
  },
});

// Admin actions: assign a volunteer, approve/reject/suspend/reactivate a
// user. Higher budget than the two above - a single admin session
// legitimately reviewing a batch of pending NGO signups, or triaging
// several pickups, does more individual actions than a single donor/NGO/
// volunteer normally would.
export const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimits.adminActionsPerWindow,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
  },
});

// Profile edits (PUT /auth/profile).
export const profileUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimits.profileUpdatesPerWindow,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
  },
});
