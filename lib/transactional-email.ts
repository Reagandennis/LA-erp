import { APP_LOCALE } from './locale';
import 'server-only';

import { buildInvoicePdf, buildQuotePdf } from './document-pdf';
import { EmailError, escapeEmailHtml, renderEmailLayout, sendEmail } from './email';
import type { InvoiceDetail } from './invoices';
import { getOrganizationSettings } from './organization';
import type { QuoteDetail } from './quotes';

function formatMoney(value: number, currency: string): string {
  try {
    return value.toLocaleString(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 2 });
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(APP_LOCALE, { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Emails an invoice to its customer with the PDF attached.
 * Throws {@link EmailError} if the customer has no email or delivery fails.
 */
export async function emailInvoiceToCustomer(invoice: InvoiceDetail): Promise<{ to: string }> {
  const to = invoice.customer.email?.trim();
  if (!to) {
    throw new EmailError('This customer has no email address on file.');
  }

  const organization = await getOrganizationSettings();
  const orgName = invoice.brandProfile?.companyName || organization.companyName || 'Our company';
  const accent = invoice.brandProfile?.primaryColor || '#03458f';
  const pdf = await buildInvoicePdf(invoice);

  const bodyHtml = `
    <p>Hi ${escapeEmailHtml(invoice.customer.name)},</p>
    <p>Please find attached invoice <strong>${escapeEmailHtml(invoice.number)}</strong> from ${escapeEmailHtml(orgName)}.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;font-size:14px;color:#374151;">
      <tr><td style="padding:2px 16px 2px 0;color:#6b7280;">Amount due</td><td style="font-weight:700;">${escapeEmailHtml(formatMoney(invoice.balanceDue, invoice.currency))}</td></tr>
      <tr><td style="padding:2px 16px 2px 0;color:#6b7280;">Due date</td><td>${escapeEmailHtml(formatDate(invoice.dueDate))}</td></tr>
    </table>
    <p>The full invoice is attached as a PDF. If you have any questions, simply reply to this email.</p>
    <p>Thank you for your business.</p>`;

  const html = renderEmailLayout({
    title: `Invoice ${invoice.number}`,
    bodyHtml,
    organizationName: orgName,
    accentColor: accent,
  });

  await sendEmail({
    to,
    subject: `Invoice ${invoice.number} from ${orgName}`,
    html,
    attachments: [{ filename: `${invoice.number}.pdf`, content: pdf, contentType: 'application/pdf' }],
  });

  return { to };
}

/**
 * Emails a quote to its customer with the PDF attached.
 * Throws {@link EmailError} if the customer has no email or delivery fails.
 */
export async function emailQuoteToCustomer(quote: QuoteDetail): Promise<{ to: string }> {
  const to = quote.customer.email?.trim();
  if (!to) {
    throw new EmailError('This customer has no email address on file.');
  }

  const organization = await getOrganizationSettings();
  const orgName = quote.brandProfile?.companyName || organization.companyName || 'Our company';
  const accent = quote.brandProfile?.primaryColor || '#03458f';
  const pdf = await buildQuotePdf(quote);

  const bodyHtml = `
    <p>Hi ${escapeEmailHtml(quote.customer.name)},</p>
    <p>Please find attached quotation <strong>${escapeEmailHtml(quote.reference)}</strong>${quote.subject ? ` — ${escapeEmailHtml(quote.subject)}` : ''} from ${escapeEmailHtml(orgName)}.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;font-size:14px;color:#374151;">
      <tr><td style="padding:2px 16px 2px 0;color:#6b7280;">Total</td><td style="font-weight:700;">${escapeEmailHtml(formatMoney(quote.total, quote.currency))}</td></tr>
      <tr><td style="padding:2px 16px 2px 0;color:#6b7280;">Valid until</td><td>${escapeEmailHtml(formatDate(quote.expiryDate))}</td></tr>
    </table>
    <p>The full quotation is attached as a PDF. If you'd like to proceed or have any questions, simply reply to this email.</p>`;

  const html = renderEmailLayout({
    title: `Quotation ${quote.reference}`,
    bodyHtml,
    organizationName: orgName,
    accentColor: accent,
  });

  await sendEmail({
    to,
    subject: `Quotation ${quote.reference} from ${orgName}`,
    html,
    attachments: [{ filename: `${quote.reference}.pdf`, content: pdf, contentType: 'application/pdf' }],
  });

  return { to };
}

/**
 * Asks an approver to review a submitted invoice. Attaches the invoice PDF so
 * they can review straight from their inbox. Best-effort: callers must not
 * fail the submission if this throws.
 */
export async function emailInvoiceApprovalRequest(params: {
  invoice: InvoiceDetail;
  approver: { name: string; email: string };
  submitterName: string;
  reviewUrl: string;
}): Promise<{ to: string }> {
  const { invoice } = params;
  const organization = await getOrganizationSettings();
  const orgName = invoice.brandProfile?.companyName || organization.companyName || 'Our company';
  const pdf = await buildInvoicePdf(invoice);

  const bodyHtml = `
    <p>Hi ${escapeEmailHtml(params.approver.name)},</p>
    <p><strong>${escapeEmailHtml(params.submitterName)}</strong> submitted invoice <strong>${escapeEmailHtml(invoice.number)}</strong> for your approval.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;font-size:14px;color:#374151;">
      <tr><td style="padding:2px 16px 2px 0;color:#6b7280;">Customer</td><td>${escapeEmailHtml(invoice.customer.name)}</td></tr>
      <tr><td style="padding:2px 16px 2px 0;color:#6b7280;">Total</td><td style="font-weight:700;">${escapeEmailHtml(formatMoney(invoice.total, invoice.currency))}</td></tr>
      <tr><td style="padding:2px 16px 2px 0;color:#6b7280;">Due date</td><td>${escapeEmailHtml(formatDate(invoice.dueDate))}</td></tr>
    </table>
    <p>The invoice is attached as a PDF. It cannot be sent to the customer, and no payments can be recorded against it, until you approve it.</p>`;

  const html = renderEmailLayout({
    title: `Approval needed: invoice ${invoice.number}`,
    bodyHtml,
    organizationName: orgName,
    cta: { label: 'Review in LA-ERP', url: params.reviewUrl },
  });

  await sendEmail({
    to: params.approver.email,
    subject: `Approval needed: invoice ${invoice.number} (${formatMoney(invoice.total, invoice.currency)})`,
    html,
    attachments: [{ filename: `${invoice.number}.pdf`, content: pdf, contentType: 'application/pdf' }],
  });

  return { to: params.approver.email };
}

/**
 * Tells the invoice's creator the approval decision. Best-effort: callers must
 * not fail the decision if this throws.
 */
export async function emailInvoiceDecisionToCreator(params: {
  invoice: InvoiceDetail;
  decision: 'approved' | 'declined';
  note: string | null;
  reviewUrl: string;
}): Promise<{ to: string }> {
  const { invoice } = params;
  const organization = await getOrganizationSettings();
  const orgName = invoice.brandProfile?.companyName || organization.companyName || 'Our company';
  const approved = params.decision === 'approved';

  const bodyHtml = `
    <p>Hi ${escapeEmailHtml(invoice.createdBy.name)},</p>
    <p>Invoice <strong>${escapeEmailHtml(invoice.number)}</strong> (${escapeEmailHtml(invoice.customer.name)}, ${escapeEmailHtml(formatMoney(invoice.total, invoice.currency))}) was <strong>${approved ? 'approved' : 'declined'}</strong>${invoice.approver ? ` by ${escapeEmailHtml(invoice.approver.name)}` : ''}.</p>
    ${params.note ? `<p style="color:#6b7280;">Note: “${escapeEmailHtml(params.note)}”</p>` : ''}
    <p>${approved ? 'You can now send it to the customer.' : 'Revise the invoice and resubmit it for approval.'}</p>`;

  const html = renderEmailLayout({
    title: `Invoice ${invoice.number} ${approved ? 'approved' : 'declined'}`,
    bodyHtml,
    organizationName: orgName,
    cta: { label: approved ? 'Open invoice' : 'Revise invoice', url: params.reviewUrl },
    accentColor: approved ? '#059669' : '#e11d48',
  });

  await sendEmail({
    to: invoice.createdBy.email,
    subject: `Invoice ${invoice.number} ${approved ? 'approved ✓' : 'declined'}`,
    html,
  });

  return { to: invoice.createdBy.email };
}

/**
 * Sends a welcome email to a newly created user. Does not include a password —
 * the administrator shares credentials separately. Best-effort: callers should
 * not fail account creation if this throws.
 */
export async function emailWelcomeToUser(params: {
  name: string;
  email: string;
  loginUrl: string;
}): Promise<{ to: string }> {
  const organization = await getOrganizationSettings();
  const orgName = organization.companyName || 'the team';

  const bodyHtml = `
    <p>Hi ${escapeEmailHtml(params.name)},</p>
    <p>An account has been created for you on the ${escapeEmailHtml(orgName)} platform.</p>
    <p>Sign in with your email address <strong>${escapeEmailHtml(params.email)}</strong>. Your administrator will share your password separately.</p>`;

  const html = renderEmailLayout({
    title: `Welcome to ${orgName}`,
    bodyHtml,
    organizationName: orgName,
    cta: { label: 'Sign in', url: params.loginUrl },
  });

  await sendEmail({
    to: params.email,
    subject: `Your ${orgName} account is ready`,
    html,
  });

  return { to: params.email };
}
