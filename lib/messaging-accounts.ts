import 'server-only';

import { randomBytes } from 'crypto';

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

/**
 * Providers that allow more than one linked account per user. Each WhatsApp
 * account is its own wacli store, so a user can follow a work and a personal
 * number side by side. Telegram and Signal keep one session per user.
 */
export function allowsMultipleAccounts(provider: MessagingProvider): boolean {
  return provider === 'whatsapp';
}

function toLinked(row: { provider: string } & Omit<LinkedAccount, 'provider'>): LinkedAccount {
  return { ...row, provider: row.provider as MessagingProvider };
}

/**
 * One of the user's accounts: the one with `accountId` when given (null if
 * it isn't theirs), otherwise the first they linked.
 */
export async function getAccount(
  userId: number,
  provider: MessagingProvider,
  accountId?: number,
): Promise<LinkedAccount | null> {
  const row = await prisma.messagingAccount.findFirst({
    where: { userId, provider, ...(accountId === undefined ? {} : { id: accountId }) },
    orderBy: { id: 'asc' },
  });
  return row ? toLinked(row) : null;
}

/**
 * An account by id alone. Only for callers that are not acting for a signed-in
 * user (the wacli webhook); request handlers go through `getAccount`.
 */
export async function findAccount(accountId: number): Promise<LinkedAccount | null> {
  const row = await prisma.messagingAccount.findUnique({ where: { id: accountId } });
  return row ? toLinked(row) : null;
}

// --- WhatsApp numbers shared with a group -------------------------------------

/** An account the user may use: their own, or a WhatsApp number shared with one of their groups. */
export interface UsableAccount extends LinkedAccount {
  /** True when someone else owns it and shared it with the user's group. */
  shared: boolean;
  ownerName: string | null;
}

/** Group shares apply to WhatsApp only; Telegram and Signal stay personal. */
function sharedWhere(userId: number, provider: MessagingProvider) {
  return provider === 'whatsapp'
    ? { provider, userId: { not: userId }, groupShares: { some: { group: { members: { some: { userId } } } } } }
    : null;
}

/**
 * The account a request acts on: one of the user's own, or (WhatsApp) a number
 * shared with one of their groups. Without an id, their first own account,
 * else the first shared with them. Null when the id is neither.
 */
export async function getUsableAccount(userId: number, provider: MessagingProvider, accountId?: number): Promise<UsableAccount | null> {
  const own = await getAccount(userId, provider, accountId);
  if (own) return { ...own, shared: false, ownerName: null };
  const where = sharedWhere(userId, provider);
  if (!where) return null;
  const row = await prisma.messagingAccount.findFirst({
    where: { ...where, ...(accountId === undefined ? {} : { id: accountId }) },
    include: { user: { select: { name: true } } },
    orderBy: { id: 'asc' },
  });
  if (!row) return null;
  const { user, ...rest } = row;
  return { ...toLinked(rest), shared: true, ownerName: user.name };
}

/** The user's own accounts, then the numbers shared with their groups. */
export async function listUsableAccounts(userId: number, provider: MessagingProvider): Promise<UsableAccount[]> {
  const own = (await listAccounts(userId, provider)).map((a) => ({ ...a, shared: false, ownerName: null }));
  const where = sharedWhere(userId, provider);
  if (!where) return own;
  const rows = await prisma.messagingAccount.findMany({ where, include: { user: { select: { name: true } } }, orderBy: { id: 'asc' } });
  return [...own, ...rows.map(({ user, ...rest }) => ({ ...toLinked(rest), shared: true, ownerName: user.name }))];
}

const VIEWER_TTL_MS = 15_000;
const viewerCache = new Map<number, { at: number; ids: number[] }>();

/**
 * Everyone besides the owner who may see an account: the members of the
 * groups it is shared with. Cached briefly, since live events ask on every
 * message.
 */
export async function accountViewers(accountId: number): Promise<number[]> {
  const hit = viewerCache.get(accountId);
  if (hit && Date.now() - hit.at < VIEWER_TTL_MS) return hit.ids;
  const rows = await prisma.userGroupMember.findMany({
    where: { group: { messagingShares: { some: { accountId } } } },
    select: { userId: true },
  });
  const ids = [...new Set(rows.map((r) => r.userId))];
  viewerCache.set(accountId, { at: Date.now(), ids });
  return ids;
}

