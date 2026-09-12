import { describe, it, expect } from 'vitest';
import { assertValidDatabaseUrl, resolveCorsOrigin, resolveJwtExpiresIn, resolveEmailConfig } from '../config/index.js';

// Phase 20: DATABASE_URL and FRONTEND_URL previously had no equivalent
// startup validation to JWT_SECRET's - a missing DATABASE_URL only
// surfaced as a raw Prisma error on the first query, and a missing
// FRONTEND_URL silently fell back to http://localhost:8080 even in
// production. Both functions below are pure and exported (same reasoning
// as assertValidJwtSecret) so every branch is directly testable without
// forking a process with different real env vars - see
// auth-security.test.ts for the existing precedent this follows.

describe('assertValidDatabaseUrl (Phase 20)', () => {
  it('rejects an undefined value', () => {
    expect(() => assertValidDatabaseUrl(undefined)).toThrow('DATABASE_URL is not set');
  });

  it('rejects an empty/whitespace-only value', () => {
    expect(() => assertValidDatabaseUrl('')).toThrow('DATABASE_URL is not set');
    expect(() => assertValidDatabaseUrl('   ')).toThrow('DATABASE_URL is not set');
  });

  it('rejects a value with no recognizable Postgres scheme', () => {
    expect(() => assertValidDatabaseUrl('mysql://user:pass@localhost:3306/db')).toThrow(
      'does not look like a valid PostgreSQL connection string'
    );
    expect(() => assertValidDatabaseUrl('not-a-url-at-all')).toThrow(
      'does not look like a valid PostgreSQL connection string'
    );
  });

  it('accepts a well-formed postgresql:// URL', () => {
    expect(() =>
      assertValidDatabaseUrl('postgresql://user:pass@localhost:5432/foodbridge?schema=public')
    ).not.toThrow();
  });

  it('accepts the shorter postgres:// scheme too', () => {
    expect(() => assertValidDatabaseUrl('postgres://user:pass@localhost:5432/foodbridge')).not.toThrow();
  });

  it('never includes the input value itself in the thrown error message (credentials safety)', () => {
    const sensitiveUrl = 'mysql://admin:SuperSecretPassword123@prod-db.internal:3306/foodbridge';
    try {
      assertValidDatabaseUrl(sensitiveUrl);
      expect.fail('expected assertValidDatabaseUrl to throw');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('SuperSecretPassword123');
      expect(message).not.toContain(sensitiveUrl);
    }
  });
});

