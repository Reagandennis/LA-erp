import 'server-only';

import { Api, TelegramClient } from 'telegram';
import { computeCheck } from 'telegram/Password';
import { StringSession } from 'telegram/sessions';

import type { MediaKind, StoredChat, StoredMessage, StoredMedia } from './messaging-store';
import { deleteAccount, getAccount, saveAccount } from './messaging-accounts';
import { hasCache, MAX_CACHED_BYTES, writeCache } from './messaging-media-cache';
import { ingestMessages, upsertChats, type IngestMessage } from './messaging-repo';

/**
 * Telegram integration over MTProto, signed in as a *user account* (GramJS).
 *
 * This deliberately does NOT use the Bot API. A bot can only see chats it is a
 * member of and has no history endpoint, so it can never show your own
 * conversations. Signing in as the account — the same thing Telegram Desktop
 * does — gives the full dialog list, real history, and media, which is what the
 * WhatsApp/wacli module provides.
 *
 * Because Telegram serves history from its own servers, there is no local
 * mirror and no ConversationStore here: every read is a live query, so history
 * survives restarts (unlike the Signal module, whose queue is drain-once).
 *
 * Each platform user signs in to their OWN Telegram account: sessions are keyed
 * by platform user id, so one person's dialogs are never visible to another.
 * Users can sign in either by scanning a QR code (see lib/messaging-link.ts) or
 * with phone number → login code → 2FA password.
 *
 * Setup:
 *   1. Create an application at https://my.telegram.org → API development tools.
 *   2. Set TELEGRAM_API_ID and TELEGRAM_API_HASH on the server (shared by all
 *      users — they identify the *app*, not the account).
 *   3. Each user links their account from the module UI. The resulting session
 *      string is stored in MessagingAccount and is a full account credential —
 *      it is never returned to the browser.
 *
 * Env:
 *   TELEGRAM_API_ID     numeric app id from my.telegram.org (required)
 *   TELEGRAM_API_HASH   app hash from my.telegram.org (required)
 */

const API_ID = Number((process.env.TELEGRAM_API_ID ?? '').trim());
const API_HASH = (process.env.TELEGRAM_API_HASH ?? '').trim();
const GROUP_PREFIX = 'group:';

declare global {
  var telegramClientsGlobal: Map<number, TelegramClient> | undefined;
  var telegramPendingLoginsGlobal: Map<number, PendingLogin> | undefined;
}

interface PendingLogin {
  phoneNumber: string;
  phoneCodeHash: string;
  client: TelegramClient;
  startedAt: number;
}

/** A half-finished login expires so a stale client can't linger forever. */
const PENDING_LOGIN_TTL_MS = 15 * 60 * 1000;

/** Live clients, one per signed-in platform user. */
function clients(): Map<number, TelegramClient> {
  globalThis.telegramClientsGlobal ??= new Map();
  return globalThis.telegramClientsGlobal;
}

function pendingLogins(): Map<number, PendingLogin> {
  globalThis.telegramPendingLoginsGlobal ??= new Map();
  return globalThis.telegramPendingLoginsGlobal;
}

export function isConfigured(): boolean {
  return Number.isFinite(API_ID) && API_ID > 0 && API_HASH.length > 0;
}

function newClient(session: string): TelegramClient {
  return new TelegramClient(new StringSession(session), API_ID, API_HASH, {
    connectionRetries: 3,
    // Presenting as a normal client keeps Telegram from flagging the session.
    deviceModel: 'LA-ERP',
    appVersion: '1.0.0',
    systemVersion: 'server',
  });
}

/**
 * The connected client for one platform user — or null when the app isn't
 * configured or that user hasn't linked. Clients are cached per user so each
 * request reuses one MTProto socket instead of opening a new one.
 */
