import 'server-only';

import { publish } from './chat-bus';
import type { StoredChat, StoredMedia, StoredMessage } from './messaging-store';
import { prisma } from './prisma';

/**
 * Postgres-backed mirror of every linked account's conversations.
 *
 * The UI reads only from here. Providers write into it from background ingest
 * (a wacli webhook, the Signal receive loop, Telegram's update stream), which
 * is what makes opening a module a single indexed query instead of a CLI
 * round-trip — and what stops Signal's drain-once queue from losing messages.
 */

export interface IngestMessage {
  chatId: string;
  chatName: string;
  /**
   * `chatName` is only a stand-in (the bare phone number) because the provider
   * had no real name on this message. It names a new chat but never replaces
   * the name an existing one already has.
   */
  chatNameIsFallback?: boolean;
  chatKind: 'dm' | 'group';
  messageId: string;
  senderName: string;
  fromMe: boolean;
  text: string;
  at: Date;
  media?: StoredMedia | null;
}

export interface IngestOptions {
  /**
   * The batch is catch-up from a provider's own store rather than a live push:
   * history the phone synced after linking, or messages a dropped webhook
   * never delivered. Such a batch can be months old, so it never counts as
   * unread and never raises an alert. The provider reports which chats are
   * actually unread, and that is adopted separately (`applyProviderUnread`).
   */
  history?: boolean;
}

function toStoredMessage(row: {
  messageId: string;
  chatId: string;
  senderName: string;
  fromMe: boolean;
  text: string;
  at: Date;
  mediaKind: string | null;
  mediaRef: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  mediaSize: number | null;
}): StoredMessage {
  return {
    id: row.messageId,
    chatId: row.chatId,
    senderName: row.senderName,
    fromMe: row.fromMe,
    text: row.text,
    timestamp: row.at.toISOString(),
    media: row.mediaKind
      ? {
          kind: row.mediaKind as StoredMedia['kind'],
          ref: row.mediaRef ?? '',
          mimeType: row.mediaMime,
          fileName: row.mediaName,
          sizeBytes: row.mediaSize,
        }
      : null,
  };
}

/**
 * Persist a batch of messages for one account.
 *
 * Idempotent: re-ingesting the same provider message id is a no-op, so a
 * webhook retry or an overlapping backfill can't duplicate a thread. Returns
 * only the messages that were genuinely new, so callers know what to push.
 */
export async function ingestMessages(
  accountId: number,
  ownerUserId: number,
  batch: IngestMessage[],
  options: IngestOptions = {},
): Promise<StoredMessage[]> {
  if (batch.length === 0) return [];

  const fresh: StoredMessage[] = [];
  // One chat write per chat rather than per message: a history page can
  // carry hundreds of messages for the same conversation.
  const touched = new Map<
    string,
    { kind: 'dm' | 'group'; newest: Date; name: string | null; fallbackName: string; unread: number }
  >();

  for (const item of batch) {
    try {
      const created = await prisma.messagingMessage.create({
        data: {
          accountId,
          chatId: item.chatId,
          messageId: item.messageId,
          senderName: item.senderName,
          fromMe: item.fromMe,
          text: item.text,
          at: item.at,
          mediaKind: item.media?.kind ?? null,
          mediaRef: item.media?.ref ?? null,
          mediaMime: item.media?.mimeType ?? null,
          mediaName: item.media?.fileName ?? null,
          mediaSize: item.media?.sizeBytes ?? null,
        },
      });
      fresh.push(toStoredMessage(created));
    } catch {
      // Unique violation on (accountId, chatId, messageId): already mirrored.
      continue;
    }

    let chat = touched.get(item.chatId);
    if (!chat) {
      chat = { kind: item.chatKind, newest: item.at, name: null, fallbackName: item.chatName, unread: 0 };
      touched.set(item.chatId, chat);
    }
    const newest = item.at >= chat.newest;
    if (newest) chat.newest = item.at;
    // The newest real name in the batch wins; a bare number only ever names a new chat.
    if (!item.chatNameIsFallback && (newest || chat.name === null)) chat.name = item.chatName;

    if (!item.fromMe && !options.history) chat.unread++;
  }

  for (const [chatId, chat] of touched) {
    await prisma.messagingChat.upsert({
      where: { accountId_chatId: { accountId, chatId } },
      create: {
        accountId,
        chatId,
        kind: chat.kind,
        name: chat.name ?? chat.fallbackName,
        lastMessageAt: chat.newest,
        unreadCount: chat.unread,
      },
      update: {
        ...(chat.name !== null ? { name: chat.name } : {}),
        ...(chat.unread > 0 ? { unreadCount: { increment: chat.unread } } : {}),
      },
    });
    // History arrives older than what is already shown; it must never move a
    // chat down the list.
    await prisma.messagingChat.updateMany({
      where: { accountId, chatId, lastMessageAt: { lt: chat.newest } },
      data: { lastMessageAt: chat.newest },
    });
  }

  // Wake any console this user has open. The payload is deliberately small —
  // the client refetches the affected thread rather than trusting the event.
  if (fresh.length > 0) {
    const chatIds = [...new Set(fresh.map((m) => m.chatId))];
    publish(ownerUserId, 'messaging', {
      accountId,
      chatIds,
      count: fresh.length,
      // History and catch-up update badges quietly; only a live arrival alerts.
      live: !options.history,
      preview: options.history ? null : previewOf(fresh, touched),
    });
  }
  return fresh;
}

