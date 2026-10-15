import 'server-only';

import { isAppWacliAccountName } from './messaging-accounts';
import { runWacli, wacliScratch } from './wacli-runtime';

/**
 * Thin wrapper around the `wacli` binary (https://wacli.sh) — an unofficial
 * WhatsApp client built on the WhatsApp Web (whatsmeow) protocol.
 *
 * Unlike the Cloud API, wacli links a real WhatsApp account as a Web device, so
 * it can see and reply to BOTH direct chats and groups. It keeps a local SQLite
 * mirror; we shell out to read/send and never touch that DB directly.
 *
 * Requirements (an always-on server, NOT serverless):
 *   - wacli reachable the way lib/wacli-runtime.ts describes: either the
 *     binary on PATH / WACLI_BIN, or the bundled Docker container named by
 *     WACLI_CONTAINER (the default for deployments)
 *   - a paired session per user, created from the module's QR panel
 *   - `wacli sync --follow` running for each linked account, which
 *     lib/whatsapp-sync.ts supervises
 */

interface Envelope<T> {
  success: boolean;
  data: T;
  error: string | null;
}

/** Run wacli with the given args (no shell — args are passed as an array). */
async function run<T>(args: string[], timeoutMs = 30_000, account?: string): Promise<T> {
  // `--json` and `--account` are global flags and must precede the subcommand.
  // Scoping by account keeps each user on their own isolated wacli store.
  const fullArgs = account ? ['--json', '--account', account, ...args] : ['--json', ...args];
  const { stdout, stderr, error } = await runWacli(fullArgs, { timeoutMs });

  // wacli keeps human progress/errors on stderr and JSON on stdout.
  if (!stdout) {
    throw new Error(error ? `wacli failed: ${stderr || error.message}` : 'wacli returned no output');
  }
  let env: Envelope<T>;
  try {
    env = JSON.parse(stdout) as Envelope<T>;
  } catch {
    throw new Error(`wacli returned non-JSON output: ${stdout.slice(0, 200)}`);
  }
  if (!env.success) throw new Error(env.error || 'wacli reported failure');
  return env.data;
}

// ---- Status ----

export interface WacliStatus {
  available: boolean; // binary present & responded
  authenticated: boolean; // a WhatsApp account is paired
  connected: boolean; // live socket up (i.e. `sync --follow` is running)
  linkedJid: string | null;
  lastSyncAt: string | null;
  counts: { messages: number; chats: number; contacts: number; groups: number };
  error?: string;
}

interface DoctorData {
  authenticated: boolean;
  linked_jid: string;
  connected: boolean;
  connection_state: string;
  store: { messages: number; chats: number; contacts: number; groups: number; last_sync_at: string };
}

export async function getStatus(account: string): Promise<WacliStatus> {
  try {
    const d = await run<DoctorData>(['doctor'], 10_000, account);
    return {
      available: true,
      authenticated: Boolean(d.authenticated),
      connected: Boolean(d.connected),
      linkedJid: d.linked_jid || null,
      lastSyncAt: d.store?.last_sync_at || null,
      counts: {
        messages: d.store?.messages ?? 0,
        chats: d.store?.chats ?? 0,
        contacts: d.store?.contacts ?? 0,
        groups: d.store?.groups ?? 0,
      },
    };
  } catch (e) {
    return {
      available: false,
      authenticated: false,
      connected: false,
      linkedJid: null,
      lastSyncAt: null,
      counts: { messages: 0, chats: 0, contacts: 0, groups: 0 },
      error: e instanceof Error ? e.message : 'wacli unavailable',
    };
  }
}

// ---- Accounts ----

/**
 * Forget a wacli account for good: sign this device out of WhatsApp (so it
 * drops off the phone's Linked devices list), remove it from wacli's config,
 * and delete its store, which holds the local message mirror and downloaded
 * media.
 *
 * The account's `sync --follow` must be stopped first, since it holds the store
 * lock that logout needs. Every step is best-effort: a store that was never
 * paired has nothing to log out of.
 */
