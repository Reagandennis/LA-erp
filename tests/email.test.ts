import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  EmailError,
  escapeEmailHtml,
  getEmailConfigStatus,
  isEmailConfigured,
  renderEmailLayout,
  sendEmail,
} from '../lib/email';

const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'EMAIL_REPLY_TO'];

describe('email config', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of SMTP_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of SMTP_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('reports not configured when SMTP env is blank', () => {
    expect(isEmailConfigured()).toBe(false);
    expect(getEmailConfigStatus().configured).toBe(false);
  });

  it('reports configured and derives TLS/secure from the port', () => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'noreply@example.com';
    process.env.SMTP_PASS = 'app-password';
    process.env.EMAIL_FROM = 'Acme <noreply@example.com>';

    expect(isEmailConfigured()).toBe(true);
    const status = getEmailConfigStatus();
    expect(status).toMatchObject({
      configured: true,
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // 465 => implicit TLS
      from: 'Acme <noreply@example.com>',
    });
  });

  it('defaults the from address to the SMTP user when EMAIL_FROM is unset', () => {
    process.env.SMTP_HOST = 'smtp-relay.gmail.com';
    process.env.SMTP_USER = 'relay@example.com';
    process.env.SMTP_PASS = 'x';
    expect(getEmailConfigStatus().from).toBe('relay@example.com');
    // port 587 default => STARTTLS, not implicit TLS
    expect(getEmailConfigStatus().secure).toBe(false);
  });

  it('throws EmailError (not a crash) when sending while unconfigured', async () => {
    await expect(sendEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>' })).rejects.toBeInstanceOf(EmailError);
  });
});

describe('email rendering', () => {
  it('escapes untrusted values', () => {
    expect(escapeEmailHtml('<script>&"')).toBe('&lt;script&gt;&amp;&quot;');
  });

  it('escapes the organization name and title in the layout', () => {
    const html = renderEmailLayout({
      title: 'Invoice <1>',
      bodyHtml: '<p>trusted</p>',
      organizationName: 'Acme <Co> & Sons',
    });
    expect(html).toContain('Acme &lt;Co&gt; &amp; Sons');
    expect(html).toContain('Invoice &lt;1&gt;');
    expect(html).toContain('<p>trusted</p>'); // body html passes through untouched
  });

  it('renders a CTA button when provided', () => {
    const html = renderEmailLayout({
      title: 'Welcome',
      bodyHtml: '<p>hi</p>',
      organizationName: 'Acme',
      cta: { label: 'Sign in', url: 'https://example.com/auth/login' },
    });
    expect(html).toContain('https://example.com/auth/login');
    expect(html).toContain('Sign in');
  });
});
