import 'server-only';

import { execFile } from 'child_process';

import type { StoredMedia } from './messaging-store';

/**
 * Signal integration via the `signal-cli` binary
 * (https://github.com/AsamK/signal-cli).
 *
 * Each platform user links their OWN Signal number from the module UI by
 * scanning a QR code — see lib/messaging-link.ts. signal-cli keeps every linked
 * account side by side in one data directory and selects between them with
 * `-a <number>`, so all state here is keyed by that number and one user never
 * sees another's messages.
 *
 * `signal-cli receive` *pops* pending messages off the server queue, so we drain
 * it into a per-account in-process ConversationStore. History resets on restart,
 * and messages are only captured while the app is polling — so this needs an
 * always-on host, not a serverless one.
 *
 * Env:
 *   SIGNAL_CLI_BIN  absolute path to the binary (default: "signal-cli")
 */

const BIN = (process.env.SIGNAL_CLI_BIN ?? '').trim() || 'signal-cli';
const GROUP_PREFIX = 'group:';


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

/**
 * Same as `run`, but keeps stdout as raw bytes. `getAttachment` streams the
 * decrypted file to stdout, and decoding that as UTF-8 would corrupt it.
 */
function runBinary(args: string[], timeoutMs = 30_000): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      BIN,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer', env: process.env },
      (err, stdout, stderr) => {
        const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? '');
        if (err && bytes.length === 0) {
          const message = Buffer.isBuffer(stderr) ? stderr.toString('utf8').trim() : String(stderr ?? '');
          reject(new Error(message || err.message));
          return;
        }
        resolve(bytes);
      },
    );
  });
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

/**
 * `account` is the user's linked number, or null when they haven't linked yet.
 * A null account still reports whether the binary is installed, so the UI can
 * distinguish "signal-cli missing on the server" from "you haven't linked".
 */
export async function getStatus(account: string | null): Promise<SignalStatus> {
  const counts = { chats: 0, messages: 0 };
  try {
    await run(['--version'], 8_000);
  } catch (e) {
    return {
      available: false,
      authenticated: false,
      connected: false,
      label: null,
      counts,
      error: e instanceof Error ? e.message : 'signal-cli not found',
      hint: 'Install signal-cli on the server (and set SIGNAL_CLI_BIN if it is not on PATH).',
    };
  }

  if (!account) {
    return {
      available: true,
      authenticated: false,
      connected: false,
      label: null,
      counts,
      hint: 'Scan the QR code with Signal to link your account.',
    };
  }

  // Receiving happens in the background ingest loop, never here — this call
  // used to run `signal-cli receive`, which blocked the request for seconds.
  return {
    available: true,
    authenticated: true,
    connected: true,
    label: account,
    counts,
  };
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendText(account: string, chatId: string, message: string): Promise<SendResult> {
  if (!account) return { ok: false, error: 'No Signal account is linked.' };
  const isGroup = chatId.startsWith(GROUP_PREFIX);
  const target = isGroup ? chatId.slice(GROUP_PREFIX.length) : chatId;
  const args = isGroup
    ? ['-o', 'json', '-a', account, 'send', '-m', message, '-g', target]
    : ['-o', 'json', '-a', account, 'send', '-m', message, target];
  try {
    await run(args, 60_000);
    // The sent message is mirrored when it comes back as a sync message on the
    // next drain — nothing is written locally, so there is one source of truth.
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

// --- Media ----------------------------------------------------------------

/** Split a chat id into the `send`/`getAttachment` target args. */
function targetArgs(chatId: string, flagForGroup: string): { isGroup: boolean; args: string[] } {
  const isGroup = chatId.startsWith(GROUP_PREFIX);
  const target = isGroup ? chatId.slice(GROUP_PREFIX.length) : chatId;
  return { isGroup, args: isGroup ? [flagForGroup, target] : [target] };
}

/**
 * Send an attachment. signal-cli's `-a` accepts a data URI as well as a path,
 * which lets us hand over the uploaded bytes without ever writing a temp file
 * (and so without leaving decrypted media on disk).
 */
export async function sendMedia(
  account: string,
  chatId: string,
  file: { bytes: Buffer; mimeType: string; fileName: string },
  caption = '',
): Promise<SendResult> {
  if (!account) return { ok: false, error: 'No Signal account is linked.' };

  // signal-cli reads the filename out of the data URI's `filename=` parameter.
  const dataUri = `data:${file.mimeType};filename=${encodeURIComponent(file.fileName)};base64,${file.bytes.toString('base64')}`;
  const { args: target } = targetArgs(chatId, '-g');
  const args = ['-o', 'json', '-a', account, 'send', '-a', dataUri];
  if (caption) args.push('-m', caption);
  args.push(...target);

  try {
    await run(args, 120_000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

export interface FetchedMedia {
  bytes: Buffer;
  mimeType: string;
  fileName: string | null;
}

/**
 * Retrieve a received attachment's bytes via `signal-cli getAttachment`, which
 * writes the raw file to stdout. `ref` is the attachment id taken from the
 * stored message — never a caller-supplied path.
 */
export async function getMedia(account: string, chatId: string, ref: string): Promise<FetchedMedia | null> {
  if (!account || !ref) return null;
  const { args: target } = targetArgs(chatId, '-g');
  const recipientArgs = chatId.startsWith(GROUP_PREFIX) ? target : ['--recipient', ...target];

  try {
    const bytes = await runBinary(
      ['-a', account, 'getAttachment', '--id', ref, ...recipientArgs],
      60_000,
    );
    if (!bytes.length) return null;
    // Recover the declared type from the stored message where we can.
    const known = await findMediaRef(account, chatId, ref);
    return {
      bytes,
      mimeType: known?.mimeType || 'application/octet-stream',
      fileName: known?.fileName ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Look up a stored attachment descriptor so the media route can set headers.
 * Reads the Postgres mirror rather than in-process state, so it still resolves
 * after a restart.
 */
async function findMediaRef(account: string, chatId: string, ref: string): Promise<StoredMedia | null> {
  const { prisma } = await import('./prisma');
  const row = await prisma.messagingMessage.findFirst({
    where: { chatId, mediaRef: ref, account: { provider: 'signal', handle: account } },
    select: { mediaKind: true, mediaMime: true, mediaName: true, mediaSize: true },
  });
  if (!row?.mediaKind) return null;
  return {
    kind: row.mediaKind as StoredMedia['kind'],
    ref,
    mimeType: row.mediaMime,
    fileName: row.mediaName,
    sizeBytes: row.mediaSize,
  };
}
