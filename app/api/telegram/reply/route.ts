import { NextRequest, NextResponse } from 'next/server';

import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { sendText } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'telegram');
  if (response || !ctx) return response;
  if (!ctx.account) {
    return NextResponse.json({ error: 'Link your account first.' }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const id = String(body.id ?? body.id ?? '').trim();
  const message = String(body.message ?? '').trim();
  if (!id) return NextResponse.json({ error: 'A chat id is required.' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'A message is required.' }, { status: 400 });

  const result = await sendText(ctx.userId, id, message);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Send failed.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
