import { NextRequest, NextResponse } from 'next/server';

import { recordOutgoing } from '@/lib/messaging-repo';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { sendText } from '@/lib/wacli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'whatsapp');
  if (response || !ctx) return response;
  if (!ctx.account) {
    return NextResponse.json({ error: 'Link your account first.' }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const id = String(body.id ?? body.jid ?? '').trim();
  const message = String(body.message ?? '').trim();
  if (!id) return NextResponse.json({ error: 'A chat id is required.' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'A message is required.' }, { status: 400 });

  const result = await sendText(ctx.account.handle, id, message);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Send failed.' }, { status: 502 });
  }
  // wacli doesn't echo our own sends to the webhook; mirror it now so the
  // thread shows it on the reload that follows this response.
  if (result.messageId) {
    await recordOutgoing(ctx.account.id, ctx.userId, { chatId: id, messageId: result.messageId, text: message });
  }
  return NextResponse.json({ ok: true });
}
