import nodemailer, { Transporter } from 'nodemailer';
import { config, EmailProviderKind } from '../config/index.js';

// Phase 13/19: the explicit email-delivery boundary. Every caller (just
// authService.requestPasswordReset) goes through sendPasswordResetEmail()
// and never touches a provider/transport directly - that's what keeps
// this provider-agnostic: swapping SMTP for a different transport, or
// adding a second kind of email later, means changing only this file.
//
// Phase 25: a real provider now exists behind this boundary (generic
// SMTP via nodemailer - see config/index.ts's resolveEmailConfig() for
// why SMTP specifically, and README.md's "Email Delivery" section for the
// full reasoning). The three no-provider/dev-log modes below are
// unchanged from Phase 19 and still apply whenever EMAIL_PROVIDER is not
// explicitly set to 'smtp'.
export interface PasswordResetEmailParams {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export type ResetEmailMode = 'SMTP_PROVIDER' | 'PRODUCTION_NO_PROVIDER' | 'DEV_LINK_LOGGED' | 'DEV_LINK_SUPPRESSED';

// Pure and side-effect free (same reasoning as assertValidJwtSecret() in
// config/index.ts) so every branch - including the production one - can
// be unit tested directly, without needing to fork a process with a
// different NODE_ENV.
//
// EMAIL_PROVIDER='smtp' takes priority over everything else, in every
// environment - a developer can point SMTP_* at a sandbox/test inbox
// (e.g. Ethereal, Mailtrap) to exercise the real send path locally
// without NODE_ENV=production. Absent that explicit opt-in, production
// ALWAYS returns PRODUCTION_NO_PROVIDER, unconditionally, regardless of
// devExposeResetLinks - there is no input combination that logs a raw
// reset token/URL when nodeEnv is 'production'.
export function decideResetEmailMode(
  nodeEnv: string,
  devExposeResetLinks: boolean,
  emailProvider: EmailProviderKind
): ResetEmailMode {
  if (emailProvider === 'smtp') {
    return 'SMTP_PROVIDER';
  }
  if (nodeEnv === 'production') {
    return 'PRODUCTION_NO_PROVIDER';
  }
  return devExposeResetLinks ? 'DEV_LINK_LOGGED' : 'DEV_LINK_SUPPRESSED';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Exported for testing (Step 8: reset link construction, no unsafe
// dynamic HTML). The only values interpolated into this template are
// resetUrl (built by authService.requestPasswordReset from
// config.cors.origin - operator-configured, never taken from a request
// body - plus a crypto.randomBytes() hex token, which cannot contain any
// HTML-meaningful character) and a numeric minute count. Both are
// HTML-escaped anyway as defense in depth. Deliberately contains no
// password, password hash, internal id, or other account detail - only
// what a recipient needs to complete or safely ignore the reset.
export function buildPasswordResetEmail(params: PasswordResetEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { resetUrl, expiresInMinutes } = params;
  const safeUrl = escapeHtml(resetUrl);

  const subject = 'Reset your FoodBridge password';

  const text = [
    'FoodBridge',
    '',
    'A password reset was requested for your FoodBridge account.',
    '',
    `Reset your password using this link (valid for ${expiresInMinutes} minutes):`,
    resetUrl,
    '',
    "If you didn't request this, you can safely ignore this email - your password has not been changed.",
  ].join('\n');

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;">
  <h2 style="margin-bottom:4px;">FoodBridge</h2>
  <p>A password reset was requested for your FoodBridge account.</p>
  <p>
    <a href="${safeUrl}" style="display:inline-block;padding:10px 20px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:4px;">
      Reset your password
    </a>
  </p>
  <p>Or copy and paste this link into your browser:<br><span style="word-break:break-all;">${safeUrl}</span></p>
  <p>This link is valid for ${expiresInMinutes} minutes.</p>
  <p>If you didn't request a password reset, you can safely ignore this email - your password has not been changed.</p>
</div>`;

  return { subject, text, html };
}

// Lazily created and memoized - never constructed at all unless/until a
// real send is attempted, so importing this module (e.g. in every test
// file that imports auth.service.ts) never touches the network or
// requires SMTP_* to be set when EMAIL_PROVIDER is 'none' (the default).
let cachedTransporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!cachedTransporter) {
    const smtp = config.email.smtp;
    if (!smtp) {
      // Unreachable in practice - decideResetEmailMode only returns
      // SMTP_PROVIDER when config.email.provider === 'smtp', which
      // resolveEmailConfig() guarantees comes with a populated `smtp`
      // object. Guarded anyway rather than asserted with `!`, so a future
      // refactor that breaks that invariant fails loudly instead of
      // sending to `undefined`.
      throw new Error('SMTP provider selected but no SMTP configuration is present.');
    }
    cachedTransporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.password },
    });
  }
  return cachedTransporter;
}

// Test-only escape hatch, mirroring loginThrottle.ts's
// _resetLoginThrottleForTests() - lets a test force a fresh transporter
// (e.g. after swapping env-derived config) without leaking state between
// test files that share this module's cache.
export function _resetEmailTransportForTests(): void {
  cachedTransporter = undefined;
}

async function sendViaSmtp(params: PasswordResetEmailParams): Promise<void> {
  const smtp = config.email.smtp;
  if (!smtp) {
    throw new Error('SMTP provider selected but no SMTP configuration is present.');
  }

  const { subject, text, html } = buildPasswordResetEmail(params);

  try {
    await getTransporter().sendMail({
      from: smtp.from,
      to: params.to,
      subject,
      text,
      html,
    });
  } catch (error) {
    // Logs the fact of failure and the provider's own error message
    // (typically an SMTP status/reason, e.g. auth failure or an
    // unreachable host) for operability - never params.resetUrl, the raw
    // token, or any SMTP_* credential. The SMTP account itself is a
    // trusted, operator-configured component, not attacker input, so its
    // error text is treated as safe to log at this level of detail.
    console.error(
      '[email] SMTP provider rejected or failed to send the password reset email:',
      error instanceof Error ? error.message : 'unknown error'
    );
    // Re-thrown as a new, generic error - never the raw provider
    // exception - so nothing provider-specific (connection details,
    // library internals) can propagate up to a caller or, eventually, an
    // HTTP response.
    throw new Error('Failed to send password reset email.');
  }
}

export const emailService = {
  async sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
    const mode = decideResetEmailMode(config.nodeEnv, config.devExposeResetLinks, config.email.provider);

    switch (mode) {
      case 'SMTP_PROVIDER':
        await sendViaSmtp(params);
        return;

      case 'PRODUCTION_NO_PROVIDER':
        // Deliberately does NOT pretend an email was sent, and does not
        // include the token or reset URL anywhere in this message.
        console.error(
          '[email] No email provider is configured - password reset email NOT sent. ' +
            'Set EMAIL_PROVIDER=smtp (with the required SMTP_* variables) to enable real delivery ' +
            '(see README.md "Email Delivery").'
        );
        return;

      case 'DEV_LINK_SUPPRESSED':
        // Same as production in substance (no token/URL logged) - this is
        // the default for any non-production environment that hasn't
        // explicitly opted in below, so an unset or misconfigured
        // NODE_ENV can never be the only thing gating this.
        console.log(
          `[email] Password reset requested for ${params.to} - link not logged. ` +
            'Set DEV_EXPOSE_RESET_LINKS=true in your local .env to see reset links here for local development.'
        );
        return;

      case 'DEV_LINK_LOGGED':
        // Explicit, narrow, local-development-only substitute for a real
        // inbox - only reaches the server operator's own console, and only
        // because DEV_EXPOSE_RESET_LINKS was deliberately set.
        console.log(`[email:dev-only] Password reset requested for ${params.to}`);
        console.log(
          `[email:dev-only] Reset link (valid ${params.expiresInMinutes} min, do not share): ${params.resetUrl}`
        );
        return;
    }
  },
};
