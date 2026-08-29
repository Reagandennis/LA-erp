import { NextRequest, NextResponse } from 'next/server';

import { listRoster, listTeams } from '@/lib/shift-planning';
import { requireViewer } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Everyone who can be rostered, plus the teams they belong to. */
export async function GET(request: NextRequest) {
  const { ctx, response } = await requireViewer(request);
  if (response || !ctx) return response;

  const [people, teams] = await Promise.all([listRoster(), listTeams()]);
  return NextResponse.json({ people, teams, canManage: ctx.canManage, viewerId: ctx.userId });
}
