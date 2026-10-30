import { NextRequest, NextResponse } from 'next/server';

import { searchAirports } from '@/lib/airports';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LIMIT_MAX = 20;

/** Airport autocomplete for the flight form: `?q=nair` → Nairobi's airports. Local data, no credits spent. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.flights);
  if (response || !auth) return response;

  const sp = request.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').slice(0, 60);
  const limit = Math.min(LIMIT_MAX, Math.max(1, Number(sp.get('limit')) || 8));
  return NextResponse.json({ airports: searchAirports(q, limit) });
}
