import 'server-only';

import { execFile } from 'child_process';

import {
  type LinkedAccount,
  listAccountsForProvider,
} from './messaging-accounts';
import { MAX_CACHED_BYTES, prefetchMedia } from './messaging-media-cache';
import {
  applyProviderUnread,
  existingMessageIds,
  ingestMessages,
  messageCountsByChat,
  upsertChats,
  type IngestMessage,
} from './messaging-repo';
import type { MediaKind, StoredMedia, StoredMessage } from './messaging-store';
import { getMedia, markChatRead } from './wacli';
import { runWacli } from './wacli-runtime';

/**
 * Background ingest: providers → Postgres.
 *
 * Nothing here runs on an HTTP request path. That is the whole point — the old
 * design drained `signal-cli receive` inside every status/chats/thread call,
 * which blocked for seconds (74s measured once) and, because `receive` pops the
 * server queue, could lose messages outright if the request died mid-drain.
 *
 * Each provider pushes or polls on its own schedule and writes through
 * `ingestMessages`, which is idempotent and fans out an SSE event.
 */

const SIGNAL_BIN = (process.env.SIGNAL_CLI_BIN ?? '').trim() || 'signal-cli';
const GROUP_PREFIX = 'group:';

declare global {
  var messagingIngestTimersGlobal: Map<string, NodeJS.Timeout> | undefined;
  var messagingIngestBusyGlobal: Set<string> | undefined;
}

function timers(): Map<string, NodeJS.Timeout> {
  globalThis.messagingIngestTimersGlobal ??= new Map();
  return globalThis.messagingIngestTimersGlobal;
}

/** Guards against a slow drain overlapping its own next tick. */
function busy(): Set<string> {
  globalThis.messagingIngestBusyGlobal ??= new Set();
  return globalThis.messagingIngestBusyGlobal;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: process.env },
      (err, stdout, stderr) => {
        if (err && !stdout) reject(new Error(String(stderr || err.message).trim()));
        else resolve(stdout ?? '');
      },
    );
  });
}

