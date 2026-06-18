import { NextRequest, NextResponse } from 'next/server';

import { queryAuditLogs } from '@/lib/audit';
import { requireAdminRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseIntOr(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: NextRequest) {
  const { response } = await requireAdminRequest(request);
  if (response) return response;

  const sp = request.nextUrl.searchParams;
  const actorIdRaw = sp.get('actorId');
  const actorId = actorIdRaw ? Number(actorIdRaw) : null;

  // Inclusive end-of-day for a "to" date so the whole day is covered.
  const to = parseDate(sp.get('to'));
  if (to) to.setHours(23, 59, 59, 999);

  const result = await queryAuditLogs({
    q: sp.get('q') ?? undefined,
    action: sp.get('action') ?? undefined,
    entityType: sp.get('entityType') ?? undefined,
    actorId: actorId && Number.isInteger(actorId) && actorId > 0 ? actorId : null,
    from: parseDate(sp.get('from')),
    to,
    page: parseIntOr(sp.get('page'), 1),
    pageSize: parseIntOr(sp.get('pageSize'), 25),
  });

  return NextResponse.json(result);
}
