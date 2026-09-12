import dotenv from 'dotenv';
import type { SignOptions } from 'jsonwebtoken';

dotenv.config();

export const JWT_SECRET_MIN_LENGTH = 32;

// Phase 22: one password policy, used everywhere a password is ever set -
// registration, reset (auth.routes.ts), and admin provisioning
// (backend/scripts/create-admin.ts, via userService.createAdmin). Kept
// here rather than duplicated in each place, same reasoning as
// JWT_SECRET_MIN_LENGTH above. Deliberately length-only, no complexity
// rules (uppercase/lowercase/number/symbol) - those are a well-documented
// usability tax that pushes users toward predictable substitutions
// ("Password1!") without meaningfully raising real-world entropy; length
// is what actually matters. PASSWORD_MAX_LENGTH is not an arbitrary
// number - it's bcrypt's own real limit: bcrypt only ever hashes the
// first 72 bytes of its input and silently ignores the rest, so an
// unbounded password field would let someone "set" a 500-character
// password that provides no more real protection than its first 72
// characters, and would let a client send an arbitrarily large string
// into bcrypt.hash() for no benefit.
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 72;

// Values that have appeared as literal JWT_SECRET placeholders somewhere in
// this repo's own history (previous fallback default, docker-compose.yml,
// README examples, the committed backend/.env template).
// A developer copy-pasting any of these into a real .env must not end up
// with a working-but-guessable signing key.
export const KNOWN_PLACEHOLDER_JWT_SECRETS = new Set([
  'fallback-secret-change-me',
  'your-super-secret-jwt-key-change-in-production',
  'your-secret-key',
  'your-secret',
  'development_secret_key',
  'replace-this-with-your-own-randomly-generated-secret',
  'change-me',
  'secret',
]);

// Pure and side-effect free so it can be unit tested directly, without
// risking a real process.exit() inside a test run - see
// src/test/auth-security.test.ts.
export function assertValidJwtSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.trim().length === 0) {
    throw new Error('JWT_SECRET is not set.');
  }

  if (KNOWN_PLACEHOLDER_JWT_SECRETS.has(secret)) {
    throw new Error('JWT_SECRET is set to a known placeholder value.');
  }

  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(`JWT_SECRET is too short (must be at least ${JWT_SECRET_MIN_LENGTH} characters).`);
  }
}

// Phase 19: Express's `trust proxy` setting controls where req.ip (and
// therefore express-rate-limit's default rate-limit bucket) comes from. Left
// at Express's own default (false), X-Forwarded-For is ignored entirely and
// req.ip is the direct TCP peer - correct when there is no reverse proxy in
// front of this process, and safe against IP spoofing via a forged header,
// but wrong (collapses every real client behind the proxy into one bucket)
// once a real reverse proxy/load balancer sits in front. There is no single
// correct value for every deployment, so this is configurable via
// TRUST_PROXY rather than hardcoded - see backend/.env.example for the
// values this accepts and what they mean.
//
// Pure and side-effect free (same reasoning as assertValidJwtSecret below)
// so every branch can be unit tested directly.
export function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (raw === undefined || raw.trim() === '') {
    // Safe default: no proxy is trusted, so a client cannot spoof its own
    // X-Forwarded-For and be believed. Correct for local dev, for tests,
    // and for any deployment with no reverse proxy in front of the app.
    return false;
  }

  const trimmed = raw.trim();

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  if (/^\d+$/.test(trimmed)) {
    // A hop count: trust exactly this many proxies closest to the app,
    // reading X-Forwarded-For right-to-left past that many hops. This is
    // the right value for the common single-reverse-proxy topology (one
    // nginx/ALB/Cloudflare hop terminating in front of the Node process):
    // TRUST_PROXY=1.
    return parseInt(trimmed, 10);
  }

  // Anything else is passed through as-is: Express (via the `proxy-addr`
  // package) accepts a comma-separated list of specific IPs, CIDR ranges,
  // or its own keywords (loopback/linklocal/uniquelocal) here, so an
  // operator who knows their proxy's exact address(es) can trust those
  // specifically instead of an arbitrary hop count.
  return trimmed;
}