/** Same contract as `run`, with wacli located by lib/wacli-runtime.ts. */
async function wacli(args: string[], timeoutMs: number): Promise<string> {
  const { stdout, stderr, error } = await runWacli(args, { timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  if (error && !stdout) throw new Error(String(stderr || error.message).trim());
  return stdout;
}

export function mediaKindFromMime(mime: string): MediaKind {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}

// --- Signal ----------------------------------------------------------------

interface SignalAttachment {
  id?: string;
  contentType?: string | null;
  filename?: string | null;
  size?: number | null;
}

interface SignalData {
  message?: string | null;
  timestamp?: number;
  groupInfo?: { groupId?: string } | null;
  attachments?: SignalAttachment[] | null;
}

interface SignalEnvelope {
  source?: string;
  sourceNumber?: string;
  sourceUuid?: string;
  sourceName?: string;
  timestamp?: number;
  dataMessage?: SignalData | null;
  syncMessage?: { sentMessage?: (SignalData & { destination?: string }) | null } | null;
}

function signalMedia(attachment: SignalAttachment | undefined): StoredMedia | null {
  if (!attachment?.id) return null;
  return {
    kind: mediaKindFromMime(attachment.contentType ?? ''),
    ref: attachment.id,
    mimeType: attachment.contentType ?? null,
    fileName: attachment.filename ?? null,
    sizeBytes: typeof attachment.size === 'number' ? attachment.size : null,
  };
}

function signalToIngest(
  env: SignalEnvelope,
  data: SignalData,
  opts: { fromMe: boolean; destination?: string; groupNames: Map<string, string> },
): IngestMessage | null {
  const text = (data.message ?? '').trim();
  const media = signalMedia(data.attachments?.[0]);
  // An attachment with no caption is still a real message.
  if (!text && !media) return null;

  const sender = env.sourceNumber || env.source || env.sourceUuid || 'unknown';
  const at = new Date(data.timestamp || env.timestamp || Date.now());
  const groupId = data.groupInfo?.groupId;

  if (groupId) {
    const chatId = `${GROUP_PREFIX}${groupId}`;
    return {
      chatId,
      chatName: opts.groupNames.get(groupId) || 'Signal group',
      chatKind: 'group',
      messageId: `${chatId}:${data.timestamp || env.timestamp}`,
      senderName: opts.fromMe ? 'You' : env.sourceName || sender,
      fromMe: opts.fromMe,
      text,
      at,
      media,
    };
  }

  const other = opts.fromMe ? opts.destination || sender : sender;
  return {
    chatId: other,
    chatName: env.sourceName || other,
    chatKind: 'dm',
    messageId: `${other}:${data.timestamp || env.timestamp}`,
    senderName: opts.fromMe ? 'You' : env.sourceName || other,
    fromMe: opts.fromMe,
    text,
    at,
    media,
  };
}

/**
 * Drain Signal's queue for one account into Postgres.
 *
 * `receive` is destructive — whatever it returns is gone from the server — so
 * this is the only place it is ever called, and it writes straight through to
 * the database before the process can be interrupted.
 */
async function drainSignal(account: LinkedAccount): Promise<void> {
  const groupNames = new Map<string, string>();
  try {
    const raw = await run(SIGNAL_BIN, ['-o', 'json', '-a', account.handle, 'listGroups'], 20_000);
    for (const g of JSON.parse(raw) as Array<{ id?: string; name?: string }>) {
      if (g.id && g.name) groupNames.set(g.id, g.name);
    }
  } catch {
    // Group names are cosmetic; a failure here must not stop the drain.
  }

  const out = await run(
    SIGNAL_BIN,
    ['-o', 'json', '-a', account.handle, 'receive', '--timeout', '3'],
    120_000,
  );

  const batch: IngestMessage[] = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let env: SignalEnvelope | undefined;
    try {
      env = (JSON.parse(trimmed) as { envelope?: SignalEnvelope }).envelope;
    } catch {
      continue;
    }
    if (!env) continue;

    if (env.dataMessage) {
      const item = signalToIngest(env, env.dataMessage, { fromMe: false, groupNames });
      if (item) batch.push(item);
    } else if (env.syncMessage?.sentMessage) {
      const sent = env.syncMessage.sentMessage;
      const item = signalToIngest(env, sent, {
        fromMe: true,
        destination: sent.destination,
        groupNames,
      });
      if (item) batch.push(item);
    }
  }

  await ingestMessages(account.id, account.userId, batch);
}

// --- WhatsApp --------------------------------------------------------------

/**
 * A wacli message in either of the two shapes wacli produces:
 *
 *   `messages list`     ChatJID / MsgID, flat MediaType + MediaCaption
 *   `sync --webhook`    Chat / ID, a nested Media object, optional EventType
 *
 * They describe the same record, so both are accepted here; the webhook shape
 * is what makes WhatsApp live, and dropping it meant every inbound message
 * waited for the next backfill.
 */
interface WacliRawMessage {
  ChatJID?: string;
  Chat?: string;
  ChatName?: string;
  MsgID?: string;
  ID?: string;
  SenderJID?: string;
  SenderName?: string;
  Timestamp?: string;
  FromMe?: boolean;
  Text?: string;
  MediaType?: string;
  MediaCaption?: string;
  MimeType?: string;
  Filename?: string;
  Media?: {
    Type?: string;
    Caption?: string;
    Filename?: string;
    MimeType?: string;
    FileLength?: number;
  } | null;
  Revoked?: boolean;
  DeletedForMe?: boolean;
  /** Webhook only; absent means `message`. Receipts and presence are not messages. */
  EventType?: string;
}

function mediaKindFromWacli(type: string): MediaKind {
  if (type === 'image' || type === 'photo') return 'image';
  if (type === 'video' || type === 'gif') return 'video';
  if (type === 'audio' || type === 'ptt' || type === 'voice') return 'audio';
  if (type === 'sticker') return 'sticker';
  return 'document';
}

export function wacliToIngest(raw: WacliRawMessage, chatName?: string): IngestMessage | null {
  if (raw.EventType && raw.EventType !== 'message') return null;
  const chatId = raw.ChatJID || raw.Chat;
  const messageId = raw.MsgID || raw.ID;
  if (!messageId || !chatId || raw.DeletedForMe) return null;

  const isGroup = chatId.endsWith('@g.us');
  const caption = raw.MediaCaption || raw.Media?.Caption || '';
  const text = raw.Text || caption;
  const mediaType = (raw.MediaType || raw.Media?.Type || '').toLowerCase();

  const media: StoredMedia | null = mediaType
    ? {
        kind: mediaKindFromWacli(mediaType),
        ref: messageId,
        mimeType: raw.Media?.MimeType || raw.MimeType || null,
        fileName: raw.Media?.Filename || raw.Filename || null,
        sizeBytes: typeof raw.Media?.FileLength === 'number' ? raw.Media.FileLength : null,
      }
    : null;

  if (!text && !media && !raw.Revoked) return null;

  // wacli's ChatName is the saved contact or group subject; it falls back to
  // the bare JID when there is none. The sender's name is only a usable chat
  // name for a direct chat *they* sent — on our own messages it would be us.
  const chatLabel = raw.ChatName && raw.ChatName !== chatId ? raw.ChatName : '';
  const senderLabel = !isGroup && !raw.FromMe ? raw.SenderName || '' : '';
  const local = chatId.split('@')[0] || chatId;
  const numberLabel = !isGroup && /^\d+$/.test(local) ? `+${local}` : local;

  const realName = chatName || chatLabel || senderLabel;

  return {
    chatId,
    chatName: realName || numberLabel,
    chatNameIsFallback: !realName,
    chatKind: isGroup ? 'group' : 'dm',
    messageId,
    senderName: raw.FromMe ? 'You' : raw.SenderName || raw.SenderJID || 'Unknown',
    fromMe: Boolean(raw.FromMe),
    text: raw.Revoked ? 'This message was deleted' : text,
    at: raw.Timestamp ? new Date(raw.Timestamp) : new Date(),
    media,
  };
}

/** Run a read-only wacli query for one account and unwrap its JSON envelope. */
async function wacliQuery<T>(account: LinkedAccount, args: string[], timeoutMs: number): Promise<T | null> {
  const raw = await wacli(['--json', '--account', account.handle, '--read-only', ...args], timeoutMs);
  const parsed = JSON.parse(raw) as { success?: boolean; data?: T; error?: string | null };
  if (parsed.success === false) throw new Error(parsed.error || `wacli ${args.slice(0, 2).join(' ')} failed`);
  return parsed.data ?? null;
}

/**
 * Catch-up pass for WhatsApp: make Postgres hold every message wacli stored.
 *
 * The webhook only covers live traffic, and only on a best-effort basis —
 * wacli neither retries nor queues a POST that fails. History the phone syncs
 * after linking, and anything that arrived while the app was down or
 * restarting, lands in wacli's store without ever reaching the webhook. This
 * pass finds those messages.
 *
 * It reconciles by message id, chat by chat, rather than by time. The old
 * cursor ("everything after the newest mirrored message") skipped any message
 * stored after a newer one had been mirrored — which is exactly how history
 * sync arrives — and lost it for good.
 */
const WHATSAPP_PAGE = 500;
/** Per chat, per pass: 500k messages, far beyond what a phone hands a linked device. */
const WHATSAPP_MAX_PAGES = 1000;

interface WacliCoverage {
  chat_jid?: string;
  kind?: string;
  message_count?: number;
}

declare global {
  /** accountId → chatId → wacli message ids that are deliberately not mirrored. */
  var whatsappUnmirroredGlobal: Map<number, Map<string, Set<string>>> | undefined;
}

/**
 * Rows wacli stores that are not messages anyone reads (protocol and system
 * entries, deleted-for-me). Remembering them is what lets a chat whose counts
 * already balance be skipped without listing it. Lost on restart, which only
 * costs one extra walk of each such chat.
 */
function unmirrored(accountId: number): Map<string, Set<string>> {
  globalThis.whatsappUnmirroredGlobal ??= new Map();
  let chats = globalThis.whatsappUnmirroredGlobal.get(accountId);
  if (!chats) {
    chats = new Map();
    globalThis.whatsappUnmirroredGlobal.set(accountId, chats);
  }
  return chats;
}

async function backfillWhatsApp(account: LinkedAccount): Promise<void> {
  // Chats first: they carry wacli's names and last-activity times, so the
  // list is correctly named and ordered even before its messages arrive.
  await refreshWhatsAppChats(account);

  // One cheap count per chat on each side; only chats whose counts disagree
  // are listed at all.
  const coverage = await wacliQuery<{ coverage?: WacliCoverage[] }>(
    account,
    ['history', 'coverage', '--limit', '100000'],
    60_000,
  );
  const mirrored = await messageCountsByChat(account.id);
  const skipped = unmirrored(account.id);

  for (const chat of coverage?.coverage ?? []) {
    const chatId = chat.chat_jid;
    if (!chatId || (chat.kind !== 'dm' && chat.kind !== 'group')) continue;
    const ignored = skipped.get(chatId) ?? new Set<string>();
    const missing = (chat.message_count ?? 0) - (mirrored.get(chatId) ?? 0) - ignored.size;
    if (missing <= 0) continue;

    await reconcileWhatsAppChat(account, chatId, missing, ignored);
    skipped.set(chatId, ignored);
  }
}

/**
 * Walk one chat newest-first until `missing` rows Postgres doesn't have have
 * turned up. A dropped webhook leaves its gap at the recent end, so that is
 * usually a single page; history synced from the phone is walked back as far
 * as it goes.
 */
async function reconcileWhatsAppChat(
  account: LinkedAccount,
  chatId: string,
  missing: number,
  ignored: Set<string>,
): Promise<void> {
  const seen = new Set<string>();
  let found = 0;
  let before: string | undefined;

  for (let page = 0; page < WHATSAPP_MAX_PAGES && found < missing; page++) {
    const args = ['messages', 'list', '--chat', chatId, '--limit', String(WHATSAPP_PAGE)];
    if (before) args.push('--before', before);
    const messages = (await wacliQuery<{ messages?: WacliRawMessage[] }>(account, args, 120_000))?.messages ?? [];

    const unseen = messages.filter((m) => m.MsgID && !seen.has(m.MsgID));
    if (unseen.length === 0) break;
    for (const m of unseen) seen.add(m.MsgID!);

    const known = await existingMessageIds(account.id, chatId, unseen.map((m) => m.MsgID!));
    const batch: IngestMessage[] = [];
    for (const m of unseen) {
      if (known.has(m.MsgID!) || ignored.has(m.MsgID!)) continue;
      found++;
      const item = wacliToIngest(m);
      if (item) batch.push(item);
      else ignored.add(m.MsgID!);
    }
    const fresh = await ingestMessages(account.id, account.userId, batch, { history: true });
    cacheWhatsAppMedia(account, fresh);

    if (messages.length < WHATSAPP_PAGE) break;
    // `--before` is exclusive and only to the second, so step back to just
    // after the oldest second on this page: messages sharing that second with
    // the page boundary come round again (and are skipped as seen) instead of
    // being lost.
    const oldest = Date.parse(messages[messages.length - 1]?.Timestamp ?? '');
    if (!Number.isFinite(oldest)) break;
    before = new Date(oldest + 1000).toISOString();
  }
}

/** Media newer than this is downloaded as it arrives, while WhatsApp still serves it. */
const MEDIA_PREFETCH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
/** Worth fetching even when the size isn't known: photos, stickers and voice notes are small. */
const SMALL_MEDIA = new Set<MediaKind>(['image', 'sticker', 'audio']);

/**
 * Cache the attachments of newly mirrored messages in the background.
 *
 * WhatsApp's servers stop serving an attachment some weeks after it was sent,
 * and this device can't ask the phone to re-upload it while sync holds the
 * session, so a photo nobody opened in time would otherwise be gone. Only
 * recent media is fetched; old history is left to on-demand downloads.
 */
export function cacheWhatsAppMedia(account: { id: number; handle: string }, messages: StoredMessage[]): void {
  const cutoff = Date.now() - MEDIA_PREFETCH_WINDOW_MS;
  for (const message of messages) {
    const media = message.media;
    if (!media?.ref || Date.parse(message.timestamp) < cutoff) continue;
    if (media.sizeBytes ? media.sizeBytes > MAX_CACHED_BYTES : !SMALL_MEDIA.has(media.kind)) continue;
    prefetchMedia(account.id, message.chatId, media.ref, () =>
      getMedia(account.handle, message.chatId, media.ref),
    );
  }
}

interface WacliRawChat {
  jid?: string;
  name?: string;
  kind?: string;
  last_message_ts?: string;
  /** True for counted unread messages and for a chat marked unread by hand. */
  unread?: boolean;
  unread_count?: number;
}

declare global {
  /** "accountId:chatId" → when the chat was read in this app. */
  var whatsappReadInAppGlobal: Map<string, number> | undefined;
}

/**
 * How long a read in this app outranks the phone's count. Marking the chat
 * read on the phone is a delegated call that lands a moment later; a pass in
 * between would otherwise see the old count and bring the badge back.
 */
const READ_IN_APP_GRACE_MS = 2 * 60 * 1000;

function readInApp(): Map<string, number> {
  globalThis.whatsappReadInAppGlobal ??= new Map();
  return globalThis.whatsappReadInAppGlobal;
}

/**
 * A chat was read in the app: clear it on the phone too, and keep the
 * phone's (briefly stale) count from re-marking it unread here meanwhile.
 */
export function syncReadToPhone(account: { id: number; handle: string }, chatId: string): void {
  readInApp().set(`${account.id}:${chatId}`, Date.now());
  void markChatRead(account.handle, chatId);
}

/**
 * Mirror wacli's chat list: names, kind, last activity and unread state.
 * wacli reports an unsaved number's name as its bare JID; show the number
 * instead. Archived chats are included: their messages are mirrored, so their
 * names and read state should be too.
 */
async function refreshWhatsAppChats(account: LinkedAccount): Promise<void> {
  const observedAt = new Date();
  const chats = (await wacliQuery<WacliRawChat[]>(account, ['chats', 'list', '--limit', '2000'], 60_000)) ?? [];
  await upsertChats(
    account.id,
    chats
      .filter((c): c is WacliRawChat & { jid: string } => Boolean(c.jid) && (c.kind === 'dm' || c.kind === 'group'))
      .map((c) => {
        const at = c.last_message_ts ? new Date(c.last_message_ts) : null;
        return {
          chatId: c.jid,
          name: whatsappDisplayName(c.jid, c.name),
          kind: c.kind === 'group' ? ('group' as const) : ('dm' as const),
          lastMessageAt: at && !Number.isNaN(at.getTime()) ? at : undefined,
        };
      }),
  );

  // wacli keeps the phone's unread state: live arrivals add to it, and a read
  // on the phone clears it. A chat marked unread by hand has no count, so it
  // shows as one.
  const unread = new Map<string, number>();
  for (const c of chats) {
    if (!c.jid || (c.kind !== 'dm' && c.kind !== 'group')) continue;
    unread.set(c.jid, Math.max(c.unread_count ?? 0, c.unread ? 1 : 0));
  }
  const recent = new Set<string>();
  for (const [key, at] of readInApp()) {
    if (Date.now() - at > READ_IN_APP_GRACE_MS) readInApp().delete(key);
    else if (key.startsWith(`${account.id}:`)) recent.add(key.slice(String(account.id).length + 1));
  }
  await applyProviderUnread(account.id, account.userId, unread, observedAt, { skip: recent });
}

/** A chat's display name, falling back to the phone number rather than a JID. */
function whatsappDisplayName(jid: string, name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  if (trimmed && trimmed !== jid) return trimmed;
  const local = jid.split('@')[0] || jid;
  return jid.endsWith('@s.whatsapp.net') && /^\d+$/.test(local) ? `+${local}` : local;
}

// --- Scheduler -------------------------------------------------------------

/**
 * Signal has no push channel, so it is polled — but on a background timer, and
 * never more than one drain at a time per account.
 */
const SIGNAL_POLL_MS = 10_000;
/**
 * The webhook carries live traffic; this catch-up is the safety net for what
 * it drops. A pass whose counts balance costs two wacli reads and two
 * queries, so it can run often enough that a missed message shows up within
 * a minute rather than five.
 */
const WHATSAPP_BACKFILL_MS = 60 * 1000;

/**
 * Extra runs shortly after a loop is created. A WhatsApp account linked a
 * moment ago has an empty store while wacli pulls history from the phone, so
 * the immediate tick finds nothing; these catch the history as it lands
 * instead of waiting for the next regular interval.
 */
const WARMUP_DELAYS_MS = [15_000, 45_000, 90_000, 180_000];

function schedule(
  key: string,
  everyMs: number,
  task: () => Promise<void>,
  options: { warmup?: boolean } = {},
): void {
  if (timers().has(key)) return;
  const tick = async () => {
    if (busy().has(key)) return;
    busy().add(key);
    try {
      await task();
    } catch (error) {
      console.error(`[messaging-ingest] ${key}:`, error instanceof Error ? error.message : error);
    } finally {
      busy().delete(key);
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref?.();
  timers().set(key, timer);

  if (options.warmup) {
    WARMUP_DELAYS_MS.forEach((delay, i) => {
      const warmKey = `${key}#warmup${i}`;
      const once = setTimeout(() => {
        timers().delete(warmKey);
        void tick();
      }, delay);
      once.unref?.();
      timers().set(warmKey, once);
    });
  }
  void tick();
}

function unschedule(prefix: string, keep: Set<string>): void {
  for (const [key, timer] of timers()) {
    // Warm-up timers share their loop's key before the `#`.
    const loopKey = key.split('#')[0]!;
    if (key.startsWith(prefix) && !keep.has(loopKey)) {
      clearTimeout(timer);
      timers().delete(key);
    }
  }
}

/** Start/stop ingest loops to match the accounts that are currently linked. */
export async function reconcileIngest(): Promise<{ signal: number; whatsapp: number }> {
  const [signalAccounts, whatsappAccounts] = await Promise.all([
    listAccountsForProvider('signal'),
    listAccountsForProvider('whatsapp'),
  ]);

  const signalKeys = new Set<string>();
  for (const account of signalAccounts) {
    const key = `signal:${account.id}`;
    signalKeys.add(key);
    schedule(key, SIGNAL_POLL_MS, () => drainSignal(account));
  }
  unschedule('signal:', signalKeys);

  const waKeys = new Set<string>();
  for (const account of whatsappAccounts) {
    const key = `whatsapp:${account.id}`;
    waKeys.add(key);
    schedule(key, WHATSAPP_BACKFILL_MS, () => backfillWhatsApp(account), { warmup: true });
  }
  unschedule('whatsapp:', waKeys);

  return { signal: signalAccounts.length, whatsapp: whatsappAccounts.length };
}

/**
 * Drain one account right now, outside its normal schedule.
 *
 * Used after a send: Signal echoes your own message back as a sync message, so
 * an immediate drain makes it appear at once instead of on the next 10s tick.
 */
export async function drainNow(account: LinkedAccount): Promise<void> {
  const key = `signal:${account.id}`;
  if (busy().has(key)) return;
  busy().add(key);
  try {
    await drainSignal(account);
  } catch {
    // The scheduled loop will retry.
  } finally {
    busy().delete(key);
  }
}

export function stopIngest(provider: string, accountId: number): void {
  const key = `${provider}:${accountId}`;
  const timer = timers().get(key);
  if (timer) {
    clearInterval(timer);
    timers().delete(key);
  }
}
