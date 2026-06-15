import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { sendText } from '@/lib/wacli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type AuthUser = Parameters<typeof userHasRole>[0];
function canUse(user: AuthUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'whatsapp');
}

/** Send a text message to a chat or group (by JID) through the linked WhatsApp. */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { jid?: string; message?: string } | null;
  const jid = (body?.jid ?? '').trim();
  const message = (body?.message ?? '').trim();
  if (!jid) return NextResponse.json({ error: 'A chat jid is required.' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'A message is required.' }, { status: 400 });

  const result = await sendText(jid, message);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Send failed.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
