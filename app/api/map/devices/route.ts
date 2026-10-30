import { NextRequest, NextResponse } from 'next/server';

import { requireModuleRequest } from '@/lib/request-auth';
import { listTrackedDevices } from '@/lib/tracked-devices';

export type { SourceStatus } from '@/lib/tracked-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Every live position the map should show, from every configured source (lib/tracked-devices). */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const { devices, sources } = await listTrackedDevices();
  return NextResponse.json({ devices, sources, at: new Date().toISOString() });
}