// Phase 20: computed once, before the CORS check below (which needs to
// know whether it's running in production), and reused in the final
// config object rather than reading process.env.NODE_ENV a second time.
const nodeEnv = process.env.NODE_ENV || 'development';

let jwtSecret!: string;

try {
  assertValidJwtSecret(process.env.JWT_SECRET);
  jwtSecret = process.env.JWT_SECRET;
} catch (error) {
  const message = error instanceof Error ? error.message : 'Invalid JWT_SECRET.';
  // Deliberately never logs the actual value, valid or not.
  console.error(`FATAL: ${message}`);
  console.error('Refusing to start with an unsafe or missing JWT signing key.');
  console.error('Set a unique, random JWT_SECRET - see backend/.env.example.');
  process.exit(1);
}

// Phase 20: mirrors assertValidJwtSecret above - DATABASE_URL previously
// had no equivalent check, so a missing/blank value only surfaced later as
// a raw Prisma connection error on the first query, rather than a clear
// boot-time failure. Pure and side-effect free so it can be unit tested
// directly (same reasoning as assertValidJwtSecret) - and deliberately
// does NOT attempt a real database connection here; that's Prisma's job at
// query time, not config validation's job at startup. This only checks the
// value is present and has the shape of a Postgres connection string.
export function assertValidDatabaseUrl(url: string | undefined): asserts url is string {
  if (!url || url.trim().length === 0) {
    throw new Error('DATABASE_URL is not set.');
  }

  if (!/^postgres(ql)?:\/\/\S+$/.test(url.trim())) {
    throw new Error(
      'DATABASE_URL does not look like a valid PostgreSQL connection string ' +
        '(expected it to start with postgresql:// or postgres://).'
    );
  }
}

let databaseUrl!: string;

try {
  assertValidDatabaseUrl(process.env.DATABASE_URL);
  databaseUrl = process.env.DATABASE_URL;
} catch (error) {
  const message = error instanceof Error ? error.message : 'Invalid DATABASE_URL.';
  // Deliberately never logs the actual value - it may contain a real
  // database username/password even when malformed.
  console.error(`FATAL: ${message}`);
  console.error('Refusing to start without a usable database connection string.');
  console.error('Set DATABASE_URL - see backend/.env.example.');
  process.exit(1);
}

// Phase 20: previously fell back to http://localhost:8080 unconditionally
// whenever FRONTEND_URL was unset - convenient for local dev, but meant a
// production deployment that forgot to set FRONTEND_URL would silently
// accept CORS requests as if it were someone's laptop, rather than failing
// closed. Now: missing FRONTEND_URL is still a safe, quiet default outside
// production (local dev/tests keep working exactly as before), but is a
// hard startup failure when nodeEnv is 'production' - there is no
// permissive fallback in that branch. Pure and side-effect free (same
// reasoning as the two checks above) so both branches are directly
// testable.
export function resolveCorsOrigin(env: string, frontendUrl: string | undefined): string {
  const trimmed = frontendUrl?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (env === 'production') {
    throw new Error('FRONTEND_URL is not set.');
  }

  return 'http://localhost:8080';
}

