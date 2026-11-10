import { NextRequest, NextResponse } from 'next/server';

import { loadDashboard } from '@/lib/shift-dashboard';
import { requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  return respond(async () => {
    const { response } = await requireManager(request);
    if (response) return response;
    return NextResponse.json(await loadDashboard());
  });
}
