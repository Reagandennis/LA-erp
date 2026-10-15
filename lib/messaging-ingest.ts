import 'server-only';

import { execFile } from 'child_process';

import {
  type LinkedAccount,
  listAccountsForProvider,
} from './messaging-accounts';
import { ingestMessages, latestMessageAt, upsertChats, type IngestMessage } from './messaging-repo';
import type { MediaKind, StoredMedia } from './messaging-store';
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
        mimeType: raw.Media?.MimeType || null,
        fileName: raw.Media?.Filename || null,
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

  return {
    chatId,
    chatName: chatName || chatLabel || senderLabel || numberLabel,
    chatKind: isGroup ? 'group' : 'dm',
    messageId,
    senderName: raw.FromMe ? 'You' : raw.SenderName || raw.SenderJID || 'Unknown',
    fromMe: Boolean(raw.FromMe),
    text: raw.Revoked ? 'This message was deleted' : text,
    at: raw.Timestamp ? new Date(raw.Timestamp) : new Date(),
    media,
  };
}

/**
 * Catch-up pass for WhatsApp.
 *
 * Live messages arrive by webhook from `wacli sync --follow --webhook`; this
 * closes the gap for anything that landed while the app was down, using the
 * newest mirrored message as the cursor.
 */
const WHATSAPP_PAGE = 500;
/** Upper bound per pass; a freshly linked account with years of history takes a few passes. */
const WHATSAPP_MAX_PAGES = 40;

async function backfillWhatsApp(account: LinkedAccount): Promise<void> {
  // Chats first: they carry wacli's names and last-activity times, so the
  // list is correctly named and ordered even before its messages arrive.
  await refreshWhatsAppChats(account);

  // Page forward from the newest mirrored message until wacli runs dry. A
  // single page per tick would take an hour to catch up a new link.
  for (let page = 0; page < WHATSAPP_MAX_PAGES; page++) {
    const since = await latestMessageAt(account.id);
    const args = ['--json', '--account', account.handle, 'messages', 'list', '--limit', String(WHATSAPP_PAGE), '--asc'];
    if (since) args.push('--after', since.toISOString());

    const raw = await wacli(args, 120_000);
    const parsed = JSON.parse(raw) as { success?: boolean; data?: { messages?: WacliRawMessage[] } };
    const messages = parsed?.data?.messages ?? [];

    const batch = messages
      .map((m) => wacliToIngest(m))
      .filter((m): m is IngestMessage => m !== null);
    await ingestMessages(account.id, account.userId, batch);

    if (messages.length < WHATSAPP_PAGE) break;
    // `--after` is exclusive, so a page must advance the cursor to be useful.
    const newest = messages[messages.length - 1]?.Timestamp;
    if (!newest || (since && new Date(newest) <= since)) break;
  }
}

interface WacliRawChat {
  jid?: string;
  name?: string;
  kind?: string;
  last_message_ts?: string;
}

/**
 * Mirror wacli's chat list: names, kind and last activity. wacli reports an
 * unsaved number's name as its bare JID; show the number instead.
 */
async function refreshWhatsAppChats(account: LinkedAccount): Promise<void> {
  const chatsRaw = await wacli(
    ['--json', '--account', account.handle, 'chats', 'list', '--limit', '2000', '--no-archived'],
    60_000,
  );
  const chats = (JSON.parse(chatsRaw) as { data?: WacliRawChat[] }).data ?? [];
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
/** WhatsApp only needs a periodic catch-up; the webhook carries live traffic. */
const WHATSAPP_BACKFILL_MS = 5 * 60 * 1000;

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
