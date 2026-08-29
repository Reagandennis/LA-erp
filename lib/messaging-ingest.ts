import 'server-only';

import { execFile } from 'child_process';

import {
  type LinkedAccount,
  listAccountsForProvider,
} from './messaging-accounts';
import { ingestMessages, latestMessageAt, upsertChats, type IngestMessage } from './messaging-repo';
import type { MediaKind, StoredMedia } from './messaging-store';

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
const WACLI_BIN = (process.env.WACLI_BIN ?? '').trim() || 'wacli';
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

function mediaKindFromMime(mime: string): MediaKind {
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

interface WacliRawMessage {
  ChatJID?: string;
  MsgID?: string;
  SenderJID?: string;
  SenderName?: string;
  Timestamp?: string;
  FromMe?: boolean;
  Text?: string;
  MediaType?: string;
  MediaCaption?: string;
  Revoked?: boolean;
  DeletedForMe?: boolean;
}

export function wacliToIngest(raw: WacliRawMessage, chatName?: string): IngestMessage | null {
  if (!raw.MsgID || !raw.ChatJID || raw.DeletedForMe) return null;
  const isGroup = raw.ChatJID.endsWith('@g.us');
  const text = raw.Text || raw.MediaCaption || '';
  const mediaType = (raw.MediaType ?? '').toLowerCase();

  const media: StoredMedia | null = mediaType
    ? {
        kind:
          mediaType === 'image' || mediaType === 'photo'
            ? 'image'
            : mediaType === 'video' || mediaType === 'gif'
              ? 'video'
              : mediaType === 'audio' || mediaType === 'ptt' || mediaType === 'voice'
                ? 'audio'
                : mediaType === 'sticker'
                  ? 'sticker'
                  : 'document',
        ref: raw.MsgID,
        mimeType: null,
        fileName: null,
        sizeBytes: null,
      }
    : null;

  if (!text && !media && !raw.Revoked) return null;

  return {
    chatId: raw.ChatJID,
    chatName: chatName || raw.SenderName || raw.ChatJID.split('@')[0] || raw.ChatJID,
    chatKind: isGroup ? 'group' : 'dm',
    messageId: raw.MsgID,
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
async function backfillWhatsApp(account: LinkedAccount): Promise<void> {
  const since = await latestMessageAt(account.id);
  const args = ['--json', '--account', account.handle, 'messages', 'list', '--limit', '500', '--asc'];
  if (since) args.push('--after', since.toISOString());

  const raw = await run(WACLI_BIN, args, 120_000);
  const parsed = JSON.parse(raw) as { success?: boolean; data?: { messages?: WacliRawMessage[] } };
  const messages = parsed?.data?.messages ?? [];

  const batch = messages
    .map((m) => wacliToIngest(m))
    .filter((m): m is IngestMessage => m !== null);
  await ingestMessages(account.id, account.userId, batch);

  // Refresh chat names separately — message rows only carry sender names.
  try {
    const chatsRaw = await run(
      WACLI_BIN,
      ['--json', '--account', account.handle, 'chats', 'list', '--limit', '500', '--no-archived'],
      60_000,
    );
    const chats = (JSON.parse(chatsRaw) as { data?: Array<{ jid?: string; name?: string; kind?: string }> })
      .data ?? [];
    await upsertChats(
      account.id,
      chats
        .filter((c) => c.jid)
        .map((c) => ({
          chatId: c.jid!,
          name: c.name || c.jid!.split('@')[0]!,
          kind: c.kind === 'group' ? ('group' as const) : ('dm' as const),
        })),
    );
  } catch {
    // Names are cosmetic.
  }
}

// --- Scheduler -------------------------------------------------------------

/**
 * Signal has no push channel, so it is polled — but on a background timer, and
 * never more than one drain at a time per account.
 */
const SIGNAL_POLL_MS = 10_000;
/** WhatsApp only needs a periodic catch-up; the webhook carries live traffic. */
const WHATSAPP_BACKFILL_MS = 5 * 60 * 1000;

function schedule(key: string, everyMs: number, task: () => Promise<void>): void {
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
  void tick();
}

function unschedule(prefix: string, keep: Set<string>): void {
  for (const [key, timer] of timers()) {
    if (key.startsWith(prefix) && !keep.has(key)) {
      clearInterval(timer);
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
    schedule(key, WHATSAPP_BACKFILL_MS, () => backfillWhatsApp(account));
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
