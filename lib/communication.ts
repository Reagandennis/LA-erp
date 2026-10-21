import 'server-only';

import { notifyNotificationsChanged } from '@/lib/notification-events';
import { prisma } from '@/lib/prisma';
import { broadcastToMembers } from '@/lib/chat-bus';

export type ConversationMemberSummary = {
  id: number;
  name: string;
  email: string;
};

export type MessageSummary = {
  id: number;
  conversationId: number;
  senderId: number;
  senderName: string;
  body: string;
  createdAt: string;
  /** Other members who have read this message (never includes the sender). */
  readBy: number[];
  /** How many members other than the sender the message is addressed to. */
  recipientCount: number;
};

/** Broadcast when someone catches up, so senders' receipts update live. */
export type ReadReceipt = {
  conversationId: number;
  userId: number;
  lastReadAt: string;
};

export type ConversationSummary = {
  id: number;
  type: string;
  title: string | null;
  members: ConversationMemberSummary[];
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  updatedAt: string;
};

export type MessageableUser = {
  id: number;
  name: string;
  email: string;
};

/** Active users the current user can start a conversation with. */
export async function listMessageableUsers(userId: number): Promise<MessageableUser[]> {
  return prisma.user.findMany({
    where: { status: 'active', id: { not: userId } },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
}

/** Returns the member user ids of a conversation, or null if the user is not a member. */
export async function getConversationMemberIds(
  conversationId: number,
  userId: number,
): Promise<number[] | null> {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  const ids = members.map((m) => m.userId);
  if (!ids.includes(userId)) return null;
  return ids;
}

/** List every conversation the user belongs to, newest activity first. */
export async function listConversationsForUser(userId: number): Promise<ConversationSummary[]> {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId },
    select: { conversationId: true, lastReadAt: true },
  });
  if (memberships.length === 0) return [];

  const lastReadByConversation = new Map<number, Date | null>();
  for (const m of memberships) {
    lastReadByConversation.set(m.conversationId, m.lastReadAt);
  }
  const conversationIds = memberships.map((m) => m.conversationId);

  const conversations = await prisma.conversation.findMany({
    where: { id: { in: conversationIds } },
    orderBy: { updatedAt: 'desc' },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const summaries: ConversationSummary[] = [];
  for (const conv of conversations) {
    const lastRead = lastReadByConversation.get(conv.id) ?? null;
    const lastMessage = conv.messages[0] ?? null;

    const unreadCount = await prisma.message.count({
      where: {
        conversationId: conv.id,
        senderId: { not: userId },
        ...(lastRead ? { createdAt: { gt: lastRead } } : {}),
      },
    });

    summaries.push({
      id: conv.id,
      type: conv.type,
      title: conv.title,
      members: conv.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      })),
      lastMessage: lastMessage?.body ?? null,
      lastMessageAt: lastMessage?.createdAt.toISOString() ?? null,
      unreadCount,
      updatedAt: conv.updatedAt.toISOString(),
    });
  }

  return summaries;
}

/** Fetch messages of a conversation the user belongs to. Returns null if not a member. */
export async function listMessages(
  conversationId: number,
  userId: number,
): Promise<MessageSummary[] | null> {
  const memberIds = await getConversationMemberIds(conversationId, userId);
  if (!memberIds) return null;

  const [messages, members] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { sender: { select: { name: true } } },
    }),
    prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true, lastReadAt: true },
    }),
  ]);

  return messages.map((m) => {
    // A member has read the message when they caught up at or after it landed.
    const readBy = members
      .filter(
        (member) =>
          member.userId !== m.senderId &&
          member.lastReadAt != null &&
          member.lastReadAt.getTime() >= m.createdAt.getTime(),
      )
      .map((member) => member.userId);

    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      senderName: m.sender.name,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      readBy,
      recipientCount: Math.max(0, members.length - 1),
    };
  });
}

