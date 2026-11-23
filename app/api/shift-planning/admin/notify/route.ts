import { NextRequest, NextResponse } from 'next/server';

import { noticeStatus, sendShiftNotices } from '@/lib/shift-notify';
import { requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Who is linked to an account and when each was last emailed. */
export async function GET(request: NextRequest) {
  return respond(async () => {
    const { response } = await requireManager(request);
    if (response) return response;
    return NextResponse.json(await noticeStatus());
  });
}

/** Sends the welcome to anyone not yet welcomed, and any shift updates due. */
export async function POST(request: NextRequest) {
  return respond(async () => {
    const { response } = await requireManager(request);
    if (response) return response;
    const result = await sendShiftNotices(request.nextUrl.origin);
    return NextResponse.json({ result, status: await noticeStatus() });
  });
}
