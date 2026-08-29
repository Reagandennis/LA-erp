import { NextRequest, NextResponse } from 'next/server';

import { getMapWorkspace } from '@/lib/map-store';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const workspace = await getMapWorkspace();
  return NextResponse.json(workspace);
}