/** The owner's groups, and which of them this account is shared with. */
export async function accountGroupSharing(ownerId: number, accountId: number) {
  const [groups, shares] = await Promise.all([
    prisma.userGroup.findMany({
      where: { members: { some: { userId: ownerId } } },
      select: { id: true, name: true, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.messagingAccountGroupShare.findMany({ where: { accountId }, select: { groupId: true } }),
  ]);
  return {
    groups: groups.map((g) => ({ id: g.id, name: g.name, memberCount: g._count.members })),
    sharedGroupIds: shares.map((s) => s.groupId),
  };
}

/** Shares (or stops sharing) an owner's WhatsApp number with one of their groups. */
export async function setAccountGroupShare(ownerId: number, accountId: number, groupId: number, shared: boolean): Promise<boolean> {
  const account = await prisma.messagingAccount.findFirst({ where: { id: accountId, userId: ownerId, provider: 'whatsapp' }, select: { id: true } });
  if (!account) return false;
  if (shared) {
    const group = await prisma.userGroup.findFirst({ where: { id: groupId, members: { some: { userId: ownerId } } }, select: { id: true } });
    if (!group) return false;
    await prisma.messagingAccountGroupShare.createMany({ data: [{ accountId, groupId }], skipDuplicates: true });
  } else {
    await prisma.messagingAccountGroupShare.deleteMany({ where: { accountId, groupId } });
  }
  viewerCache.delete(accountId);
  return true;
}

/** All of one user's accounts for a provider, oldest first. */
export async function listAccounts(userId: number, provider: MessagingProvider): Promise<LinkedAccount[]> {
  const rows = await prisma.messagingAccount.findMany({
    where: { userId, provider },
    orderBy: { id: 'asc' },
  });
  return rows.map(toLinked);
}

/** Every linked account for one provider — used by the WhatsApp sync supervisor. */
export async function listAccountsForProvider(
  provider: MessagingProvider,
): Promise<LinkedAccount[]> {
  const rows = await prisma.messagingAccount.findMany({ where: { provider } });
  return rows.map(toLinked);
}

/**
 * Create or update a linked account. A multi-account provider matches on the
 * handle, so linking another WhatsApp adds a row; the others replace the
 * user's one account, so re-linking Telegram with a new number updates it.
 */
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
  const existing = await prisma.messagingAccount.findFirst({
    where: {
      userId: input.userId,
      provider: input.provider,
      ...(allowsMultipleAccounts(input.provider) ? { handle: input.handle } : {}),
    },
    orderBy: { id: 'asc' },
  });
  const row = existing
    ? await prisma.messagingAccount.update({ where: { id: existing.id }, data })
    : await prisma.messagingAccount.create({
        data: { userId: input.userId, provider: input.provider, ...data },
      });
  return toLinked(row);
}

/** Update only the display label (e.g. once the linked number is known). */
export async function setAccountLabel(accountId: number, label: string): Promise<void> {
  await prisma.messagingAccount.update({ where: { id: accountId }, data: { label } });
}

export async function deleteAccount(
  userId: number,
  provider: MessagingProvider,
  accountId?: number,
): Promise<LinkedAccount | null> {
  const existing = await getAccount(userId, provider, accountId);
  if (!existing) return null;
  await prisma.messagingAccount.delete({ where: { id: existing.id } });
  return existing;
}

/**
 * A fresh, filesystem-safe wacli account name for a new WhatsApp link.
 *
 * wacli creates a store directory from this, so it must never contain path
 * separators or shell-significant characters. The numeric user id ties it to
 * its owner, and the random suffix makes every link a new, empty store: a
 * number that was unlinked never leaves its history behind for the next one.
 * (Accounts linked before multi-account support are named `laerp-user-<id>`.)
 */
export function newWacliAccountName(userId: number): string {
  return `laerp-user-${userId}-${randomBytes(4).toString('hex')}`;
}

/** True for names this app gives wacli accounts, so cleanup never touches others. */
export function isAppWacliAccountName(name: string): boolean {
  return /^laerp-user-\d+(-[0-9a-f]{8})?$/.test(name);
}

/** "254712345678@s.whatsapp.net" or "254712345678:12@…" -> "+254712345678". */
export function phoneFromJid(jid: string | null | undefined): string | null {
  const digits = /^(\d{6,15})[:@]/.exec(jid ?? '')?.[1];
  return digits ? `+${digits}` : null;
}
