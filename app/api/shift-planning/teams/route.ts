import { NextRequest, NextResponse } from 'next/server';

import { createTeam, isColour, listTeams } from '@/lib/shift-planning';
import { requireManager, requireViewer } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { ctx, response } = await requireViewer(request);
  if (response || !ctx) return response;
  return NextResponse.json({ teams: await listTeams() });
}

export async function POST(request: NextRequest) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = String(body?.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'A team name is required.' }, { status: 400 });

  const team = await createTeam({
    name,
    colour: isColour(body?.colour) ? body.colour : 'emerald',
    createdById: ctx.userId,
  });
  if (!team) return NextResponse.json({ error: 'A team with that name already exists.' }, { status: 409 });
  return NextResponse.json({ team }, { status: 201 });
}
