import 'server-only';

import { execFile } from 'child_process';

/**
 * Thin wrapper around the `wacli` binary (https://wacli.sh) — an unofficial
 * WhatsApp client built on the WhatsApp Web (whatsmeow) protocol.
 *
 * Unlike the Cloud API, wacli links a real WhatsApp account as a Web device, so
 * it can see and reply to BOTH direct chats and groups. It keeps a local SQLite
 * mirror; we shell out to read/send and never touch that DB directly.
 *
 * Requirements on the host (an always-on server, NOT serverless):
 *   - the `wacli` binary on PATH (or set WACLI_BIN to its absolute path)
 *   - a paired session: run `wacli auth` once and scan the QR
 *   - `wacli sync --follow` running under a process manager so new inbound
 *     messages keep landing in the local store
 *
 * Env:
 *   WACLI_BIN        absolute path to the binary (default: "wacli" on PATH)
 *   WACLI_STORE_DIR  store directory (wacli reads this itself; default ~/.wacli)
 */

const BIN = (process.env.WACLI_BIN ?? '').trim() || 'wacli';

interface Envelope<T> {
  success: boolean;
  data: T;
  error: string | null;
}

/** Run wacli with the given args (no shell — args are passed as an array). */
function run<T>(args: string[], timeoutMs = 30_000): Promise<T> {
  // `--json` must precede the subcommand (it's a global/persistent flag).
  const fullArgs = ['--json', ...args];
  return new Promise<T>((resolve, reject) => {
    execFile(
      BIN,
      fullArgs,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: process.env },
      (err, stdout, stderr) => {
        // wacli keeps human progress/errors on stderr and JSON on stdout.
        if (!stdout) {
          reject(new Error(err ? `wacli failed: ${stderr || err.message}` : 'wacli returned no output'));
          return;
        }
        let env: Envelope<T>;
        try {
          env = JSON.parse(stdout) as Envelope<T>;
        } catch {
          reject(new Error(`wacli returned non-JSON output: ${stdout.slice(0, 200)}`));
          return;
        }
        if (!env.success) {
          reject(new Error(env.error || 'wacli reported failure'));
          return;
        }
        resolve(env.data);
      },
    );
  });
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

export async function getStatus(): Promise<WacliStatus> {
  try {
    const d = await run<DoctorData>(['doctor'], 10_000);
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
export async function listChats(limit = 500): Promise<WacliChat[]> {
  const rows = await run<RawChat[]>(['chats', 'list', '--limit', String(limit), '--no-archived']);
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
export async function listThread(jid: string, limit = 100): Promise<WacliMessage[]> {
  const data = await run<{ messages: RawMessage[] }>([
    'messages',
    'list',
    '--chat',
    jid,
    '--limit',
    String(limit),
    '--asc',
  ]);
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
}

/** Send a text message to a chat or group by JID. */
export async function sendText(jid: string, message: string): Promise<SendResult> {
  try {
    await run<unknown>(
      ['--lock-wait', '15s', 'send', 'text', '--to', jid, '--message', message],
      60_000,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

/** "254712345678@s.whatsapp.net" -> "254712345678"; group JIDs are returned as-is. */
export function jidToNumber(jid: string): string {
  const at = jid.indexOf('@');
  const local = at === -1 ? jid : jid.slice(0, at);
  return jid.endsWith('@s.whatsapp.net') ? local : jid;
}
