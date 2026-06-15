import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { listThread } from '@/lib/wacli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type AuthUser = Parameters<typeof userHasRole>[0];
function canUse(user: AuthUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'whatsapp');
}

/** Messages for one chat (oldest-first), from the local WhatsApp mirror. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const jid = (searchParams.get('jid') ?? '').trim();
  if (!jid) return NextResponse.json({ error: 'A chat jid is required.' }, { status: 400 });
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 500);

  try {
    return NextResponse.json({ messages: await listThread(jid, limit) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'wacli error', messages: [] }, { status: 502 });
  }
}