// Phase 24: session-lifetime hardening. Previously defaulted to '7d'.
// Every revocation-relevant event (password reset, suspension, rejection)
// already invalidates a token immediately, on its very next request - see
// isStaleAfterPasswordReset() and the isActive/isApproved re-check in
// middleware/auth.ts - so a long expiry does not leave any of *those*
// risks outstanding. The one risk a long expiry does leave outstanding is
// a stolen bearer token (e.g. via XSS) simply remaining usable, unchanged,
// for its full remaining lifetime, since there is no server-side session
// to revoke it from early. 24h meaningfully shrinks that replay window
// (from up to a week down to at most a day) while still matching this
// app's real usage pattern - donors/NGOs/volunteers coordinate pickups
// against food that has its own hour-scale expiry windows, so daily
// re-engagement (and therefore a daily re-login) is already the expected
// cadence, not an imposed inconvenience. Deliberately not shortened
// further than that: there is no refresh-token mechanism (see the Phase
// 23 audit for why one isn't warranted here), so every unit shaved off
// this value is paid for directly in how often a legitimate user must
// re-enter their password. Pure and side-effect free (same reasoning as
// resolveCorsOrigin/parseTrustProxy above) so it's directly unit
// testable.
export function resolveJwtExpiresIn(raw: string | undefined): SignOptions['expiresIn'] {
  const trimmed = raw?.trim();
  return (trimmed ? trimmed : '24h') as SignOptions['expiresIn'];
}

let corsOrigin!: string;

try {
  corsOrigin = resolveCorsOrigin(nodeEnv, process.env.FRONTEND_URL);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Invalid FRONTEND_URL.';
  console.error(`FATAL: ${message}`);
  console.error(
    'Refusing to start in production with no configured frontend origin - this would either ' +
      'reject all real CORS requests or (worse) silently behave like a local dev default.'
  );
  console.error('Set FRONTEND_URL to your real deployed frontend origin - see backend/.env.example.');
  process.exit(1);
}

// Phase 25: production email delivery for password recovery. This
// codebase has exactly one integration boundary for it -
// emailService.sendPasswordResetEmail() (see email.service.ts) - and this
// config section decides, once, at startup, whether that boundary has a
// real provider behind it or not. EMAIL_PROVIDER is an explicit opt-in,
// deliberately not inferred from whether SMTP_HOST happens to be set: an
// operator who hasn't decided to enable password-recovery email yet may
// still have stray/partial SMTP_* values lying around in their
// environment, and inferring intent from that would be exactly the kind
// of "silently pretend it's configured" behavior this phase must not
// introduce. Setting EMAIL_PROVIDER=smtp is the one, unambiguous signal
// that production email delivery is intended to be enabled - and once
// that signal is given, every required SMTP_* variable must actually be
// present, in any environment (not just production), or startup fails
// the same way assertValidJwtSecret()/assertValidDatabaseUrl() already
// do. Leaving EMAIL_PROVIDER unset (the default, 'none') is always safe
// and never blocks startup - see decideResetEmailMode() in
// email.service.ts for what happens at request time in that case
// (PRODUCTION_NO_PROVIDER / DEV_LINK_SUPPRESSED / DEV_LINK_LOGGED,
// unchanged from Phase 19).
export type EmailProviderKind = 'smtp' | 'none';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export interface EmailConfig {
  provider: EmailProviderKind;
  smtp?: SmtpConfig;
}

// Pure and side-effect free (same reasoning as assertValidJwtSecret/
// assertValidDatabaseUrl above) so every branch is directly unit
// testable without forking a process with different real env vars.
export function resolveEmailConfig(env: Record<string, string | undefined>): EmailConfig {
  const providerRaw = (env.EMAIL_PROVIDER ?? 'none').trim().toLowerCase();

  if (providerRaw === '' || providerRaw === 'none') {
    return { provider: 'none' };
  }

  if (providerRaw !== 'smtp') {
    throw new Error(`EMAIL_PROVIDER must be "smtp" or "none" (got "${env.EMAIL_PROVIDER}").`);
  }

  const host = env.SMTP_HOST?.trim();
  const portRaw = env.SMTP_PORT?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD;
  const from = env.SMTP_FROM?.trim();

  const missing: string[] = [];
  if (!host) missing.push('SMTP_HOST');
  if (!portRaw) missing.push('SMTP_PORT');
  if (!user) missing.push('SMTP_USER');
  if (!password) missing.push('SMTP_PASSWORD');
  if (!from) missing.push('SMTP_FROM');

  if (missing.length > 0) {
    // Deliberately lists only variable NAMES, never any value that was
    // (or wasn't) provided - same discipline as every other startup
    // validator in this file.
    throw new Error(`EMAIL_PROVIDER=smtp requires ${missing.join(', ')} to be set.`);
  }

  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid port number (1-65535).');
  }

  const secureRaw = env.SMTP_SECURE?.trim().toLowerCase();
  // No explicit override: infer from the well-known convention (465 is
  // always implicit TLS; 587/25 use STARTTLS, i.e. secure: false at the
  // initial connection) rather than guessing wrong for every other port.
  const secure = secureRaw === undefined || secureRaw === '' ? port === 465 : secureRaw === 'true';

  return {
    provider: 'smtp',
    smtp: { host: host!, port, secure, user: user!, password: password!, from: from! },
  };
}