describe('resolveCorsOrigin (Phase 20)', () => {
  it('development: falls back to the local dev default when FRONTEND_URL is unset', () => {
    expect(resolveCorsOrigin('development', undefined)).toBe('http://localhost:8080');
  });

  it('test: falls back to the local dev default too (test suites never set FRONTEND_URL)', () => {
    expect(resolveCorsOrigin('test', undefined)).toBe('http://localhost:8080');
  });

  it('development: an explicitly set FRONTEND_URL is used as-is', () => {
    expect(resolveCorsOrigin('development', 'http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('production: throws rather than falling back when FRONTEND_URL is unset', () => {
    expect(() => resolveCorsOrigin('production', undefined)).toThrow('FRONTEND_URL is not set');
  });

  it('production: throws for a blank/whitespace-only FRONTEND_URL too, not just undefined', () => {
    expect(() => resolveCorsOrigin('production', '')).toThrow('FRONTEND_URL is not set');
    expect(() => resolveCorsOrigin('production', '   ')).toThrow('FRONTEND_URL is not set');
  });

  it('production: an explicitly set FRONTEND_URL is used, no fallback involved', () => {
    expect(resolveCorsOrigin('production', 'https://foodbridge.example.com')).toBe(
      'https://foodbridge.example.com'
    );
  });
});

describe('resolveJwtExpiresIn (Phase 24)', () => {
  it('falls back to the 24h default when JWT_EXPIRES_IN is unset', () => {
    expect(resolveJwtExpiresIn(undefined)).toBe('24h');
  });

  it('falls back to the 24h default for a blank/whitespace-only value too', () => {
    expect(resolveJwtExpiresIn('')).toBe('24h');
    expect(resolveJwtExpiresIn('   ')).toBe('24h');
  });

  it('an explicitly set value is used as-is, no fallback involved', () => {
    expect(resolveJwtExpiresIn('7d')).toBe('7d');
    expect(resolveJwtExpiresIn('1h')).toBe('1h');
  });

  it('trims surrounding whitespace from an explicitly set value', () => {
    expect(resolveJwtExpiresIn('  12h  ')).toBe('12h');
  });
});

describe('resolveEmailConfig (Phase 25)', () => {
  it('defaults to provider "none" when EMAIL_PROVIDER is unset - never blocks startup', () => {
    expect(resolveEmailConfig({})).toEqual({ provider: 'none' });
  });

  it('an explicit "none" is equivalent to unset', () => {
    expect(resolveEmailConfig({ EMAIL_PROVIDER: 'none' })).toEqual({ provider: 'none' });
  });

  it('rejects an unrecognized EMAIL_PROVIDER value', () => {
    expect(() => resolveEmailConfig({ EMAIL_PROVIDER: 'sendgrid' })).toThrow(
      'EMAIL_PROVIDER must be "smtp" or "none"'
    );
  });

  it('EMAIL_PROVIDER=smtp with every required SMTP_* variable resolves cleanly', () => {
    const result = resolveEmailConfig({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'apikey',
      SMTP_PASSWORD: 'a-secret-value',
      SMTP_FROM: 'FoodBridge <no-reply@example.com>',
    });

    expect(result).toEqual({
      provider: 'smtp',
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'apikey',
        password: 'a-secret-value',
        from: 'FoodBridge <no-reply@example.com>',
      },
    });
  });

  it('infers secure:true for port 465 and secure:false for every other port when SMTP_SECURE is unset', () => {
    const base = {
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'apikey',
      SMTP_PASSWORD: 'a-secret-value',
      SMTP_FROM: 'FoodBridge <no-reply@example.com>',
    };

    expect(resolveEmailConfig({ ...base, SMTP_PORT: '465' }).smtp?.secure).toBe(true);
    expect(resolveEmailConfig({ ...base, SMTP_PORT: '587' }).smtp?.secure).toBe(false);
    expect(resolveEmailConfig({ ...base, SMTP_PORT: '25' }).smtp?.secure).toBe(false);
  });

  it('SMTP_SECURE explicitly overrides the port-based inference in either direction', () => {
    const base = {
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'apikey',
      SMTP_PASSWORD: 'a-secret-value',
      SMTP_FROM: 'FoodBridge <no-reply@example.com>',
    };

    expect(resolveEmailConfig({ ...base, SMTP_PORT: '587', SMTP_SECURE: 'true' }).smtp?.secure).toBe(true);
    expect(resolveEmailConfig({ ...base, SMTP_PORT: '465', SMTP_SECURE: 'false' }).smtp?.secure).toBe(false);
  });

  it('EMAIL_PROVIDER=smtp with a missing variable throws, naming exactly what is missing', () => {
    expect(() =>
      resolveEmailConfig({
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        // SMTP_USER, SMTP_PASSWORD, SMTP_FROM all missing
      })
    ).toThrow('SMTP_USER, SMTP_PASSWORD, SMTP_FROM');
  });

  it('never echoes any SMTP_* value into a thrown error message', () => {
    const secretValue = 'super-secret-smtp-password-do-not-leak';
    try {
      resolveEmailConfig({
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 'not-a-number',
        SMTP_USER: 'apikey',
        SMTP_PASSWORD: secretValue,
        SMTP_FROM: 'FoodBridge <no-reply@example.com>',
      });
      expect.fail('expected resolveEmailConfig to throw for an invalid port');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secretValue);
    }
  });

  it('rejects a non-numeric or out-of-range SMTP_PORT', () => {
    const base = {
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'apikey',
      SMTP_PASSWORD: 'a-secret-value',
      SMTP_FROM: 'FoodBridge <no-reply@example.com>',
    };

    expect(() => resolveEmailConfig({ ...base, SMTP_PORT: 'not-a-number' })).toThrow('SMTP_PORT must be');
    expect(() => resolveEmailConfig({ ...base, SMTP_PORT: '0' })).toThrow('SMTP_PORT must be');
    expect(() => resolveEmailConfig({ ...base, SMTP_PORT: '99999' })).toThrow('SMTP_PORT must be');
  });
});