/** Find an existing 1:1 conversation between two users, or create one. */
export async function getOrCreateDirectConversation(
  userId: number,
  otherUserId: number,
): Promise<number> {
  if (userId === otherUserId) {
    throw new Error('Cannot start a conversation with yourself');
  }

  const other = await prisma.user.findFirst({
    where: { id: otherUserId, status: 'active' },
    select: { id: true },
  });
  if (!other) throw new Error('User not found');

  // Find a direct conversation that has exactly these two members.
  const mine = await prisma.conversationMember.findMany({
    where: { userId },
    select: { conversationId: true },
  });
  const candidates = await prisma.conversation.findMany({
    where: {
      type: 'direct',
      id: { in: mine.map((m) => m.conversationId) },
      members: { some: { userId: otherUserId } },
    },
    include: { members: { select: { userId: true } } },
  });
  const existing = candidates.find(
    (c) => c.members.length === 2 && c.members.every((m) => m.userId === userId || m.userId === otherUserId),
  );
  if (existing) return existing.id;

  const created = await prisma.conversation.create({
    data: {
      type: 'direct',
      createdById: userId,
      members: { create: [{ userId }, { userId: otherUserId }] },
    },
    select: { id: true },
  });
  return created.id;
}

/** Mark a conversation as read for a user (clears its unread badge + message notifications). */
export async function markConversationRead(conversationId: number, userId: number): Promise<void> {
  const memberIds = await getConversationMemberIds(conversationId, userId);
  if (!memberIds) return;

  const lastReadAt = new Date();

  await prisma.conversationMember.updateMany({
    where: { conversationId, userId },
    data: { lastReadAt },
  });
  await prisma.messageNotification.updateMany({
    where: { userId, conversationId, readAt: null },
    data: { readAt: new Date() },
  });
  notifyNotificationsChanged(userId);

  // Tell the other members so their sent-message receipts update without a poll.
  const receipt: ReadReceipt = {
    conversationId,
    userId,
    lastReadAt: lastReadAt.toISOString(),
  };
  broadcastToMembers(
    memberIds.filter((id) => id !== userId),
    'read',
    receipt,
  );
}

/**
 * Persist a message, notify the other members, and push it over SSE.
 * Returns null if the user is not a member of the conversation.
 */
export async function sendMessage(
  conversationId: number,
  userId: number,
  body: string,
): Promise<MessageSummary | null> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Message body is required');

  const memberIds = await getConversationMemberIds(conversationId, userId);
  if (!memberIds) return null;

  const sender = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  const senderName = sender?.name ?? 'Unknown';

  const message = await prisma.message.create({
    data: { conversationId, senderId: userId, body: trimmed },
  });

  // Bump conversation activity + mark the sender caught up.
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
  await prisma.conversationMember.updateMany({
    where: { conversationId, userId },
    data: { lastReadAt: new Date() },
  });

  const recipientIds = memberIds.filter((id) => id !== userId);
  const preview = trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;

  if (recipientIds.length > 0) {
    await prisma.messageNotification.createMany({
      data: recipientIds.map((recipientId) => ({
        userId: recipientId,
        messageId: message.id,
        conversationId,
        type: 'message.received',
        message: `${senderName}: ${preview}`,
      })),
    });
    notifyNotificationsChanged(recipientIds);
  }

  const summary: MessageSummary = {
    id: message.id,
    conversationId,
    senderId: userId,
    senderName,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    readBy: [],
    recipientCount: recipientIds.length,
  };

  // Live push to every member (including the sender's other open tabs).
  broadcastToMembers(memberIds, 'message', summary);

  return summary;
}

type MessageNotificationRow = {
  id: number;
  conversationId: number;
  type: string;
  message: string;
  createdAt: Date;
  readAt: Date | null;
};

export async function listMessageNotifications(userId: number) {
  const rows = (await prisma.messageNotification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      conversationId: true,
      type: true,
      message: true,
      createdAt: true,
      readAt: true,
    },
  })) as MessageNotificationRow[];

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    type: row.type,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  }));
}

export async function markMessageNotificationsRead(userId: number, ids: number[]): Promise<number> {
  const normalized = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (normalized.length === 0) return 0;
  const result = await prisma.messageNotification.updateMany({
    where: { userId, id: { in: normalized } },
    data: { readAt: new Date() },
  });
  if (result.count > 0) notifyNotificationsChanged(userId);
  return result.count;
}
