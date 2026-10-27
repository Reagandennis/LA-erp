import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { loadOpsDashboard } from '@/lib/ops-dashboard';
import { parsePanels } from '@/lib/ops-panels';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The Ops Dashboard's panels, polled while the board is open. `?panels=trips,tasks`
 * loads just those (the ones on screen, or the ones a change touched).
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.opsDashboard);
  if (response || !auth) return response;

  const panels = parsePanels(request.nextUrl.searchParams.get('panels'));
  return NextResponse.json({ dashboard: await loadOpsDashboard(auth.user, panels) });
}
