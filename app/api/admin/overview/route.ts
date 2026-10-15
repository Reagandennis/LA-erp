import { NextRequest, NextResponse } from 'next/server';

import { getAdminOverview } from '@/lib/admin-console';
import { requireAdminRequest } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { response } = await requireAdminRequest(request);
  if (response) return response;
  return NextResponse.json({ overview: await getAdminOverview() });
}
