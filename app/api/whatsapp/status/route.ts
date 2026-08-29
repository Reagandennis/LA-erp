import { NextRequest, NextResponse } from 'next/server';

import { counts } from '@/lib/messaging-repo';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { getStatus } from '@/lib/wacli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'whatsapp');
  if (response || !ctx) return response;

  // Not linked yet: report that cleanly rather than probing a store that
  // doesn't exist, so the UI can show the QR panel.
  if (!ctx.account) {
    return NextResponse.json({
      available: true,
      authenticated: false,
      connected: false,
      linkedJid: null,
      lastSyncAt: null,
      counts: { messages: 0, chats: 0, contacts: 0, groups: 0 },
      hint: 'Scan the QR code with WhatsApp to link your account.',
    });
  }
  const status = await getStatus(ctx.account.handle);
  const mirrored = await counts(ctx.account.id);
  return NextResponse.json({
    ...status,
    counts: { ...status.counts, chats: mirrored.chats, messages: mirrored.messages },
  });
}
