import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  getAccount,
  type LinkedAccount,
  type MessagingProvider,
} from './messaging-accounts';
import { ADMIN_ROLE_NAME } from './rbac';
import { requireRequestAuth } from './request-auth';
import { userHasModule, userHasRole } from './user';

/**
 * Shared gate for every per-user messaging route.
 *
 * Holding the module permission lets you use YOUR OWN linked account — it is
 * not a licence to read other people's conversations, so there is deliberately
 * no admin override on the data paths. Admins get the module like anyone else
 * and see their own inbox.
 */

type AuthUser = Parameters<typeof userHasRole>[0];

export function canUseModule(user: AuthUser, slug: string): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, slug);
}

export interface MessagingContext {
  userId: number;
  account: LinkedAccount | null;
}

/**
 * Resolve the caller and their linked account for `provider`.
 *
 * `?account=<id>` picks one of the caller's accounts (WhatsApp can have
 * several); without it the first one they linked is used. The id is only ever
 * looked up among the caller's own accounts, so naming someone else's is a
 * 404, not a way in. Returns a ready-to-send response instead of a context
 * when the request is unauthenticated, the user lacks the module, or the
 * account id is malformed or unknown.
 */
export async function resolveMessagingRequest(
  request: NextRequest,
  provider: MessagingProvider,
): Promise<{ ctx: MessagingContext; response: null } | { ctx: null; response: NextResponse }> {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) {
    return { ctx: null, response: response ?? NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  if (!canUseModule(auth.user, provider)) {
    return { ctx: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  const requested = new URL(request.url).searchParams.get('account');
  if (requested === null || requested === '') {
    const account = await getAccount(auth.user.id, provider);
    return { ctx: { userId: auth.user.id, account }, response: null };
  }
  const accountId = Number(requested);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    return { ctx: null, response: NextResponse.json({ error: 'Invalid account.' }, { status: 400 }) };
  }
  const account = await getAccount(auth.user.id, provider, accountId);
  if (!account) {
    return { ctx: null, response: NextResponse.json({ error: 'Account not found.' }, { status: 404 }) };
  }
  return { ctx: { userId: auth.user.id, account }, response: null };
}
