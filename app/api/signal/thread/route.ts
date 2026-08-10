import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { listThread } from '@/lib/signal-cli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type AuthUser = Parameters<typeof userHasRole>[0];
function canUse(user: AuthUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'signal');
}

/** Messages for one chat (oldest-first). */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get('id') ?? '').trim();
  if (!id) return NextResponse.json({ error: 'A chat id is required.' }, { status: 400 });
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 200, 1), 500);

  try {
    return NextResponse.json({ messages: await listThread(id, limit) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Signal error', messages: [] },
      { status: 502 },
    );
  }
}
