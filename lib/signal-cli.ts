import 'server-only';

import { execFile } from 'child_process';

import { ConversationStore } from './messaging-store';

/**
 * Signal integration via the `signal-cli` binary
 * (https://github.com/AsamK/signal-cli).
 *
 * Like WhatsApp/wacli this needs an always-on host and a linked/registered
 * account; unlike wacli, `signal-cli receive` *pops* pending messages off the
 * server queue, so we drain it into an in-process ConversationStore (see its
 * note about server lifetime). History resets on restart, and messages are
 * only captured while the app is polling.
 *
 * Setup on the host (NOT serverless):
 *   1. Install signal-cli and register or link an account:
 *        signal-cli link -n "LA-ERP"      (scan from Signal → Linked devices)
 *      or register a dedicated number with `signal-cli register`.
 *   2. Set SIGNAL_CLI_ACCOUNT to that E.164 number (e.g. +15551234567).
 *   3. Optionally set SIGNAL_CLI_BIN if the binary isn't on PATH.
 *
 * Env:
 *   SIGNAL_CLI_BIN      absolute path to the binary (default: "signal-cli")
 *   SIGNAL_CLI_ACCOUNT  registered/linked account number in E.164 (required)
 */

const BIN = (process.env.SIGNAL_CLI_BIN ?? '').trim() || 'signal-cli';
const ACCOUNT = (process.env.SIGNAL_CLI_ACCOUNT ?? '').trim();
const GROUP_PREFIX = 'group:';

const store = new ConversationStore();
const groupNames = new Map<string, string>();
let lastReceiveOk = false;

/** Run signal-cli with an args array (no shell). Resolves raw stdout. */
function run(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      BIN,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: process.env },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error(stderr?.trim() || err.message));
          return;
        }
        resolve(stdout ?? '');
      },
    );
  });
}

interface SignalDataMessage {
  message?: string | null;
  timestamp?: number;
  groupInfo?: { groupId?: string } | null;
}

interface SignalEnvelope {
  source?: string;
  sourceNumber?: string;
  sourceUuid?: string;
  sourceName?: string;
  timestamp?: number;
  dataMessage?: SignalDataMessage | null;
  syncMessage?: { sentMessage?: (SignalDataMessage & { destination?: string }) | null } | null;
}

interface SignalLine {
  envelope?: SignalEnvelope;
}

function senderId(env: SignalEnvelope): string {
  return env.sourceNumber || env.source || env.sourceUuid || 'unknown';
}

function ingestDataMessage(
  env: SignalEnvelope,
  data: SignalDataMessage,
  opts: { fromMe: boolean; destination?: string },
): void {
  const text = (data.message ?? '').trim();
  if (!text) return; // skip receipts, typing, empty payloads

  const groupId = data.groupInfo?.groupId;
  const ts = new Date(data.timestamp || env.timestamp || Date.now()).toISOString();

  if (groupId) {
    const chatId = `${GROUP_PREFIX}${groupId}`;
    store.addMessage(
      {
        id: `${chatId}:${data.timestamp || env.timestamp}`,
        chatId,
        senderName: opts.fromMe ? 'You' : env.sourceName || senderId(env),
        fromMe: opts.fromMe,
        text,
        timestamp: ts,
      },
      { id: chatId, kind: 'group', name: groupNames.get(groupId) || 'Signal group' },
    );
    return;
  }

  // Direct message: the other party is the sender (inbound) or destination (sync-sent).
  const other = opts.fromMe ? opts.destination || senderId(env) : senderId(env);
  store.addMessage(
    {
      id: `${other}:${data.timestamp || env.timestamp}`,
      chatId: other,
      senderName: opts.fromMe ? 'You' : env.sourceName || other,
      fromMe: opts.fromMe,
      text,
      timestamp: ts,
    },
    { id: other, kind: 'dm', name: env.sourceName || other },
  );
}

/** Drain pending messages from the server queue into the store. */
async function receiveIntoStore(): Promise<void> {
  if (!ACCOUNT) return;
  try {
    const out = await run(['-o', 'json', '-a', ACCOUNT, 'receive', '--timeout', '1'], 20_000);
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: SignalLine;
      try {
        parsed = JSON.parse(trimmed) as SignalLine;
      } catch {
        continue;
      }
      const env = parsed.envelope;
      if (!env) continue;
      if (env.dataMessage) {
        ingestDataMessage(env, env.dataMessage, { fromMe: false });
      } else if (env.syncMessage?.sentMessage) {
        const sent = env.syncMessage.sentMessage;
        ingestDataMessage(env, sent, { fromMe: true, destination: sent.destination });
      }
    }
    lastReceiveOk = true;
  } catch {
    lastReceiveOk = false;
  }
}

/** Refresh the group-id → name map (best-effort). */
async function refreshGroupNames(): Promise<void> {
  if (!ACCOUNT) return;
  try {
    const out = await run(['-o', 'json', '-a', ACCOUNT, 'listGroups'], 15_000);
    const parsed = JSON.parse(out) as Array<{ id?: string; name?: string }>;
    for (const g of parsed) {
      if (g.id && g.name) groupNames.set(g.id, g.name);
    }
  } catch {
    // best-effort; group chats fall back to a generic name
  }
}

export interface SignalStatus {
  available: boolean;
  authenticated: boolean;
  connected: boolean;
  label: string | null;
  counts: { chats: number; messages: number };
  hint?: string;
  error?: string;
}

export async function getStatus(): Promise<SignalStatus> {
  let available = false;
  try {
    await run(['--version'], 8_000);
    available = true;
  } catch (e) {
    return {
      available: false,
      authenticated: false,
      connected: false,
      label: null,
      counts: store.counts(),
      error: e instanceof Error ? e.message : 'signal-cli not found',
      hint: 'Install signal-cli and set SIGNAL_CLI_BIN if it is not on PATH.',
    };
  }

  if (!ACCOUNT) {
    return {
      available,
      authenticated: false,
      connected: false,
      label: null,
      counts: store.counts(),
      hint: 'Register or link an account, then set SIGNAL_CLI_ACCOUNT to its number.',
    };
  }

  await refreshGroupNames();
  await receiveIntoStore();
  return {
    available,
    authenticated: true,
    connected: lastReceiveOk,
    label: ACCOUNT,
    counts: store.counts(),
  };
}

export async function listChats() {
  await receiveIntoStore();
  return store.listChats();
}

export async function listThread(chatId: string, limit = 200) {
  await receiveIntoStore();
  return store.listThread(chatId, limit);
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendText(chatId: string, message: string): Promise<SendResult> {
  if (!ACCOUNT) return { ok: false, error: 'SIGNAL_CLI_ACCOUNT is not set' };
  const isGroup = chatId.startsWith(GROUP_PREFIX);
  const target = isGroup ? chatId.slice(GROUP_PREFIX.length) : chatId;
  const args = isGroup
    ? ['-o', 'json', '-a', ACCOUNT, 'send', '-m', message, '-g', target]
    : ['-o', 'json', '-a', ACCOUNT, 'send', '-m', message, target];
  try {
    await run(args, 60_000);
    store.addMessage(
      {
        id: `out:${chatId}:${Date.now()}`,
        chatId,
        senderName: 'You',
        fromMe: true,
        text: message,
        timestamp: new Date().toISOString(),
      },
      {
        id: chatId,
        kind: isGroup ? 'group' : 'dm',
        name: isGroup ? groupNames.get(target) || 'Signal group' : target,
      },
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}
