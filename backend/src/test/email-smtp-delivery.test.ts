import { describe, it, expect, vi, afterEach } from 'vitest';

// Phase 25: the SMTP provider integration in email.service.ts
// (SMTP_PROVIDER mode). nodemailer is mocked at the module level for this
// entire file - these tests must never depend on, or attempt to reach, a
// real SMTP server or external network. Each test stubs the required env
// vars, resets the module graph, and does a fresh dynamic import of
// email.service.ts so config/index.ts's startup validation re-runs
// against exactly the env this test set up - same pattern as
// password-reset-token-logging.test.ts's loadEmailServiceWith(). Only
// EMAIL_PROVIDER/SMTP_* are stubbed; JWT_SECRET/DATABASE_URL/FRONTEND_URL
// are left exactly as src/test/setup.ts already established them.

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

const SMTP_PASSWORD_FIXTURE = 'test-only-smtp-password-never-real';

async function loadEmailServiceWithSmtp(overrides: Record<string, string> = {}) {
  vi.stubEnv('EMAIL_PROVIDER', 'smtp');
  vi.stubEnv('SMTP_HOST', overrides.SMTP_HOST ?? 'smtp.example.com');
  vi.stubEnv('SMTP_PORT', overrides.SMTP_PORT ?? '587');
  vi.stubEnv('SMTP_USER', overrides.SMTP_USER ?? 'apikey');
  vi.stubEnv('SMTP_PASSWORD', overrides.SMTP_PASSWORD ?? SMTP_PASSWORD_FIXTURE);
  vi.stubEnv('SMTP_FROM', overrides.SMTP_FROM ?? 'FoodBridge <no-reply@example.com>');
  vi.resetModules();
  return import('../services/email.service.js');
}

describe('emailService SMTP delivery (Phase 25)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    sendMailMock.mockReset();
    createTransportMock.mockClear();
  });

  it('sends through the configured provider, to exactly the given recipient', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'fake-id' });
    const { emailService } = await loadEmailServiceWithSmtp();

    await emailService.sendPasswordResetEmail({
      to: 'recipient@example.com',
      resetUrl: 'https://foodbridge.example.com/reset-password?token=abc123',
      expiresInMinutes: 30,
    });

    expect(sendMailMock).toHaveBeenCalledOnce();
    const sentMessage = sendMailMock.mock.calls[0][0];
    expect(sentMessage.to).toBe('recipient@example.com');
    expect(sentMessage.from).toBe('FoodBridge <no-reply@example.com>');
  });

  it('the email content includes the reset link, expiry, and FoodBridge branding, with no password/sensitive data', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'fake-id' });
    const { emailService } = await loadEmailServiceWithSmtp();

    await emailService.sendPasswordResetEmail({
      to: 'recipient@example.com',
      resetUrl: 'https://foodbridge.example.com/reset-password?token=abc123',
      expiresInMinutes: 30,
    });

    const sentMessage = sendMailMock.mock.calls[0][0];
    expect(sentMessage.subject).toContain('FoodBridge');
    expect(sentMessage.text).toContain('https://foodbridge.example.com/reset-password?token=abc123');
    expect(sentMessage.text).toContain('30');
    expect(sentMessage.text.toLowerCase()).toContain("didn't request");
    expect(sentMessage.html).toContain('https://foodbridge.example.com/reset-password?token=abc123');
    expect(sentMessage.html).toContain('FoodBridge');

    const combined = `${sentMessage.subject} ${sentMessage.text} ${sentMessage.html}`.toLowerCase();
    expect(combined).not.toContain('password:');
    expect(combined).not.toContain(SMTP_PASSWORD_FIXTURE.toLowerCase());
  });

  it('the transporter is constructed from config, never with credentials logged', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'fake-id' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { emailService } = await loadEmailServiceWithSmtp();
    await emailService.sendPasswordResetEmail({
      to: 'recipient@example.com',
      resetUrl: 'https://foodbridge.example.com/reset-password?token=xyz789',
      expiresInMinutes: 30,
    });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        auth: { user: 'apikey', pass: SMTP_PASSWORD_FIXTURE },
      })
    );

    const everythingLogged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(everythingLogged).not.toContain(SMTP_PASSWORD_FIXTURE);
    expect(everythingLogged).not.toContain('xyz789');

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('a provider failure (rejected credentials, timeout, or 5xx) is caught, logged safely, and re-thrown generically', async () => {
    const providerErrors = [
      new Error('535 5.7.8 Authentication credentials invalid'),
      new Error('Connection timeout'),
      new Error('450 4.3.0 Temporary server failure'),
    ];

    for (const providerError of providerErrors) {
      sendMailMock.mockReset().mockRejectedValueOnce(providerError);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { emailService } = await loadEmailServiceWithSmtp();

      await expect(
        emailService.sendPasswordResetEmail({
          to: 'recipient@example.com',
          resetUrl: 'https://foodbridge.example.com/reset-password?token=shouldnotleak',
          expiresInMinutes: 30,
        })
      ).rejects.toThrow('Failed to send password reset email.');

      const everythingLogged = errorSpy.mock.calls.flat().join(' ');
      // The failure is logged for operability, but never the token/URL or
      // the SMTP credential.
      expect(everythingLogged).not.toContain('shouldnotleak');
      expect(everythingLogged).not.toContain(SMTP_PASSWORD_FIXTURE);
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
      vi.resetModules();
    }
  });

  it('a provider failure never surfaces its own raw error object/message to the caller - only a generic message', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('some internal SMTP library detail'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { emailService } = await loadEmailServiceWithSmtp();

    try {
      await emailService.sendPasswordResetEmail({
        to: 'recipient@example.com',
        resetUrl: 'https://foodbridge.example.com/reset-password?token=abc',
        expiresInMinutes: 30,
      });
      expect.fail('expected sendPasswordResetEmail to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Failed to send password reset email.');
      expect((error as Error).message).not.toContain('internal SMTP library detail');
    }

    errorSpy.mockRestore();
  });
});
