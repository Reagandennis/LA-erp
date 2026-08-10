import 'server-only';

import { ConversationStore, type StoredMessage } from './messaging-store';

/**
 * Telegram integration via the official Bot API (https://core.telegram.org/bots/api).
 *
 * A bot only receives messages from chats it participates in, and the Bot API
 * has no "fetch history" call — you long-poll `getUpdates` and accumulate what
 * arrives. We keep that running total in an in-process ConversationStore (see
 * its note about server lifetime). A bot can send to any chat it has already
 * seen a message from.
 *
 * Setup:
 *   1. Create a bot with @BotFather and copy its token.
 *   2. Set TELEGRAM_BOT_TOKEN.
 *   3. Message the bot (or add it to a group and grant it message access) so it
 *      starts receiving updates. Group privacy mode must be off for it to see
 *      all group messages (@BotFather → Bot Settings → Group Privacy).
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN   bot token from BotFather (required)
 */

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
const API_BASE = 'https://api.telegram.org';

const store = new ConversationStore();
let updateOffset = 0;
let botUsername: string | null = null;
let lastPollOk = false;

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function callApi<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const res = await fetch(`${API_BASE}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => null)) as TelegramApiResponse<T> | null;
  if (!data || !data.ok || data.result === undefined) {
    throw new Error(data?.description || `Telegram API ${method} failed (${res.status})`);
  }
  return data.result;
}

interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
}

function chatName(chat: TgChat): string {
  if (chat.title) return chat.title;
  const full = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
  return full || (chat.username ? `@${chat.username}` : String(chat.id));
}

function senderName(msg: TgMessage): string {
  const u = msg.from;
  if (!u) return chatName(msg.chat);
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return full || (u.username ? `@${u.username}` : String(u.id));
}

function ingest(msg: TgMessage): void {
  const kind = msg.chat.type === 'private' ? 'dm' : 'group';
  const text = msg.text ?? msg.caption ?? '';
  const stored: StoredMessage = {
    id: String(msg.message_id),
    chatId: String(msg.chat.id),
    senderName: senderName(msg),
    fromMe: Boolean(msg.from?.is_bot),
    text,
    timestamp: new Date(msg.date * 1000).toISOString(),
  };
  store.addMessage(stored, {
    id: String(msg.chat.id),
    kind,
    name: chatName(msg.chat),
  });
}

/** Long-poll (non-blocking) for new updates and fold them into the store. */
async function pollUpdates(): Promise<void> {
  if (!TOKEN) return;
  try {
    const updates = await callApi<TgUpdate[]>('getUpdates', {
      offset: updateOffset || undefined,
      timeout: 0,
      allowed_updates: ['message', 'channel_post'],
    });
    for (const u of updates) {
      updateOffset = Math.max(updateOffset, u.update_id + 1);
      const msg = u.message ?? u.channel_post;
      if (msg) ingest(msg);
    }
    lastPollOk = true;
  } catch {
    lastPollOk = false;
  }
}

export interface TelegramStatus {
  available: boolean;
  authenticated: boolean;
  connected: boolean;
  label: string | null;
  counts: { chats: number; messages: number };
  hint?: string;
  error?: string;
}

export async function getStatus(): Promise<TelegramStatus> {
  if (!TOKEN) {
    return {
      available: false,
      authenticated: false,
      connected: false,
      label: null,
      counts: store.counts(),
      hint: 'Set TELEGRAM_BOT_TOKEN (from @BotFather) on the server.',
    };
  }
  try {
    const me = await callApi<TgUser>('getMe');
    botUsername = me.username ? `@${me.username}` : me.first_name ?? null;
    await pollUpdates();
    return {
      available: true,
      authenticated: true,
      connected: lastPollOk,
      label: botUsername,
      counts: store.counts(),
    };
  } catch (e) {
    return {
      available: false,
      authenticated: false,
      connected: false,
      label: null,
      counts: store.counts(),
      error: e instanceof Error ? e.message : 'Telegram unavailable',
    };
  }
}

export async function listChats() {
  await pollUpdates();
  return store.listChats();
}

export async function listThread(chatId: string, limit = 200) {
  await pollUpdates();
  return store.listThread(chatId, limit);
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendText(chatId: string, message: string): Promise<SendResult> {
  try {
    const sent = await callApi<TgMessage>('sendMessage', { chat_id: chatId, text: message });
    ingest({ ...sent, from: { id: 0, is_bot: true, first_name: botUsername ?? 'Bot' } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}
