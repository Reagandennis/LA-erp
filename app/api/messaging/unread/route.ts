import { NextRequest, NextResponse } from 'next/server';

import { isMessagingProvider, type MessagingProvider } from '@/lib/messaging-accounts';
import { unreadByAccount } from '@/lib/messaging-repo';
import { canUseModule } from '@/lib/messaging-routes';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Unread chats across the caller's own linked accounts, for the badges and
 * alerts every page shows (sidebar, tab title). Accounts are listed so an
 * alert can tell which module a pushed message belongs to.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response ?? NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const accounts = (await unreadByAccount(auth.user.id)).filter(
    (a): a is typeof a & { provider: MessagingProvider } =>
      isMessagingProvider(a.provider) && canUseModule(auth.user, a.provider),
  );

  const providers: Record<MessagingProvider, number> = { whatsapp: 0, telegram: 0, signal: 0 };
  for (const account of accounts) providers[account.provider] += account.unread;

  return NextResponse.json(
    { providers, accounts: accounts.map((a) => ({ id: a.id, provider: a.provider })) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
