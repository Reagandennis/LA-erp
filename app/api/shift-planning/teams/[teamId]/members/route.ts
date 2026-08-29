import { NextRequest, NextResponse } from 'next/server';

import { addTeamMember, removeTeamMember } from '@/lib/shift-planning';
import { requireManager } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { teamId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const userId = Number(body?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: 'A person is required.' }, { status: 400 });
  }
  await addTeamMember(teamId, userId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { teamId } = await params;
  const userId = Number(new URL(request.url).searchParams.get('userId'));
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: 'A person is required.' }, { status: 400 });
  }
  await removeTeamMember(teamId, userId);
  return NextResponse.json({ ok: true });
}
