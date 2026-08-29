import 'server-only';

import { prisma } from './prisma';

/**
 * Per-user messaging account lookup.
 *
 * Every provider call is scoped to the *calling user's* linked account. There is
 * deliberately no admin override: holding the module permission lets you use
 * your own WhatsApp/Telegram/Signal through the console, not read anyone else's.
 */

export type MessagingProvider = 'whatsapp' | 'telegram' | 'signal';

export const MESSAGING_PROVIDERS: MessagingProvider[] = ['whatsapp', 'telegram', 'signal'];

export function isMessagingProvider(value: string): value is MessagingProvider {
  return (MESSAGING_PROVIDERS as string[]).includes(value);
}

export interface LinkedAccount {
  id: number;
  userId: number;
  provider: MessagingProvider;
  handle: string;
  label: string | null;
  session: string | null;
}

export async function getAccount(
  userId: number,
  provider: MessagingProvider,
): Promise<LinkedAccount | null> {
  const row = await prisma.messagingAccount.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  return row ? ({ ...row, provider } as LinkedAccount) : null;
}

/** Every linked account for one provider — used by the WhatsApp sync supervisor. */
export async function listAccountsForProvider(
  provider: MessagingProvider,
): Promise<LinkedAccount[]> {
  const rows = await prisma.messagingAccount.findMany({ where: { provider } });
  return rows.map((r) => ({ ...r, provider }) as LinkedAccount);
}

export async function saveAccount(input: {
  userId: number;
  provider: MessagingProvider;
  handle: string;
  label?: string | null;
  session?: string | null;
}): Promise<LinkedAccount> {
  const data = {
    handle: input.handle,
    label: input.label ?? null,
    session: input.session ?? null,
  };
  const row = await prisma.messagingAccount.upsert({
    where: { userId_provider: { userId: input.userId, provider: input.provider } },
    update: data,
    create: { userId: input.userId, provider: input.provider, ...data },
  });
  return { ...row, provider: input.provider } as LinkedAccount;
}

export async function deleteAccount(
  userId: number,
  provider: MessagingProvider,
): Promise<LinkedAccount | null> {
  const existing = await getAccount(userId, provider);
  if (!existing) return null;
  await prisma.messagingAccount.delete({
    where: { userId_provider: { userId, provider } },
  });
  return existing;
}

/**
 * A stable, filesystem-safe wacli account name for a user.
 *
 * wacli creates a store directory from this, so it must never contain path
 * separators or shell-significant characters. The numeric user id keeps it
 * unique even if two people share a display name.
 */
export function wacliAccountName(userId: number): string {
  return `laerp-user-${userId}`;
}
