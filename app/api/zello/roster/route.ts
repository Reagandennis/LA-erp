import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { getZelloRoster } from '@/lib/zello-work';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'radio-zello')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const roster = await getZelloRoster();
  // canManage drives the console's "New channel" control. It is a UI hint only —
  // POST /api/zello/channels enforces admin on its own.
  return NextResponse.json({ ...roster, canManage: userHasRole(auth.user, ADMIN_ROLE_NAME) });
}