export async function removeAccount(account: string, options: { logout: boolean }): Promise<void> {
  if (!isAppWacliAccountName(account)) return;
  if (options.logout) await logout(account);
  const shown = await run<{ store_dir?: string }>(['accounts', 'show', account], 10_000).catch(() => null);
  await run<unknown>(['accounts', 'remove', account], 10_000).catch(() => {});
  // Only ever the directory wacli itself placed for this exact account.
  const dir = shown?.store_dir ?? '';
  if (dir.endsWith(`/accounts/${account}`)) await wacliScratch().remove(dir).catch(() => {});
}

/** Sign a store out of WhatsApp but keep it, for an account that stays linked. */
export async function logout(account: string): Promise<void> {
  await run<unknown>(['--lock-wait', '15s', 'auth', 'logout'], 45_000, account).catch(() => {});
}

// ---- Chats ----

export type ChatKind = 'dm' | 'group' | 'newsletter' | 'unknown';

export interface WacliChat {
  jid: string;
  kind: ChatKind;
  name: string;
  lastMessageTs: string;
  archived: boolean;
  pinned: boolean;
  unread: boolean;
}

interface RawChat {
  jid: string;
  kind: string;
  name: string;
  last_message_ts: string;
  archived: boolean;
  pinned: boolean;
  muted_until: number;
  unread: boolean;
}

/** List chats (direct + groups). Newsletters/status are filtered out by default. */
export async function listChats(account: string, limit = 500): Promise<WacliChat[]> {
  const rows = await run<RawChat[]>(['chats', 'list', '--limit', String(limit), '--no-archived'], 30_000, account);
  return (rows ?? [])
    .filter((c) => c.kind === 'dm' || c.kind === 'group')
    .map((c) => ({
      jid: c.jid,
      kind: c.kind as ChatKind,
      name: c.name || jidToNumber(c.jid),
      lastMessageTs: c.last_message_ts,
      archived: c.archived,
      pinned: c.pinned,
      unread: c.unread,
    }));
}

// ---- Messages ----

export interface WacliMessage {
  id: string;
  chatJid: string;
  senderJid: string;
  senderName: string;
  fromMe: boolean;
  text: string;
  mediaType: string;
  mediaCaption: string;
  timestamp: string;
  revoked: boolean;
}

interface RawMessage {
  ChatJID: string;
  MsgID: string;
  SenderJID: string;
  SenderName: string;
  Timestamp: string;
  FromMe: boolean;
  Text: string;
  DisplayText: string;
  MediaType: string;
  MediaCaption: string;
  Revoked: boolean;
  DeletedForMe: boolean;
}

/** Messages of one chat, oldest-first (chat order). */
export async function listThread(account: string, jid: string, limit = 100): Promise<WacliMessage[]> {
  const data = await run<{ messages: RawMessage[] }>([
    'messages',
    'list',
    '--chat',
    jid,
    '--limit',
    String(limit),
    '--asc',
  ], 30_000, account);
  return (data?.messages ?? [])
    .filter((m) => !m.DeletedForMe)
    .map((m) => ({
      id: m.MsgID,
      chatJid: m.ChatJID,
      senderJid: m.SenderJID,
      senderName: m.SenderName || jidToNumber(m.SenderJID),
      fromMe: Boolean(m.FromMe),
      text: m.Text || '',
      mediaType: m.MediaType || '',
      mediaCaption: m.MediaCaption || '',
      timestamp: m.Timestamp,
      revoked: Boolean(m.Revoked),
    }));
}

// ---- Sending ----

export interface SendResult {
  ok: boolean;
  error?: string;
  /** WhatsApp's id for the sent message, when the send was accepted. */
  messageId?: string;
}

interface SentData {
  id?: string;
  sent?: boolean;
}