async function getClient(userId: number): Promise<TelegramClient | null> {
  if (!isConfigured()) return null;

  const cached = clients().get(userId);
  if (cached?.connected) return cached;

  const account = await getAccount(userId, 'telegram');
  if (!account?.session) {
    console.error(`[telegram] user ${userId} has no linked account`);
    return null;
  }

  const client = cached ?? newClient(account.session);
  try {
    if (!client.connected) await client.connect();
    if (!(await client.isUserAuthorized())) {
      console.error(`[telegram] user ${userId}: saved session is no longer authorised`);
      return null;
    }
  } catch (error) {
    console.error(`[telegram] user ${userId}: connect failed:`, describe(error));
    return null;
  }
  clients().set(userId, client);
  return client;
}

/** Adopt an already-authorised client for a user and persist its session. */
export async function adoptClient(
  userId: number,
  client: TelegramClient,
  phoneNumber: string,
): Promise<string> {
  const session = String(client.session.save());
  const label = await describeMe(client, phoneNumber);
  await saveAccount({ userId, provider: 'telegram', handle: phoneNumber, label, session });
  clients().set(userId, client);
  return label;
}

/** Best-effort display name for the signed-in account. */
async function describeMe(client: TelegramClient, fallback: string): Promise<string> {
  try {
    const me = (await client.getMe()) as Api.User;
    const name = `${me?.firstName ?? ''} ${me?.lastName ?? ''}`.trim();
    return name || me?.username || fallback;
  } catch {
    return fallback;
  }
}

export function newAuthClient(): TelegramClient {
  return newClient('');
}

export function apiCredentials(): { apiId: number; apiHash: string } {
  return { apiId: API_ID, apiHash: API_HASH };
}

// --- Auth flow -------------------------------------------------------------

export interface LoginStep {
  ok: boolean;
  stage: 'code-sent' | 'password-needed' | 'signed-in' | 'error';
  error?: string;
  label?: string;
}

/** Step 1 — ask Telegram to deliver a login code to the account. */
export async function startLogin(userId: number, phoneNumber: string): Promise<LoginStep> {
  if (!isConfigured()) {
    return { ok: false, stage: 'error', error: 'TELEGRAM_API_ID / TELEGRAM_API_HASH are not set.' };
  }
  const phone = phoneNumber.trim();
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    return { ok: false, stage: 'error', error: 'Enter the number in E.164 form, e.g. +254712345678.' };
  }

  try {
    const client = newClient('');
    await client.connect();
    const { phoneCodeHash } = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
    pendingLogins().set(userId, {
      phoneNumber: phone,
      phoneCodeHash,
      client,
      startedAt: Date.now(),
    });
    return { ok: true, stage: 'code-sent' };
  } catch (e) {
    return { ok: false, stage: 'error', error: describe(e) };
  }
}

function takePending(userId: number): PendingLogin | null {
  const pending = pendingLogins().get(userId);
  if (!pending) return null;
  if (Date.now() - pending.startedAt > PENDING_LOGIN_TTL_MS) {
    void pending.client.disconnect().catch(() => {});
    pendingLogins().delete(userId);
    return null;
  }
  return pending;
}

/** Step 2 — submit the code. May report that a 2FA password is still required. */
export async function submitCode(userId: number, code: string): Promise<LoginStep> {
  const pending = takePending(userId);
  if (!pending) {
    return { ok: false, stage: 'error', error: 'The login timed out. Start again.' };
  }

  try {
    await pending.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: pending.phoneNumber,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: code.trim(),
      }),
    );
    return finishLogin(userId, pending);
  } catch (e) {
    if (describe(e).includes('SESSION_PASSWORD_NEEDED')) {
      return { ok: true, stage: 'password-needed' };
    }
    return { ok: false, stage: 'error', error: describe(e) };
  }
}

