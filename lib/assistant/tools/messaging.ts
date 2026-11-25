import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import { listConversationsForUser, listMessages } from '@/lib/communication';

import { asString, type ToolDefinition, ToolRefusal } from '../types';
import { localStamp, matches, optFlag, pageOf, reqId } from './_shared';

/**
 * The internal Communication module, read only: the user's own conversations
 * and the messages in one of them. Nothing here sends a message, and reading
 * through the assistant does not mark a conversation as read (the page does
 * that, and tells the other members; a lookup must not).
 * WhatsApp, Telegram and Signal are not read here at all.
 */
const PAGE_SIZE = 20;
const HREF = '/modules/communication';
/** lib/communication.ts reads at most this many messages of a conversation, oldest first. */
const LIB_MESSAGE_CAP = 200;

const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max)}…` : text);

const listConversationsTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.communication,
  functionDeclaration: {
    name: 'list_my_conversations',
    description:
      "The user's own conversations in the internal Communication module, latest activity first: who is in each, the last message, when, and how many are unread. Never anyone else's. 20 per page.",
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'A member\'s name or the conversation title' },
        unreadOnly: { type: 'boolean' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const unreadOnly = optFlag(args, 'unreadOnly') ?? false;
    // Always the caller's own id: the lib returns only conversations they belong to.
    const conversations = await listConversationsForUser(ctx.userId);
    const others = (c: (typeof conversations)[number]) => c.members.filter((member) => member.id !== ctx.userId).map((member) => member.name);
    const wanted = conversations.filter((c) => (!unreadOnly || c.unreadCount > 0) && matches(q, c.title, ...others(c)));
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      unreadConversations: conversations.filter((c) => c.unreadCount > 0).length,
      conversations: rows.map((c) => {
        const names = others(c);
        return {
          conversationId: c.id,
          with: c.title ?? (names.slice(0, 4).join(', ') || 'Just the user'),
          ...(c.type !== 'direct' ? { type: c.type, members: c.members.length } : {}),
          lastMessage: clip(c.lastMessage, 140),
          lastMessageAt: localStamp(c.lastMessageAt, ctx.timeZone),
          unread: c.unreadCount,
        };
      }),
      timesShownIn: ctx.timeZone,
      href: HREF,
    };
  },
};

const getMessagesTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.communication,
  functionDeclaration: {
    name: 'get_conversation_messages',
    description:
      "The recent messages of one of the user's own internal conversations, newest first: who wrote each, when, and the text. Page 2 goes further back. Reading does not mark it as read, and this cannot send a message.",
    parameters: {
      type: 'object',
      properties: {
        conversationId: { type: 'integer' },
        page: { type: 'integer' },
      },
      required: ['conversationId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'conversationId', 'use list_my_conversations');
    // Null when the caller is not a member: the same answer as a conversation that does not exist.
    const messages = await listMessages(id, ctx.userId);
    if (messages === null) {
      throw new ToolRefusal(`Conversation ${id} was not found among this user's conversations. Find it with list_my_conversations.`);
    }
    const newestFirst = [...messages].reverse();
    const { rows, page, total, more } = pageOf(newestFirst, args, PAGE_SIZE);
    return {
      conversationId: id,
      total,
      page,
      more,
      messages: rows.map((message) => ({
        from: message.senderId === ctx.userId ? 'the user' : message.senderName,
        when: localStamp(message.createdAt, ctx.timeZone),
        text: clip(message.body, 600),
      })),
      // The app itself loads the first 200 of a conversation; a longer one's latest messages are not in this.
      ...(messages.length >= LIB_MESSAGE_CAP
        ? { note: `This conversation is longer than the ${LIB_MESSAGE_CAP} messages the app loads, so its most recent messages may be missing here. Open it in Communication to be sure.` }
        : {}),
      timesShownIn: ctx.timeZone,
      href: HREF,
    };
  },
};

export const internalMessagingTools: ToolDefinition[] = [listConversationsTool, getMessagesTool];
