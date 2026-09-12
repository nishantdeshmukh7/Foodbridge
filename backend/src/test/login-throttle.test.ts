import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import prisma from '../models/prisma.js';
import { authService } from '../services/auth.service.js';
import {
  _resetLoginThrottleForTests,
  recordLoginFailure,
  LOGIN_THROTTLE_FREE_ATTEMPTS,
  LOGIN_THROTTLE_DELAY_STEP_MS,
  LOGIN_THROTTLE_MAX_DELAY_MS,
} from '../services/loginThrottle.js';

// Phase 24: per-account progressive login delay (loginThrottle.ts).
//
// Failure build-up uses recordLoginFailure() directly rather than actually
// calling authService.login() N times - the delay is applied on every
// throttled attempt, not just the last one, so driving the count up via N
// real logins would itself pay N increasingly large delays and make the
// test suite absurdly slow (and, past the point where a single delay hits
// LOGIN_THROTTLE_MAX_DELAY_MS, effectively hang). Using the same building
// block authService.login() itself calls to record a failure is exactly
// as faithful a setup, without that cost. Only the one call actually being
// measured in each test goes through the real authService.login().

const TEST_EMAIL_SUFFIX = '@test.foodbridge.local';

async function createUser(suffix: string) {
  const password = 'CorrectPass123';
  return {
    plaintextPassword: password,
    user: await prisma.user.create({
      data: {
        email: `throttle-${suffix}${TEST_EMAIL_SUFFIX}`,
        password: await bcrypt.hash(password, 4),
        name: `Throttle Test ${suffix}`,
        role: 'DONOR',
        isApproved: true,
        isActive: true,
      },
    }),
  };
}

async function timeLogin(email: string, password: string): Promise<{ ms: number; error?: string }> {
  const start = Date.now();
  try {
    await authService.login({ email, password });
    return { ms: Date.now() - start };
  } catch (error) {
    return { ms: Date.now() - start, error: error instanceof Error ? error.message : 'unknown' };
  }
}