/** What an alert shows for a live batch: the newest message someone else sent. */
export interface MessagePreview {
  /** Provider message id; lets several open tabs agree on one alert. */
  messageId: string;
  chatId: string;
  chatName: string;
  chatKind: 'dm' | 'group';
  senderName: string;
  text: string;
  mediaKind: StoredMedia['kind'] | null;
}

const PREVIEW_CHARS = 140;

function previewOf(
  fresh: StoredMessage[],
  chats: Map<string, { kind: 'dm' | 'group'; name: string | null; fallbackName: string }>,
): MessagePreview | null {
  const inbound = fresh.filter((m) => !m.fromMe);
  const newest = inbound.reduce<StoredMessage | null>(
    (best, m) => (!best || m.timestamp >= best.timestamp ? m : best),
    null,
  );
  if (!newest) return null;
  const chat = chats.get(newest.chatId);
  return {
    messageId: newest.id,
    chatId: newest.chatId,
    chatName: chat?.name ?? chat?.fallbackName ?? newest.chatId,
    chatKind: chat?.kind ?? 'dm',
    senderName: newest.senderName,
    text: newest.text.length > PREVIEW_CHARS ? `${newest.text.slice(0, PREVIEW_CHARS - 1)}…` : newest.text,
    mediaKind: newest.media?.kind ?? null,
  };
}

/**
 * Mirror a message this user just sent, so it shows in the thread at once.
 *
 * Providers that don't echo our own sends (wacli stores them locally but never
 * posts them to its webhook) would otherwise leave the message invisible until
 * the next backfill. Keyed on the provider's message id, so when the backfill
 * does come round it is a no-op rather than a duplicate.
 */
export async function recordOutgoing(
  accountId: number,
  ownerUserId: number,
  message: { chatId: string; messageId: string; text: string; media?: StoredMedia | null },
): Promise<void> {
  const chat = await prisma.messagingChat.findUnique({
    where: { accountId_chatId: { accountId, chatId: message.chatId } },
    select: { name: true, kind: true },
  });
  await ingestMessages(accountId, ownerUserId, [
    {
      chatId: message.chatId,
      chatName: chat?.name ?? message.chatId.split('@')[0] ?? message.chatId,
      chatKind: chat?.kind === 'group' ? 'group' : 'dm',
      messageId: message.messageId,
      senderName: 'You',
      fromMe: true,
      text: message.text,
      at: new Date(),
      media: message.media ?? null,
    },
  ]);
}

/**
 * Refresh chat metadata without touching messages (names, membership, and —
 * when the provider reports it — last activity, so a chat sorts correctly
 * before its history has been mirrored).
 *
 * Runs on every background pass, so only chats that actually changed are
 * written, and last activity only ever moves forward: a provider's view can
 * lag a message we already mirrored.
 */
export async function upsertChats(
  accountId: number,
  chats: Array<{ chatId: string; name: string; kind: 'dm' | 'group'; lastMessageAt?: Date }>,
): Promise<void> {
  if (chats.length === 0) return;
  const rows = await prisma.messagingChat.findMany({
    where: { accountId, chatId: { in: chats.map((c) => c.chatId) } },
    select: { chatId: true, name: true, kind: true, lastMessageAt: true },
  });
  const existing = new Map(rows.map((r) => [r.chatId, r]));

  for (const chat of chats) {
    const row = existing.get(chat.chatId);
    const newer = Boolean(chat.lastMessageAt && (!row || chat.lastMessageAt > row.lastMessageAt));
    if (row && row.name === chat.name && row.kind === chat.kind && !newer) continue;

    await prisma.messagingChat.upsert({
      where: { accountId_chatId: { accountId, chatId: chat.chatId } },
      create: {
        accountId,
        chatId: chat.chatId,
        kind: chat.kind,
        name: chat.name,
        lastMessageAt: chat.lastMessageAt ?? new Date(0),
      },
      update: {
        name: chat.name,
        kind: chat.kind,
        ...(newer ? { lastMessageAt: chat.lastMessageAt } : {}),
      },
    });
  }
}

export async function listChats(accountId: number, limit = 500): Promise<StoredChat[]> {
  const rows = await prisma.messagingChat.findMany({
    where: { accountId },
    orderBy: { lastMessageAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.chatId,
    kind: r.kind === 'group' ? 'group' : 'dm',
    name: r.name,
    lastMessageTs: r.lastMessageAt.toISOString(),
    unread: r.unreadCount > 0,
  }));
}

