import 'server-only';

import nodemailer, { type Transporter } from 'nodemailer';

/** Thrown when an email cannot be sent. The message is safe to surface to admins. */
export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailError';
  }
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  replyTo: string | null;
}

function readConfig(): SmtpConfig | null {
  const host = (process.env.SMTP_HOST ?? '').trim();
  const user = (process.env.SMTP_USER ?? '').trim();
  const pass = process.env.SMTP_PASS ?? '';
  // From defaults to the authenticated mailbox when not explicitly set.
  const from = (process.env.EMAIL_FROM ?? '').trim() || user;

  if (!host || !user || !pass || !from) {
    return null;
  }

  const port = Number(process.env.SMTP_PORT ?? '587') || 587;
  // 465 is implicit TLS; 587/25 use STARTTLS. Allow an explicit override.
  const secureEnv = (process.env.SMTP_SECURE ?? '').trim().toLowerCase();
  const secure = secureEnv ? secureEnv === 'true' || secureEnv === '1' : port === 465;
  const replyTo = (process.env.EMAIL_REPLY_TO ?? '').trim() || null;

  return { host, port, secure, user, pass, from, replyTo };
}

export function isEmailConfigured(): boolean {
  return readConfig() !== null;
}

/** Non-secret snapshot of the email config, for display in the admin UI. */
export function getEmailConfigStatus(): {
  configured: boolean;
  host: string | null;
  port: number | null;
  secure: boolean | null;
  user: string | null;
  from: string | null;
  replyTo: string | null;
} {
  const config = readConfig();
  if (!config) {
    return {
      configured: false,
      host: (process.env.SMTP_HOST ?? '').trim() || null,
      port: null,
      secure: null,
      user: (process.env.SMTP_USER ?? '').trim() || null,
      from: (process.env.EMAIL_FROM ?? '').trim() || null,
      replyTo: (process.env.EMAIL_REPLY_TO ?? '').trim() || null,
    };
  }
  return {
    configured: true,
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    from: config.from,
    replyTo: config.replyTo,
  };
}

let cachedTransporter: Transporter | null = null;
let cachedKey = '';

function getTransporter(config: SmtpConfig): Transporter {
  // Re-create the transporter only when the underlying config changes.
  const key = `${config.host}:${config.port}:${config.secure}:${config.user}`;
  if (!cachedTransporter || cachedKey !== key) {
    cachedTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
    cachedKey = key;
  }
  return cachedTransporter;
}

/**
 * Sends an email via the configured SMTP transport (e.g. Google Workspace).
 * Throws {@link EmailError} if email is not configured or delivery fails.
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ messageId: string }> {
  const config = readConfig();
  if (!config) {
    throw new EmailError(
      'Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM.',
    );
  }

  const recipients = Array.isArray(options.to) ? options.to.filter(Boolean) : [options.to];
  if (recipients.length === 0) {
    throw new EmailError('No recipient address was provided.');
  }

  try {
    const info = await getTransporter(config).sendMail({
      from: config.from,
      to: recipients,
      cc: options.cc,
      bcc: options.bcc,
      replyTo: options.replyTo ?? config.replyTo ?? undefined,
      subject: options.subject,
      text: options.text ?? htmlToText(options.html),
      html: options.html,
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    return { messageId: info.messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    throw new EmailError(`Could not send email: ${reason}`);
  }
}

/** Verifies the SMTP connection/credentials without sending a message. */
export async function verifyEmailConnection(): Promise<void> {
  const config = readConfig();
  if (!config) {
    throw new EmailError('Email is not configured.');
  }
  try {
    await getTransporter(config).verify();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    throw new EmailError(`SMTP connection failed: ${reason}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Rough HTML→text fallback for the plain-text part of an email. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface EmailLayoutOptions {
  title: string;
  /** Pre-built, trusted HTML for the body (paragraphs, etc.). */
  bodyHtml: string;
  organizationName: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Brand accent colour; defaults to the platform blue. */
  accentColor?: string;
}

/** Wraps body HTML in a simple, on-brand, email-client-safe layout. */
export function renderEmailLayout(options: EmailLayoutOptions): string {
  const accent = options.accentColor || '#03458f';
  const org = escapeHtml(options.organizationName);
  const cta = options.cta
    ? `<tr><td style="padding:8px 0 4px;">
         <a href="${escapeHtml(options.cta.url)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">${escapeHtml(options.cta.label)}</a>
       </td></tr>`
    : '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr><td style="background:${accent};padding:20px 28px;">
            <span style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.2px;">${org}</span>
          </td></tr>
          <tr><td style="padding:28px;">
            <h1 style="margin:0 0 16px;font-size:18px;color:#111827;">${escapeHtml(options.title)}</h1>
            <div style="font-size:14px;line-height:1.6;color:#374151;">${options.bodyHtml}</div>
            <table role="presentation" cellpadding="0" cellspacing="0">${cta}</table>
          </td></tr>
          <tr><td style="padding:16px 28px;border-top:1px solid #f3f4f6;">
            <span style="font-size:12px;color:#9ca3af;">Sent by ${org}. If you weren't expecting this email, you can ignore it.</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export { escapeHtml as escapeEmailHtml };
