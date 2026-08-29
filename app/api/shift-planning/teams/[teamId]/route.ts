import { NextRequest, NextResponse } from 'next/server';

import { deleteTeam } from '@/lib/shift-planning';
import { requireManager } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { teamId } = await params;
  const ok = await deleteTeam(teamId);
  if (!ok) return NextResponse.json({ error: 'Team not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