let emailConfig!: EmailConfig;

try {
  emailConfig = resolveEmailConfig(process.env);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Invalid email configuration.';
  // Deliberately never logs any SMTP_* value - only ever the names of
  // whichever ones are missing/invalid (see resolveEmailConfig above).
  console.error(`FATAL: ${message}`);
  console.error(
    'Refusing to start with EMAIL_PROVIDER=smtp but incomplete SMTP configuration - this would either ' +
      'crash on the first password-reset request or, worse, silently fail to deliver it.'
  );
  console.error(
    'Set every required SMTP_* variable, or set EMAIL_PROVIDER=none (or leave it unset) to keep password-recovery ' +
      'email disabled - see backend/.env.example.'
  );
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv,

  // See parseTrustProxy() above for the accepted values and the safety
  // reasoning. Applied via app.set('trust proxy', ...) in app.ts.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  jwt: {
    secret: jwtSecret,
    expiresIn: resolveJwtExpiresIn(process.env.JWT_EXPIRES_IN),
  },

  database: {
    url: databaseUrl,
  },

  cors: {
    origin: corsOrigin,
  },

  // Phase 13: kept separate from jwt.expiresIn - a reset credential is a
  // one-time bearer secret for a single sensitive action, not a session,
  // so it gets its own short window rather than reusing session config.
  passwordReset: {
    tokenExpiryMinutes: parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES || '30', 10),
  },

  // Phase 19: explicit, narrow opt-in for emailService's local-development
  // stand-in (see email.service.ts) - deliberately NOT inferred from
  // nodeEnv alone. Defaults to false: an unset or misconfigured NODE_ENV
  // must never be the only thing standing between a raw password-reset
  // token and the server's console. Production always overrides this flag
  // regardless of its value - see decideResetEmailMode() in
  // email.service.ts.
  devExposeResetLinks: process.env.DEV_EXPOSE_RESET_LINKS === 'true',

  // Phase 25: see resolveEmailConfig() above for the validation this
  // already passed through - by the time this object exists, `email` is
  // either { provider: 'none' } or a fully-populated, validated SMTP
  // config, never a partially-configured one.
  email: emailConfig,

  // Phase 21: high-impact authenticated mutation limits - see
  // middleware/rateLimit.ts for how these are applied and keyed. All are a
  // 15-minute window; only the request count per window is configurable
  // here (env-overridable, same as passwordReset.tokenExpiryMinutes
  // above), so an operator can tune them without a code change if a real
  // deployment's legitimate usage pattern turns out to need it. Defaults
  // are deliberately generous - sized well above any normal single user's
  // real session, not tuned to the smallest number that "still works".
  rateLimits: {
    donationMutationsPerWindow: parseInt(process.env.RATE_LIMIT_DONATION_MUTATIONS || '30', 10),
    pickupMutationsPerWindow: parseInt(process.env.RATE_LIMIT_PICKUP_MUTATIONS || '30', 10),
    adminActionsPerWindow: parseInt(process.env.RATE_LIMIT_ADMIN_ACTIONS || '60', 10),
    profileUpdatesPerWindow: parseInt(process.env.RATE_LIMIT_PROFILE_UPDATES || '20', 10),
  },
};
