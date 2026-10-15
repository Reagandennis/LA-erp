import { NextRequest, NextResponse } from 'next/server';

import { listAccounts, phoneFromJid, setAccountLabel } from '@/lib/messaging-accounts';
import { counts, unreadChatCounts } from '@/lib/messaging-repo';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { getStatus } from '@/lib/wacli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Status of one of the caller's WhatsApp accounts (`?account=<id>`, else the
 * first), plus the list of all of them for the console's account switcher.
 */
export async function GET(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'whatsapp');
  if (response || !ctx) return response;

  const linked = await listAccounts(ctx.userId, 'whatsapp');
  const unread = await unreadChatCounts(linked.map((a) => a.id));
  const accounts = linked.map((a) => ({ id: a.id, label: a.label, unread: unread.get(a.id) ?? 0 }));

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
      accountId: null,
      accounts,
    });
  }
  const status = await getStatus(ctx.account.handle);
  const mirrored = await counts(ctx.account.id);

  // Accounts linked before the number was recorded are named once it is known.
  const phone = phoneFromJid(status.linkedJid);
  const account = accounts.find((a) => a.id === ctx.account!.id);
  if (phone && account && (!account.label || account.label === 'WhatsApp')) {
    await setAccountLabel(account.id, phone);
    account.label = phone;
  }

  return NextResponse.json({
    ...status,
    counts: { ...status.counts, chats: mirrored.chats, messages: mirrored.messages },
    accountId: ctx.account.id,
    accounts,
  });
}