/**
 * One thread, oldest-first. `before` pages backwards through history so the
 * console can load older messages on scroll instead of fetching everything.
 */
export async function listThread(
  accountId: number,
  chatId: string,
  limit = 200,
  before?: Date,
): Promise<StoredMessage[]> {
  const rows = await prisma.messagingMessage.findMany({
    where: { accountId, chatId, ...(before ? { at: { lt: before } } : {}) },
    orderBy: { at: 'desc' },
    take: limit,
  });
  return rows.reverse().map(toStoredMessage);
}

/** Reading a thread clears its unread badge. */
export async function markRead(accountId: number, chatId: string, ownerUserId?: number): Promise<boolean> {
  const { count } = await prisma.messagingChat.updateMany({
    where: { accountId, chatId, unreadCount: { gt: 0 } },
    data: { unreadCount: 0 },
  });
  // Other tabs and the sidebar badge learn of the read at once.
  if (count > 0 && ownerUserId) {
    publish(ownerUserId, 'messaging', { accountId, chatIds: [chatId], count: 0, live: false, preview: null });
  }
  return count > 0;
}

/**
 * Adopt the provider's own unread counts, so reading a chat on the phone
 * clears it here (and a chat marked unread there shows up here).
 *
 * `observedAt` is when the provider was asked. A chat written since then — a
 * message ingested, or a read in this app — is left alone: the provider's
 * count predates that write and would undo it. The next pass catches up.
 */
export async function applyProviderUnread(
  accountId: number,
  ownerUserId: number,
  counts: Map<string, number>,
  observedAt: Date,
  options: { skip?: Set<string> } = {},
): Promise<void> {
  if (counts.size === 0) return;
  const rows = await prisma.messagingChat.findMany({
    where: { accountId, chatId: { in: [...counts.keys()] } },
    select: { chatId: true, unreadCount: true },
  });

  const changed: string[] = [];
  for (const row of rows) {
    const wanted = counts.get(row.chatId);
    if (wanted === undefined || wanted === row.unreadCount || options.skip?.has(row.chatId)) continue;
    const { count } = await prisma.messagingChat.updateMany({
      where: { accountId, chatId: row.chatId, updatedAt: { lt: observedAt } },
      data: { unreadCount: wanted },
    });
    if (count > 0) changed.push(row.chatId);
  }
  if (changed.length > 0) {
    publish(ownerUserId, 'messaging', { accountId, chatIds: changed, count: 0, live: false, preview: null });
  }
}

/** Chats with unread messages per linked account, for every provider the user has. */
export async function unreadByAccount(
  userId: number,
): Promise<Array<{ id: number; provider: string; unread: number }>> {
  const accounts = await prisma.messagingAccount.findMany({
    where: { userId },
    select: { id: true, provider: true },
  });
  const unread = await unreadChatCounts(accounts.map((a) => a.id));
  return accounts.map((a) => ({ id: a.id, provider: a.provider, unread: unread.get(a.id) ?? 0 }));
}

export async function counts(accountId: number): Promise<{ chats: number; messages: number }> {
  const [chats, messages] = await Promise.all([
    prisma.messagingChat.count({ where: { accountId } }),
    prisma.messagingMessage.count({ where: { accountId } }),
  ]);
  return { chats, messages };
}

/** How many chats have unread messages, per account — the account switcher's badges. */
export async function unreadChatCounts(accountIds: number[]): Promise<Map<number, number>> {
  if (accountIds.length === 0) return new Map();
  const rows = await prisma.messagingChat.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accountIds }, unreadCount: { gt: 0 } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.accountId, r._count._all]));
}

/** How many messages are mirrored per chat — compared against the provider's own counts. */
export async function messageCountsByChat(accountId: number): Promise<Map<string, number>> {
  const rows = await prisma.messagingMessage.groupBy({
    by: ['chatId'],
    where: { accountId },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.chatId, r._count._all]));
}

/** Which of these provider message ids are already mirrored for the chat. */
export async function existingMessageIds(
  accountId: number,
  chatId: string,
  messageIds: string[],
): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();
  const rows = await prisma.messagingMessage.findMany({
    where: { accountId, chatId, messageId: { in: messageIds } },
    select: { messageId: true },
  });
  return new Set(rows.map((r) => r.messageId));
}

/** Look up a stored attachment descriptor so the media route can set headers. */
export async function findMedia(
  accountId: number,
  chatId: string,
  ref: string,
): Promise<StoredMedia | null> {
  const row = await prisma.messagingMessage.findFirst({
    where: { accountId, chatId, mediaRef: ref },
    select: { mediaKind: true, mediaRef: true, mediaMime: true, mediaName: true, mediaSize: true },
  });
  if (!row?.mediaKind) return null;
  return {
    kind: row.mediaKind as StoredMedia['kind'],
    ref: row.mediaRef ?? '',
    mimeType: row.mediaMime,
    fileName: row.mediaName,
    sizeBytes: row.mediaSize,
  };
}