/** Step 3 (only when 2FA is on) — submit the cloud password. */
export async function submitPassword(userId: number, password: string): Promise<LoginStep> {
  const pending = takePending(userId);
  if (!pending) {
    return { ok: false, stage: 'error', error: 'The login timed out. Start again.' };
  }

  try {
    const pwd = await pending.client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(pwd, password);
    await pending.client.invoke(new Api.auth.CheckPassword({ password: check }));
    return finishLogin(userId, pending);
  } catch (e) {
    return { ok: false, stage: 'error', error: describe(e) };
  }
}

async function finishLogin(userId: number, pending: PendingLogin): Promise<LoginStep> {
  const label = await adoptClient(userId, pending.client, pending.phoneNumber);
  pendingLogins().delete(userId);
  return { ok: true, stage: 'signed-in', label };
}

/** Sign out one user: revoke the session with Telegram, then forget it locally. */
export async function logout(userId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = await getClient(userId);
    if (client) {
      await client.invoke(new Api.auth.LogOut());
      await client.disconnect();
    }
  } catch {
    // Even if the revoke fails, forget the credential locally.
  }
  clients().delete(userId);
  await deleteAccount(userId, 'telegram');
  return { ok: true };
}

// --- Status ----------------------------------------------------------------

export interface TelegramStatus {
  available: boolean;
  authenticated: boolean;
  connected: boolean;
  label: string | null;
  counts: { chats: number; messages: number };
  hint?: string;
  error?: string;
}

export async function getStatus(userId: number): Promise<TelegramStatus> {
  const base = { counts: { chats: 0, messages: 0 } };

  if (!isConfigured()) {
    return {
      ...base,
      available: false,
      authenticated: false,
      connected: false,
      label: null,
      hint: 'Set TELEGRAM_API_ID and TELEGRAM_API_HASH (from my.telegram.org) on the server.',
    };
  }

  const account = await getAccount(userId, 'telegram');
  if (!account) {
    return {
      ...base,
      available: true,
      authenticated: false,
      connected: false,
      label: null,
      hint: 'Scan the QR code with Telegram, or sign in with your phone number.',
    };
  }

  try {
    const client = await getClient(userId);
    if (!client) {
      return {
        ...base,
        available: true,
        authenticated: false,
        connected: false,
        label: account.label,
        hint: 'Your saved Telegram session is no longer valid. Link again.',
      };
    }
    return {
      ...base,
      available: true,
      authenticated: true,
      connected: client.connected ?? false,
      label: account.label ?? account.handle,
    };
  } catch (e) {
    return {
      ...base,
      available: true,
      authenticated: false,
      connected: false,
      label: account.label,
      error: describe(e),
    };
  }
}

// --- Reads -----------------------------------------------------------------

/** Chat ids keep a `group:` prefix so the UI can style groups consistently. */
function chatIdOf(peerId: bigint | string, isGroup: boolean): string {
  return isGroup ? `${GROUP_PREFIX}${peerId}` : String(peerId);
}

function rawPeerId(chatId: string): string {
  return chatId.startsWith(GROUP_PREFIX) ? chatId.slice(GROUP_PREFIX.length) : chatId;
}

/**
 * A chat started from the "new chat" box is addressed by @username until
 * Telegram tells us its real peer id. GramJS resolves usernames natively, so
 * this only needs to hand the string through unchanged — but the leading `@`
 * must survive, which `rawPeerId` alone would not guarantee for future formats.
 */
function sendTarget(chatId: string): string {
  return chatId.startsWith('@') ? chatId : rawPeerId(chatId);
}

export async function listChats(userId: number, limit = 200): Promise<StoredChat[]> {
  const client = await getClient(userId);
  if (!client) return [];

  const dialogs = await client.getDialogs({ limit });
  const chats: StoredChat[] = [];
  for (const dialog of dialogs) {
    const id = dialog.id;
    if (!id) continue;
    const isGroup = Boolean(dialog.isGroup || dialog.isChannel);
    const ts = dialog.message?.date ? new Date(dialog.message.date * 1000) : new Date(0);
    chats.push({
      id: chatIdOf(BigInt(id.toString()), isGroup),
      kind: isGroup ? 'group' : 'dm',
      name: dialog.title || dialog.name || String(id),
      lastMessageTs: ts.toISOString(),
      unread: (dialog.unreadCount ?? 0) > 0,
    });
  }
  return chats;
}