/**
 * Run a `send …` command the fast way.
 *
 * While `sync --follow` is running it holds the store lock for good and
 * accepts sends over its delegate socket instead. A `--lock-wait` therefore
 * never succeeds — it only delays the hand-off by its full duration (15s per
 * message, measured) — so sends don't wait for the lock at all; the one case
 * where the lock is briefly unavailable (sync still starting) gets a single
 * quick retry. `--post-send-wait` keeps a standalone session open for receipts
 * after the send; the long-lived sync handles those itself, so it is skipped
 * when our sync is up.
 */
async function send(account: string, args: string[], timeoutMs: number): Promise<SendResult> {
  const { syncStatus } = await import('./whatsapp-sync');
  const fast = syncStatus(account).running ? ['--post-send-wait', '0'] : [];
  const fullArgs = ['send', ...args, ...fast];

  for (let attempt = 0; ; attempt++) {
    try {
      const data = await run<SentData>(fullArgs, timeoutMs, account);
      return { ok: true, messageId: data?.id || undefined };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'send failed';
      if (attempt === 0 && /lock/i.test(message)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      return { ok: false, error: message };
    }
  }
}

/** Send a text message to a chat or group by JID. */
export function sendText(account: string, jid: string, message: string): Promise<SendResult> {
  return send(account, ['text', '--to', jid, '--message', message], 60_000);
}

/** "254712345678@s.whatsapp.net" -> "254712345678"; group JIDs are returned as-is. */
export function jidToNumber(jid: string): string {
  const at = jid.indexOf('@');
  const local = at === -1 ? jid : jid.slice(0, at);
  return jid.endsWith('@s.whatsapp.net') ? local : jid;
}

// --- Media ----------------------------------------------------------------

/**
 * Send a file. wacli derives the WhatsApp bubble type (image/video/audio/
 * document) from the MIME, so `--as auto` is left implicit.
 *
 * wacli takes a filesystem path rather than bytes, so the upload is spooled to
 * a private temp file (next to wacli, which may be inside a container) and
 * removed immediately afterwards.
 */
export async function sendMedia(
  account: string,
  jid: string,
  file: { bytes: Buffer; mimeType: string; fileName: string },
  caption = '',
): Promise<SendResult> {
  const scratch = wacliScratch();

  let dir: string | null = null;
  try {
    dir = await scratch.mkdtemp('laerp-wa-');
    // basename() strips any path separators a caller-supplied name might carry.
    const safeName = (await import('path')).basename(file.fileName) || 'upload';
    const path = scratch.join(dir, safeName);
    await scratch.writeFile(path, file.bytes);

    const args = ['file', '--to', jid, '--file', path];
    if (caption) args.push('--caption', caption);
    if (file.mimeType) args.push('--mime', file.mimeType);

    return await send(account, args, 120_000);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  } finally {
    if (dir) await scratch.remove(dir).catch(() => {});
  }
}

export interface FetchedMedia {
  bytes: Buffer;
  mimeType: string;
  fileName: string | null;
}

/**
 * Download one message's media.
 *
 * `--read-only` is important here: it writes the file without opening the
 * WhatsApp session store, so a download can't contend with the SQLite write
 * lock held by `wacli sync --follow`.
 */
export async function getMedia(account: string, jid: string, messageId: string): Promise<FetchedMedia | null> {
  const scratch = wacliScratch();

  let dir: string | null = null;
  try {
    dir = await scratch.mkdtemp('laerp-wa-dl-');
    await run<unknown>(
      ['--read-only', 'media', 'download', '--chat', jid, '--id', messageId, '--output', dir],
      120_000,
      account,
    );
    const entries = await scratch.readdir(dir);
    if (entries.length === 0) return null;

    const fileName = entries[0]!;
    const bytes = await scratch.readFile(scratch.join(dir, fileName));
    return { bytes, mimeType: mimeFromName(fileName), fileName };
  } catch {
    return null;
  } finally {
    if (dir) await scratch.remove(dir).catch(() => {});
  }
}

/** wacli names the downloaded file by extension; map that back to a MIME type. */
function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const table: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    pdf: 'application/pdf',
  };
  return table[ext] ?? 'application/octet-stream';
}
