import 'server-only';

/**
 * A tiny in-process conversation store shared by the polling-based messaging
 * backends (Telegram Bot API, signal-cli). Neither of those exposes a
 * browsable message history the way the WhatsApp/wacli mirror does — the bot
 * API only hands you *new* updates, and `signal-cli receive` pops messages off
 * a queue — so we accumulate what we observe here.
 *
 * This lives in module memory, which means it is only durable while the Node
 * process stays up. That is the same constraint the WhatsApp integration
 * already documents: run the app as a long-lived server (`next start` under a
 * process manager), not on a serverless platform. History resets on restart.
 */

export type ChatKind = 'dm' | 'group';

export interface StoredChat {
  id: string;
  kind: ChatKind;
  name: string;
  lastMessageTs: string;
  unread: boolean;
}

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

/**
 * Provider-agnostic descriptor for an attachment.
 *
 * `ref` is an opaque, provider-specific token that `GET /api/<service>/media`
 * can resolve back into bytes — a signal-cli attachment id, a Telegram message
 * id, a wacli message id. It is never a filesystem path: the media route
 * resolves it through the provider, so a crafted value can't escape the store.
 */
export interface StoredMedia {
  kind: MediaKind;
  ref: string;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  senderName: string;
  fromMe: boolean;
  /** Caption when the message carries media, otherwise the message body. */
  text: string;
  timestamp: string;
  media?: StoredMedia | null;
}

const MAX_MESSAGES_PER_CHAT = 500;

export class ConversationStore {
  private chats = new Map<string, StoredChat>();
  private threads = new Map<string, StoredMessage[]>();
  private seenIds = new Map<string, Set<string>>();

  /** Record (or refresh) a chat's metadata. */
  upsertChat(chat: StoredChat): void {
    const existing = this.chats.get(chat.id);
    this.chats.set(chat.id, {
      ...existing,
      ...chat,
      // Keep the most recent activity timestamp we've seen.
      lastMessageTs:
        existing && +new Date(existing.lastMessageTs) > +new Date(chat.lastMessageTs)
          ? existing.lastMessageTs
          : chat.lastMessageTs,
      unread: chat.unread || existing?.unread || false,
    });
  }

  /**
   * Append a message to its thread, de-duplicating by message id. Updates the
   * owning chat's last-activity timestamp and (for inbound messages) its unread
   * flag. Returns true if the message was new.
   */
  addMessage(message: StoredMessage, chat: Omit<StoredChat, 'lastMessageTs' | 'unread'>): boolean {
    let seen = this.seenIds.get(message.chatId);
    if (!seen) {
      seen = new Set<string>();
      this.seenIds.set(message.chatId, seen);
    }
    if (seen.has(message.id)) return false;
    seen.add(message.id);

    const thread = this.threads.get(message.chatId) ?? [];
    thread.push(message);
    thread.sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
    if (thread.length > MAX_MESSAGES_PER_CHAT) {
      thread.splice(0, thread.length - MAX_MESSAGES_PER_CHAT);
    }
    this.threads.set(message.chatId, thread);

    this.upsertChat({
      ...chat,
      lastMessageTs: message.timestamp,
      unread: !message.fromMe,
    });
    return true;
  }

  listChats(): StoredChat[] {
    return [...this.chats.values()].sort(
      (a, b) => +new Date(b.lastMessageTs) - +new Date(a.lastMessageTs),
    );
  }

  listThread(chatId: string, limit = 200): StoredMessage[] {
    const thread = this.threads.get(chatId) ?? [];
    // Reading a thread clears its unread marker.
    const chat = this.chats.get(chatId);
    if (chat?.unread) this.chats.set(chatId, { ...chat, unread: false });
    return thread.slice(Math.max(0, thread.length - limit));
  }

  counts(): { chats: number; messages: number } {
    let messages = 0;
    for (const thread of this.threads.values()) messages += thread.length;
    return { chats: this.chats.size, messages };
  }
}