/** Classify a Telegram message's attachment into the shared media descriptor. */
function mediaOf(message: Api.Message): StoredMedia | null {
  if (message.photo) {
    return { kind: 'image', ref: String(message.id), mimeType: 'image/jpeg', fileName: null, sizeBytes: null };
  }

  const document = message.document as Api.Document | undefined;
  if (!document) return null;

  const mime = (document.mimeType ?? '').toLowerCase();
  const nameAttr = document.attributes?.find(
    (a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename,
  );
  const isSticker = document.attributes?.some((a) => a instanceof Api.DocumentAttributeSticker);

  const kind: MediaKind = isSticker
    ? 'sticker'
    : mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : 'document';

  return {
    kind,
    ref: String(message.id),
    mimeType: document.mimeType ?? null,
    fileName: nameAttr?.fileName ?? null,
    sizeBytes: document.size ? Number(document.size) : null,
  };
}

export async function listThread(userId: number, chatId: string, limit = 200): Promise<StoredMessage[]> {
  const client = await getClient(userId);
  if (!client) return [];

  const messages = await client.getMessages(rawPeerId(chatId), { limit });
  const out: StoredMessage[] = [];
  // getMessages returns newest-first; the console renders oldest-first.
  for (const message of [...messages].reverse()) {
    if (!(message instanceof Api.Message)) continue;
    const media = mediaOf(message);
    const text = message.message ?? '';
    if (!text && !media) continue; // service messages (joins, pins, calls)

    let senderName = 'Unknown';
    try {
      const sender = await message.getSender();
      const user = sender as Api.User | Api.Channel | null;
      if (user && 'firstName' in user) {
        senderName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.username || 'Unknown';
      } else if (user && 'title' in user) {
        senderName = user.title ?? 'Unknown';
      }
    } catch {
      // Sender may be unresolvable (deleted account); the fallback is fine.
    }

    out.push({
      id: String(message.id),
      chatId,
      senderName: message.out ? 'You' : senderName,
      fromMe: Boolean(message.out),
      text,
      timestamp: new Date(message.date * 1000).toISOString(),
      media,
    });
  }
  return out;
}

/**
 * Mirror one account into Postgres and keep it live.
 *
 * Telegram pushes updates over the existing MTProto connection, so there is no
 * polling here at all: a NewMessage event writes straight through to the
 * database and fans out an SSE event. The initial pass backfills recent history
 * so a freshly linked account isn't an empty console.
 */
export async function startTelegramMirror(userId: number, accountId: number): Promise<void> {
  const client = await getClient(userId);
  if (!client) return;

  if (mirrored().has(userId)) return;
  mirrored().add(userId);

  // Live updates first, so nothing that arrives during the backfill is missed.
  const { NewMessage } = await import('telegram/events');
  client.addEventHandler(async (event: { message?: Api.Message }) => {
    const message = event.message;
    if (!(message instanceof Api.Message)) return;
    try {
      await ingestOne(accountId, userId, message);
    } catch {
      // One bad update must never kill the handler.
    }
  }, new NewMessage({}));

  // Backfill runs in the background: the chat list is written first so the
  // console fills immediately, then history is fetched chat by chat.
  void backfillTelegram(client, userId, accountId).catch((error) => {
    console.error('[telegram] backfill failed:', describe(error));
  });
}

/** How many conversations to mirror, and how deep into each. */
const BACKFILL_DIALOGS = 200;
const BACKFILL_MESSAGES = 50;

async function backfillTelegram(
  client: TelegramClient,
  userId: number,
  accountId: number,
): Promise<void> {
  const dialogs = await client.getDialogs({ limit: BACKFILL_DIALOGS });

  // Write every conversation up front — previously a chat only appeared once one
  // of its messages had been ingested, so a slow or failed history fetch left
  // most of the list missing.
  await upsertChats(
    accountId,
    dialogs
      .filter((d) => d.id)
      .map((d) => {
        const isGroup = Boolean(d.isGroup || d.isChannel);
        return {
          chatId: chatIdOf(BigInt(d.id!.toString()), isGroup),
          name: d.title || d.name || String(d.id),
          kind: isGroup ? ('group' as const) : ('dm' as const),
          lastMessageAt: d.message?.date ? new Date(d.message.date * 1000) : new Date(0),
        };
      }),
  );

  for (const dialog of dialogs) {
    if (!dialog.id) continue;
    const isGroup = Boolean(dialog.isGroup || dialog.isChannel);
    const chatId = chatIdOf(BigInt(dialog.id.toString()), isGroup);
    const chatName = dialog.title || dialog.name || chatId;
    try {
      const messages = await client.getMessages(rawPeerId(chatId), { limit: BACKFILL_MESSAGES });
      const batch: IngestMessage[] = [];
      for (const message of [...messages].reverse()) {
        const item = await toIngest(message, chatId, chatName, isGroup);
        if (!item) continue;
        batch.push(item);
        if (item.media && message instanceof Api.Message) {
          await cacheMediaFor(accountId, chatId, message, item.media);
        }
      }
      await ingestMessages(accountId, userId, batch);
    } catch {
      // A chat we can't read (restricted channel, deleted peer) must not stop
      // the rest of the backfill.
      continue;
    }
  }
}

/** Resolve one Telegram message into the shared ingest shape. */
async function toIngest(
  message: Api.Message | unknown,
  chatId: string,
  chatName: string,
  isGroup: boolean,
): Promise<IngestMessage | null> {
  if (!(message instanceof Api.Message)) return null;
  const media = mediaOf(message);
  const text = message.message ?? '';
  if (!text && !media) return null; // service messages (joins, pins, calls)

  let senderName = chatName;
  if (message.out) {
    senderName = 'You';
  } else if (isGroup) {
    // Only group threads display a per-sender name, so only pay for the lookup
    // there — resolving a sender is a round trip.
    try {
      const sender = (await message.getSender()) as Api.User | Api.Channel | null;
      if (sender && 'firstName' in sender) {
        senderName = `${sender.firstName ?? ''} ${sender.lastName ?? ''}`.trim() || sender.username || 'Unknown';
      } else if (sender && 'title' in sender) {
        senderName = sender.title ?? 'Unknown';
      }
    } catch {
      senderName = 'Unknown';
    }
  }

  return {
    chatId,
    chatName,
    chatKind: isGroup ? 'group' : 'dm',
    messageId: String(message.id),
    senderName,
    fromMe: Boolean(message.out),
    text,
    at: new Date(message.date * 1000),
    media,
  };
}

/**
 * Save a message's attachment while we still hold the live object.
 *
 * Re-fetching by id later is unreliable — Telegram answers `MessageEmpty` for
 * some chats — so the only dependable moment to capture media is when it first
 * arrives. Bounded and best-effort: a failure here just means the media route
 * tries the provider instead.
 */
async function cacheMediaFor(
  accountId: number,
  chatId: string,
  message: Api.Message,
  descriptor: StoredMedia,
): Promise<void> {
  if (descriptor.sizeBytes && descriptor.sizeBytes > MAX_CACHED_BYTES) return;
  if (await hasCache(accountId, chatId, descriptor.ref)) return;
  try {
    const bytes = await message.client?.downloadMedia(message);
    if (!bytes) return;
    await writeCache(accountId, chatId, descriptor.ref, {
      bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as unknown as Uint8Array),
      mimeType: descriptor.mimeType || 'application/octet-stream',
      fileName: descriptor.fileName,
    });
  } catch {
    // Best-effort.
  }
}

