import { NextRequest, NextResponse } from 'next/server';

import { listApproverCandidates } from '@/lib/quotes';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const approvers = await listApproverCandidates(auth.user.id);
  return NextResponse.json({ approvers });
}
