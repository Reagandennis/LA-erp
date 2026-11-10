import { NextRequest, NextResponse } from 'next/server';

import { listAudit } from '@/lib/shift-planning';
import { requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  return respond(async () => {
    const { response } = await requireManager(request);
    if (response) return response;
    const before = Number(request.nextUrl.searchParams.get('before'));
    const entries = await listAudit({ limit: 100, before: Number.isInteger(before) && before > 0 ? before : null });
    return NextResponse.json({ entries });
  });
}