/** Mirror a single live message. */
async function ingestOne(accountId: number, userId: number, message: Api.Message): Promise<void> {
  const peer = message.peerId;
  const isGroup = !(peer instanceof Api.PeerUser);
  const rawId =
    peer instanceof Api.PeerUser
      ? peer.userId
      : peer instanceof Api.PeerChat
        ? peer.chatId
        : (peer as Api.PeerChannel).channelId;
  const chatId = chatIdOf(BigInt(rawId.toString()), isGroup);

  let chatName = chatId;
  try {
    const chat = (await message.getChat()) as { title?: string; firstName?: string; username?: string } | null;
    chatName = chat?.title || chat?.firstName || chat?.username || chatId;
  } catch {
    // Cosmetic.
  }

  const item = await toIngest(message, chatId, chatName, isGroup);
  if (!item) return;
  if (item.media) await cacheMediaFor(accountId, chatId, message, item.media);
  await ingestMessages(accountId, userId, [item]);
}

declare global {
  var telegramMirroredGlobal: Set<number> | undefined;
}

function mirrored(): Set<number> {
  globalThis.telegramMirroredGlobal ??= new Set();
  return globalThis.telegramMirroredGlobal;
}

export function stopTelegramMirror(userId: number): void {
  mirrored().delete(userId);
  const client = clients().get(userId);
  void client?.disconnect().catch(() => {});
  clients().delete(userId);
}

