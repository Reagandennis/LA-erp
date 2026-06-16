import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { EmailError, renderEmailLayout, sendEmail } from '@/lib/email';
import { getOrganizationSettings } from '@/lib/organization';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'admin.email.test',
    key: `${auth.user.id}`,
    limit: 10,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many test emails. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as { to?: unknown } | null;
  const to = typeof body?.to === 'string' ? body.to.trim() : '';
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: 'Enter a valid email address to send the test to.' }, { status: 400 });
  }

  const organization = await getOrganizationSettings();
  const orgName = organization.companyName || 'the platform';

  const html = renderEmailLayout({
    title: 'Email is working 🎉',
    organizationName: orgName,
    bodyHtml: `
      <p>This is a test email from your ${orgName} platform.</p>
      <p>If you're reading this, your SMTP / Google Workspace settings are configured correctly and the platform can send email to users and clients.</p>`,
  });

  try {
    const { messageId } = await sendEmail({
      to,
      subject: `Test email from ${orgName}`,
      html,
    });
    await recordAuditEvent({
      action: 'admin.email.test',
      entityType: 'email',
      entityId: to,
      actorUserId: auth.user.id,
      metadata: { messageId },
      request,
    });
    return NextResponse.json({ success: true, to, messageId });
  } catch (error) {
    const message = error instanceof EmailError ? error.message : 'Could not send the test email.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
