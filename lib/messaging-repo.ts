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
  chatKind: 'dm' | 'group';
  messageId: string;
  senderName: string;
  fromMe: boolean;
  text: string;
  at: Date;
  media?: StoredMedia | null;
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
): Promise<StoredMessage[]> {
  if (batch.length === 0) return [];

  const fresh: StoredMessage[] = [];

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

    await prisma.messagingChat.upsert({
      where: { accountId_chatId: { accountId, chatId: item.chatId } },
      create: {
        accountId,
        chatId: item.chatId,
        kind: item.chatKind,
        name: item.chatName,
        lastMessageAt: item.at,
        unreadCount: item.fromMe ? 0 : 1,
      },
      update: {
        name: item.chatName,
        lastMessageAt: item.at,
        ...(item.fromMe ? {} : { unreadCount: { increment: 1 } }),
      },
    });
  }

  // Wake any console this user has open. The payload is deliberately small —
  // the client refetches the affected thread rather than trusting the event.
  if (fresh.length > 0) {
    const chatIds = [...new Set(fresh.map((m) => m.chatId))];
    publish(ownerUserId, 'messaging', { chatIds, count: fresh.length });
  }
  return fresh;
}

/** Refresh chat metadata without touching messages (names, membership). */
export async function upsertChats(
  accountId: number,
  chats: Array<{ chatId: string; name: string; kind: 'dm' | 'group'; lastMessageAt?: Date }>,
): Promise<void> {
  for (const chat of chats) {
    await prisma.messagingChat.upsert({
      where: { accountId_chatId: { accountId, chatId: chat.chatId } },
      create: {
        accountId,
        chatId: chat.chatId,
        kind: chat.kind,
        name: chat.name,
        lastMessageAt: chat.lastMessageAt ?? new Date(0),
      },
      update: { name: chat.name, kind: chat.kind },
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
export async function markRead(accountId: number, chatId: string): Promise<void> {
  await prisma.messagingChat.updateMany({
    where: { accountId, chatId, unreadCount: { gt: 0 } },
    data: { unreadCount: 0 },
  });
}

export async function counts(accountId: number): Promise<{ chats: number; messages: number }> {
  const [chats, messages] = await Promise.all([
    prisma.messagingChat.count({ where: { accountId } }),
    prisma.messagingMessage.count({ where: { accountId } }),
  ]);
  return { chats, messages };
}

/** Newest mirrored message time — the high-water mark for incremental backfill. */
export async function latestMessageAt(accountId: number): Promise<Date | null> {
  const row = await prisma.messagingMessage.findFirst({
    where: { accountId },
    orderBy: { at: 'desc' },
    select: { at: true },
  });
  return row?.at ?? null;
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