// --- Writes ----------------------------------------------------------------

export interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendText(userId: number, chatId: string, message: string): Promise<SendResult> {
  const client = await getClient(userId);
  if (!client) return { ok: false, error: 'Telegram is not signed in.' };
  try {
    await client.sendMessage(sendTarget(chatId), { message });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export async function sendMedia(
  userId: number,
  chatId: string,
  file: { bytes: Buffer; mimeType: string; fileName: string },
  caption = '',
): Promise<SendResult> {
  const client = await getClient(userId);
  if (!client) return { ok: false, error: 'Telegram is not linked.' };
  try {
    const upload = new (await import('telegram/client/uploads')).CustomFile(
      file.fileName,
      file.bytes.length,
      file.fileName,
      file.bytes,
    );
    await client.sendFile(sendTarget(chatId), {
      file: upload,
      caption,
      // Photos are compressed by Telegram; everything else stays a document.
      forceDocument: !file.mimeType.startsWith('image/'),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export interface FetchedMedia {
  bytes: Buffer;
  mimeType: string;
  fileName: string | null;
}

/** Download one message's media. `ref` is the message id within `chatId`. */
export async function getMedia(userId: number, chatId: string, ref: string): Promise<FetchedMedia | null> {
  const client = await getClient(userId);
  if (!client) return null;

  const messageId = Number(ref);
  if (!Number.isInteger(messageId) || messageId <= 0) return null;

  try {
    const found = await client.getMessages(rawPeerId(chatId), { ids: [messageId] });
    const message = found?.[0];
    if (!(message instanceof Api.Message)) {
      console.error(`[telegram] media ${chatId}#${ref}: message not found`);
      return null;
    }

    const descriptor = mediaOf(message);
    if (!descriptor) {
      console.error(`[telegram] media ${chatId}#${ref}: message carries no media`);
      return null;
    }

    const bytes = await client.downloadMedia(message);
    if (!bytes) {
      console.error(`[telegram] media ${chatId}#${ref}: download returned nothing`);
      return null;
    }

    return {
      bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as unknown as Uint8Array),
      mimeType: descriptor.mimeType || 'application/octet-stream',
      fileName: descriptor.fileName,
    };
  } catch (error) {
    console.error(`[telegram] media ${chatId}#${ref}:`, describe(error));
    return null;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Telegram request failed';
}
