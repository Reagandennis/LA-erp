import { NextRequest, NextResponse } from 'next/server';

import { createHoliday, isDateKey, listHolidays } from '@/lib/shift-planning';
import { requireManager, requireViewer } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { ctx, response } = await requireViewer(request);
  if (response || !ctx) return response;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const scoped = isDateKey(from) && isDateKey(to);
  return NextResponse.json({
    holidays: await listHolidays(scoped ? from : undefined, scoped ? to : undefined),
  });
}

export async function POST(request: NextRequest) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const date = String(body?.date ?? '');
  const name = String(body?.name ?? '').trim();
  if (!isDateKey(date)) return NextResponse.json({ error: 'Date must be YYYY-MM-DD.' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });

  const holiday = await createHoliday({ date, name, createdById: ctx.userId });
  if (!holiday) {
    return NextResponse.json({ error: 'That date is already a holiday.' }, { status: 409 });
  }
  return NextResponse.json({ holiday }, { status: 201 });
}
