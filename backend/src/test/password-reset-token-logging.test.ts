import { describe, it, expect, vi, afterEach } from 'vitest';
import { decideResetEmailMode } from '../services/email.service.js';

// Phase 19: Phase 17 found that whether a raw password-reset token/URL
// gets logged used to depend entirely on NODE_ENV !== 'production' - so an
// unset or misconfigured NODE_ENV (exactly what docker-compose.yml's
// backend service had) silently logged real users' reset tokens to the
// server's console. The fix inverts that: logging the link now requires an
// explicit DEV_EXPOSE_RESET_LINKS=true opt-in, and production overrides
// that opt-in unconditionally - there is no input combination that logs a
// token when nodeEnv is 'production'.
//
// decideResetEmailMode() is pure and exported specifically so every branch
// - including the production one - is directly testable without forking a
// process with a different real NODE_ENV (same pattern as
// assertValidJwtSecret() in config/index.ts).

describe('decideResetEmailMode (Phase 19)', () => {
  it('production always returns PRODUCTION_NO_PROVIDER, regardless of the dev flag', () => {
    expect(decideResetEmailMode('production', false, 'none')).toBe('PRODUCTION_NO_PROVIDER');
    expect(decideResetEmailMode('production', true, 'none')).toBe('PRODUCTION_NO_PROVIDER');
  });

  it('development without the explicit flag suppresses the link (new safe default)', () => {
    expect(decideResetEmailMode('development', false, 'none')).toBe('DEV_LINK_SUPPRESSED');
  });

  it('development with the explicit flag logs the link', () => {
    expect(decideResetEmailMode('development', true, 'none')).toBe('DEV_LINK_LOGGED');
  });

  it('an arbitrary/misconfigured NODE_ENV value (not "production") is treated as non-production, not as production', () => {
    // This is the exact failure mode Phase 17 found: docker-compose.yml's
    // backend service had NODE_ENV: development, not an empty/misspelled
    // value, but the principle generalizes - only the literal string
    // 'production' ever suppresses via the production branch. Anything
    // else falls through to the explicit-flag branch below it, which
    // defaults to suppressed unless the flag is deliberately set.
    expect(decideResetEmailMode('staging', false, 'none')).toBe('DEV_LINK_SUPPRESSED');
    expect(decideResetEmailMode('', false, 'none')).toBe('DEV_LINK_SUPPRESSED');
  });

  it('Phase 25: EMAIL_PROVIDER=smtp takes priority over production/dev entirely', () => {
    expect(decideResetEmailMode('production', false, 'smtp')).toBe('SMTP_PROVIDER');
    expect(decideResetEmailMode('development', false, 'smtp')).toBe('SMTP_PROVIDER');
    expect(decideResetEmailMode('development', true, 'smtp')).toBe('SMTP_PROVIDER');
  });
});

// Integration-level: exercises the real config/index.ts + email.service.ts
// modules end to end for each NODE_ENV, via real environment variables and
// a fresh module import - not a mock standing in for them. Only NODE_ENV,
// DEV_EXPOSE_RESET_LINKS and (for the production case) FRONTEND_URL are
// stubbed; JWT_SECRET/DATABASE_URL are left exactly as src/test/setup.ts
// already established them (a fresh config/index.ts import re-validates
// JWT_SECRET and calls process.exit(1) on failure - touching only the vars
// this test cares about avoids tripping that). FRONTEND_URL must be stubbed
// too when simulating production: Phase 20 made a missing FRONTEND_URL a
// hard startup failure (process.exit(1), unmocked here) once nodeEnv is
// 'production', and CI never sets FRONTEND_URL for the backend job.
describe('emailService.sendPasswordResetEmail end-to-end logging behavior (Phase 19)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadEmailServiceWith(nodeEnv: string, devExposeResetLinks: string) {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('DEV_EXPOSE_RESET_LINKS', devExposeResetLinks);
    if (nodeEnv === 'production') {
      vi.stubEnv('FRONTEND_URL', 'https://app.example.com');
    }
    vi.resetModules();
    return import('../services/email.service.js');
  }

  it('production: never logs the raw token or reset URL, even with DEV_EXPOSE_RESET_LINKS mistakenly set to true', async () => {
    const { emailService } = await loadEmailServiceWith('production', 'true');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const rawToken = 'a'.repeat(64);
    await emailService.sendPasswordResetEmail({
      to: 'victim@example.com',
      resetUrl: `http://localhost:8080/reset-password?token=${rawToken}`,
      expiresInMinutes: 30,
    });

    const everythingLogged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(everythingLogged).not.toContain(rawToken);
    expect(everythingLogged).not.toContain('reset-password?token=');
    // Still communicates the operational state clearly server-side.
    expect(errorSpy).toHaveBeenCalledOnce();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('development without the flag: does not log the raw token or reset URL either', async () => {
    const { emailService } = await loadEmailServiceWith('development', 'false');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const rawToken = 'b'.repeat(64);
    await emailService.sendPasswordResetEmail({
      to: 'dev@example.com',
      resetUrl: `http://localhost:8080/reset-password?token=${rawToken}`,
      expiresInMinutes: 30,
    });

    const everythingLogged = logSpy.mock.calls.flat().join(' ');
    expect(everythingLogged).not.toContain(rawToken);

    logSpy.mockRestore();
  });

  it('development with DEV_EXPOSE_RESET_LINKS=true: logs the reset link, for local testing only', async () => {
    const { emailService } = await loadEmailServiceWith('development', 'true');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const rawToken = 'c'.repeat(64);
    await emailService.sendPasswordResetEmail({
      to: 'dev@example.com',
      resetUrl: `http://localhost:8080/reset-password?token=${rawToken}`,
      expiresInMinutes: 30,
    });

    const everythingLogged = logSpy.mock.calls.flat().join(' ');
    expect(everythingLogged).toContain(rawToken);

    logSpy.mockRestore();
  });
});
