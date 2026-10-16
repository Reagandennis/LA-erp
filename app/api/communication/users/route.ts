import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { listMessageableUsers } from '@/lib/communication';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.communication);
  if (response || !auth) return response;

  const users = await listMessageableUsers(auth.user.id);
  return NextResponse.json({ users });
}