describe('Phase 24: per-account login throttle', () => {
  beforeAll(async () => {
    // The @test.foodbridge.local suffix is shared across every test file in
    // this suite - other files' leftover Donations/PickupRequests (owned by
    // test-suffixed users) can still be present, so they must be cleared
    // first, FK-safe, before the users themselves are deleted (same pattern
    // as auth-security.test.ts/password-reset.test.ts/user-lifecycle.test.ts).
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

  beforeEach(() => {
    // Each test gets a clean slate rather than inheriting failure counts
    // from an earlier test in this same file/module graph.
    _resetLoginThrottleForTests();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a handful of mistaken attempts followed by the correct password incurs no added delay', async () => {
    const { user, plaintextPassword } = await createUser('legit1');

    for (let i = 0; i < 3; i++) {
      recordLoginFailure(user.email);
    }

    const correct = await timeLogin(user.email, plaintextPassword);
    expect(correct.error).toBeUndefined();
    // Well under the throttle's own smallest step - proves no delay was
    // applied while still under the free-attempt budget.
    expect(correct.ms).toBeLessThan(LOGIN_THROTTLE_DELAY_STEP_MS);
  });

  it('failures beyond the free-attempt budget delay the next attempt, without ever refusing a correct password', async () => {
    const { user, plaintextPassword } = await createUser('sustained1');

    // Exceed the free budget by 3 - this is the "distributed attack" shape:
    // from authService.login's point of view there is no IP concept at
    // all, so this is indistinguishable from 13 failures spread across 13
    // different source IPs.
    const excess = 3;
    for (let i = 0; i < LOGIN_THROTTLE_FREE_ATTEMPTS + excess; i++) {
      recordLoginFailure(user.email);
    }

    const expectedDelay = excess * LOGIN_THROTTLE_DELAY_STEP_MS;
    const correct = await timeLogin(user.email, plaintextPassword);

    // Never refused - the correct password still succeeds.
    expect(correct.error).toBeUndefined();
    // But it was measurably delayed, consistent with the excess above.
    expect(correct.ms).toBeGreaterThanOrEqual(expectedDelay - 50);
    expect(correct.ms).toBeLessThan(expectedDelay + 500);
  });

  it('a wrong password past the free budget is delayed but still rejected with the same generic message', async () => {
    const { user } = await createUser('wrongpast1');

    for (let i = 0; i < LOGIN_THROTTLE_FREE_ATTEMPTS + 2; i++) {
      recordLoginFailure(user.email);
    }

    const attempt = await timeLogin(user.email, 'still-wrong');
    expect(attempt.error).toBe('Invalid email or password');
    expect(attempt.ms).toBeGreaterThanOrEqual(2 * LOGIN_THROTTLE_DELAY_STEP_MS - 50);
  });

  it('the delay is capped and never grows unbounded', async () => {
    const { user } = await createUser('capped1');

    // Far beyond the free budget - if capping did not work, the delay
    // formula (excess * step) would otherwise demand tens of seconds here.
    for (let i = 0; i < LOGIN_THROTTLE_FREE_ATTEMPTS + 50; i++) {
      recordLoginFailure(user.email);
    }

    const nextAttempt = await timeLogin(user.email, 'still-wrong');
    expect(nextAttempt.ms).toBeLessThan(LOGIN_THROTTLE_MAX_DELAY_MS + 250);
    expect(nextAttempt.ms).toBeGreaterThanOrEqual(LOGIN_THROTTLE_MAX_DELAY_MS - 50);
  });

  it('a successful login clears the throttle - the next mistake afterward is fast again', async () => {
    const { user, plaintextPassword } = await createUser('reset1');

    for (let i = 0; i < LOGIN_THROTTLE_FREE_ATTEMPTS + 3; i++) {
      recordLoginFailure(user.email);
    }

    const correct = await timeLogin(user.email, plaintextPassword);
    expect(correct.error).toBeUndefined();

    const wrongAfterSuccess = await timeLogin(user.email, 'wrong-again');
    expect(wrongAfterSuccess.error).toBe('Invalid email or password');
    expect(wrongAfterSuccess.ms).toBeLessThan(LOGIN_THROTTLE_DELAY_STEP_MS);
  });

  it('a nonexistent email is throttled identically to a real one - no enumeration signal via timing', async () => {
    const nonexistentEmail = `throttle-nobody${TEST_EMAIL_SUFFIX}`;
    const excess = 2;

    for (let i = 0; i < LOGIN_THROTTLE_FREE_ATTEMPTS + excess; i++) {
      recordLoginFailure(nonexistentEmail);
    }

    const expectedDelay = excess * LOGIN_THROTTLE_DELAY_STEP_MS;
    const attempt = await timeLogin(nonexistentEmail, 'whatever456');
    expect(attempt.error).toBe('Invalid email or password');
    expect(attempt.ms).toBeGreaterThanOrEqual(expectedDelay - 50);
  });

  it('throttle state is keyed per-account: attacking one account does not delay a different, unrelated login', async () => {
    const { user: victim } = await createUser('victim1');
    const { user: bystander, plaintextPassword: bystanderPassword } = await createUser('bystander1');

    for (let i = 0; i < LOGIN_THROTTLE_FREE_ATTEMPTS + 5; i++) {
      recordLoginFailure(victim.email);
    }

    const bystanderLogin = await timeLogin(bystander.email, bystanderPassword);
    expect(bystanderLogin.error).toBeUndefined();
    expect(bystanderLogin.ms).toBeLessThan(LOGIN_THROTTLE_DELAY_STEP_MS);
  });

  it('email matching is case/whitespace-insensitive for throttle purposes (same account, differently cased)', async () => {
    const { user, plaintextPassword } = await createUser('case1');

    for (let i = 0; i < LOGIN_THROTTLE_FREE_ATTEMPTS + 3; i++) {
      recordLoginFailure(`  ${user.email.toUpperCase()}  `);
    }

    const correct = await timeLogin(user.email, plaintextPassword);
    expect(correct.error).toBeUndefined();
    expect(correct.ms).toBeGreaterThanOrEqual(3 * LOGIN_THROTTLE_DELAY_STEP_MS - 50);
  });

  it('an actual real end-to-end login through authService.login still records failures and applies delay (integration smoke test)', async () => {
    const { user, plaintextPassword } = await createUser('e2e1');

    // A small number of real wrong-password calls through the actual
    // service (not the recordLoginFailure() shortcut) - proving the
    // wiring in authService.login itself, not just the throttle module in
    // isolation. Kept small (well under the free budget) so this stays
    // fast regardless.
    for (let i = 0; i < 4; i++) {
      const wrong = await timeLogin(user.email, 'wrong-password');
      expect(wrong.error).toBe('Invalid email or password');
    }

    const correct = await timeLogin(user.email, plaintextPassword);
    expect(correct.error).toBeUndefined();
    expect(correct.ms).toBeLessThan(LOGIN_THROTTLE_DELAY_STEP_MS);
  });
});
