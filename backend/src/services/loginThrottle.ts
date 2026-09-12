// Phase 24: a per-account (not per-IP) progressive delay against
// credential-stuffing attempts that spread across many source IPs to
// evade the IP-keyed loginLimiter (middleware/rateLimit.ts). Deliberately
// NOT a hard block/lockout: a design that flatly refuses further attempts
// once a threshold is hit can be pointed at a victim's own email address
// by an attacker who has no intention of ever guessing correctly, denying
// the real account holder service for the rest of the window. Rejecting
// that shape of design is explicit in the Phase 24 brief.
//
// Instead, once failures for a given login identifier exceed a free
// budget, every subsequent attempt against that identifier - including
// the legitimate, correctly-credentialed one - is delayed by a small,
// capped amount before authService.login even looks the account up. That
// throttles an attacker's achievable guess rate without ever refusing a
// real login; the real user simply waits up to LOGIN_THROTTLE_MAX_DELAY_MS
// longer than usual while an attack against their account is in progress.
//
// Keyed purely on the submitted email string (normalizeLoginKey), never on
// whether that email actually has an account - so the delay a caller
// observes depends only on that string's own recent attempt history, not
// on any DB lookup result. This preserves the existing enumeration-safety
// property (see authService.login's own comments): timing reveals nothing
// an attacker doesn't already control.
//
// In-memory, single-process - the same scope limitation every other rate
// limiter in this codebase already has (see README's "Rate limiting"
// section). A horizontally-scaled deployment would need a shared store for
// this to see attempts across instances; not needed for the current
// single-instance deployment model.

interface ThrottleState {
  failureCount: number;
  windowStart: number;
}

const attempts = new Map<string, ThrottleState>();

export const LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1000;

// Matches loginLimiter's own per-IP budget (middleware/rateLimit.ts): a
// single source can already rack up this many failures before the IP
// limiter itself steps in and blocks it outright. So this only ever starts
// adding delay once an account's *total* failures - across however many
// source IPs - exceed what one IP alone could have produced, i.e. once the
// pattern actually looks distributed rather than a single person mistyping
// their password.
export const LOGIN_THROTTLE_FREE_ATTEMPTS = 10;
export const LOGIN_THROTTLE_DELAY_STEP_MS = 300;
export const LOGIN_THROTTLE_MAX_DELAY_MS = 2000;

function normalizeLoginKey(email: string): string {
  return email.trim().toLowerCase();
}

// Opportunistic expiry: a key is treated (and, if read, deleted) as absent
// once its window has elapsed, rather than running a background sweep.
function currentState(key: string): ThrottleState | undefined {
  const state = attempts.get(key);
  if (!state) {
    return undefined;
  }
  if (Date.now() - state.windowStart > LOGIN_THROTTLE_WINDOW_MS) {
    attempts.delete(key);
    return undefined;
  }
  return state;
}

export function getLoginThrottleDelayMs(email: string): number {
  const state = currentState(normalizeLoginKey(email));
  if (!state) {
    return 0;
  }
  const excess = Math.max(0, state.failureCount - LOGIN_THROTTLE_FREE_ATTEMPTS);
  return Math.min(excess * LOGIN_THROTTLE_DELAY_STEP_MS, LOGIN_THROTTLE_MAX_DELAY_MS);
}

export function recordLoginFailure(email: string): void {
  const key = normalizeLoginKey(email);
  const state = currentState(key);
  if (!state) {
    attempts.set(key, { failureCount: 1, windowStart: Date.now() });
  } else {
    state.failureCount += 1;
  }
}

// A successful login is exactly the signal that this identifier is not
// currently under attack (or that the real owner has regained control) -
// clearing it means the next mistaken attempt starts back at a clean
// slate rather than inheriting an unrelated prior attacker's count.
export function clearLoginThrottle(email: string): void {
  attempts.delete(normalizeLoginKey(email));
}

// Test-only escape hatch: gives a test file a clean slate rather than
// sharing state accumulated by earlier tests in the same process/module
// graph (vitest does not reset module-level state between tests in the
// same file).
export function _resetLoginThrottleForTests(): void {
  attempts.clear();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
