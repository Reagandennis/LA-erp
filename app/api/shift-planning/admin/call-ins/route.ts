import { NextRequest, NextResponse } from 'next/server';

import { type CallInInput, cancelCallIn, saveCallIn } from '@/lib/shift-planning';
import { readJson, requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** Calls someone in (or edits the call-in already on that day). */
export async function POST(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const body = await readJson(request);
    const result = await saveCallIn(ctx.actor, {
      lineId: Number(body.lineId),
      date: String(body.date ?? ''),
      code: body.code as CallInInput['code'],
      trigger: body.trigger as CallInInput['trigger'],
      calledAt: text(body.calledAt),
      acknowledgedAt: text(body.acknowledgedAt),
      arrivedAt: text(body.arrivedAt),
      releasedAt: text(body.releasedAt),
      actualStart: text(body.actualStart),
      actualEnd: text(body.actualEnd),
      escalationApproved: body.escalationApproved === true,
      note: text(body.note),
      confirmWarnings: body.confirmWarnings === true,
      forceReason: text(body.forceReason),
    });
    return NextResponse.json(result, { status: result.saved ? 200 : 409 });
  });
}

export async function DELETE(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const lineId = Number(request.nextUrl.searchParams.get('lineId'));
    const date = request.nextUrl.searchParams.get('date') ?? '';
    const record = Number.isInteger(lineId) ? await cancelCallIn(ctx.actor, lineId, date) : null;
    if (!record) return NextResponse.json({ error: 'Call-in not found' }, { status: 404 });
    return NextResponse.json({ record });
  });
}
