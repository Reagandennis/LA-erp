import 'server-only';

import { type ChildProcess, spawn } from 'child_process';

import {
  getAccount,
  type MessagingProvider,
  saveAccount,
  wacliAccountName,
} from './messaging-accounts';
import { adoptClient, apiCredentials, isConfigured, newAuthClient, startTelegramMirror } from './telegram';
import { getStatus as wacliStatus } from './wacli';
import { reconcileIngest } from './messaging-ingest';
import { startSync } from './whatsapp-sync';

/**
 * In-browser QR linking for all three providers.
 *
 * Each provider hands us a payload string that the phone app scans:
 *   WhatsApp  `wacli auth --qr-format text`  -> an opaque WhatsApp pairing code
 *   Signal    `signal-cli link -n <name>`    -> sgnl://linkdevice?uuid=…&pub_key=…
 *   Telegram  auth.ExportLoginToken          -> tg://login?token=…
 *
 * Linking is inherently long-running: the CLI or MTProto connection must stay
 * open until the phone completes the handshake. So a link attempt is a session
 * held in memory, keyed by user+provider, that the browser polls. Sessions live
 * only as long as the Node process — an interrupted link is simply restarted.
 */

export type LinkStatus = 'pending' | 'linked' | 'error' | 'expired';

interface LinkSession {
  userId: number;
  provider: MessagingProvider;
  status: LinkStatus;
  /** Payload to render as a QR code, refreshed as the provider rotates it. */
  payload: string | null;
  error: string | null;
  label: string | null;
  startedAt: number;
  /** Cleanup for whatever is holding the link open. */
  dispose: () => void;
}

/** A link attempt is abandoned if the phone hasn't scanned within this window. */
const LINK_TTL_MS = 5 * 60 * 1000;

declare global {
  var messagingLinkSessionsGlobal: Map<string, LinkSession> | undefined;
}

function sessions(): Map<string, LinkSession> {
  globalThis.messagingLinkSessionsGlobal ??= new Map();
  return globalThis.messagingLinkSessionsGlobal;
}

function key(userId: number, provider: MessagingProvider): string {
  return `${userId}:${provider}`;
}

export function cancelLink(userId: number, provider: MessagingProvider): void {
  const existing = sessions().get(key(userId, provider));
  if (!existing) return;
  try {
    existing.dispose();
  } catch {
    // disposal is best-effort
  }
  sessions().delete(key(userId, provider));
}

export interface LinkView {
  status: LinkStatus;
  payload: string | null;
  error: string | null;
  label: string | null;
}

export function readLink(userId: number, provider: MessagingProvider): LinkView | null {
  const session = sessions().get(key(userId, provider));
  if (!session) return null;

  // Expire a stale attempt rather than showing a QR the provider has abandoned.
  if (session.status === 'pending' && Date.now() - session.startedAt > LINK_TTL_MS) {
    cancelLink(userId, provider);
    return { status: 'expired', payload: null, error: 'The code expired. Start again.', label: null };
  }

  const view = {
    status: session.status,
    payload: session.payload,
    error: session.error,
    label: session.label,
  };
  // A finished attempt is reported once, then cleared.
  if (session.status === 'linked' || session.status === 'error') {
    cancelLink(userId, provider);
  }
  return view;
}

/** Start (or restart) a link attempt. */
export async function startLink(
  userId: number,
  provider: MessagingProvider,
): Promise<LinkView> {
  cancelLink(userId, provider);

  const session: LinkSession = {
    userId,
    provider,
    status: 'pending',
    payload: null,
    error: null,
    label: null,
    startedAt: Date.now(),
    dispose: () => {},
  };
  sessions().set(key(userId, provider), session);

  try {
    if (provider === 'signal') await startSignalLink(session);
    else if (provider === 'whatsapp') await startWhatsAppLink(session);
    else await startTelegramLink(session);
  } catch (e) {
    session.status = 'error';
    session.error = e instanceof Error ? e.message : 'Could not start linking.';
  }

  return {
    status: session.status,
    payload: session.payload,
    error: session.error,
    label: session.label,
  };
}

/** Wait for a child process to emit its first QR payload (or fail). */
function waitForPayload(session: LinkSession, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (session.payload || session.status !== 'pending' || Date.now() - started > timeoutMs) {
        clearInterval(tick);
        resolve();
      }
    }, 100);
  });
}

function trackChild(session: LinkSession, child: ChildProcess): void {
  session.dispose = () => {
    child.kill('SIGTERM');
  };
  child.on('error', (err) => {
    session.status = 'error';
    session.error = err.message;
  });
}

// --- Signal ----------------------------------------------------------------

const SIGNAL_BIN = (process.env.SIGNAL_CLI_BIN ?? '').trim() || 'signal-cli';

/**
 * `signal-cli link` prints the sgnl:// URI immediately, then blocks until the
 * phone confirms, at which point it prints the associated account number.
 */
async function startSignalLink(session: LinkSession): Promise<void> {
  const child = spawn(SIGNAL_BIN, ['link', '-n', 'LA-ERP'], { env: process.env });
  trackChild(session, child);

  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const uri = buffer.match(/sgnl:\/\/linkdevice\?\S+/)?.[0];
    if (uri && !session.payload) session.payload = uri;

    // On success signal-cli reports the linked number in E.164.
    const number = buffer.match(/\+\d{7,15}/)?.[0];
    if (number && session.status === 'pending') {
      session.status = 'linked';
      session.label = number;
      void saveAccount({
        userId: session.userId,
        provider: 'signal',
        handle: number,
        label: number,
      }).then(() => reconcileIngest());
    }
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  child.on('close', (code) => {
    if (session.status === 'pending') {
      session.status = 'error';
      session.error = stderr.trim() || `signal-cli link exited with code ${code}.`;
    }
  });

  await waitForPayload(session);
}

// --- WhatsApp --------------------------------------------------------------

const WACLI_BIN = (process.env.WACLI_BIN ?? '').trim() || 'wacli';

/**
 * Each user gets an isolated wacli account (its own store, mirror DB and media
 * directory), created on first link. `--qr-format text` prints the raw pairing
 * payload instead of a terminal QR so the browser can render it.
 */
async function startWhatsAppLink(session: LinkSession): Promise<void> {
  const account = wacliAccountName(session.userId);

  // Idempotent: adding an existing account is a no-op, so this is safe to retry.
  await new Promise<void>((resolve) => {
    const add = spawn(WACLI_BIN, ['accounts', 'add', account, '--no-auth'], { env: process.env });
    add.on('close', () => resolve());
    add.on('error', () => resolve());
  });

  const child = spawn(
    WACLI_BIN,
    ['--account', account, 'auth', '--qr-format', 'text', '--events'],
    { env: process.env },
  );

  /**
   * Pairing success is confirmed by polling `wacli doctor` rather than by
   * matching a lifecycle event name: doctor's `authenticated` flag is the
   * authoritative state, and it doesn't depend on wacli's event vocabulary.
   */
  const poll = setInterval(() => {
    void wacliStatus(account)
      .then((status) => {
        if (status.authenticated) {
          clearInterval(poll);
          markWhatsAppLinked(session, account);
        }
      })
      .catch(() => {});
  }, 2500);
  poll.unref?.();

  session.dispose = () => {
    clearInterval(poll);
    child.kill('SIGTERM');
  };
  child.on('error', (err) => {
    clearInterval(poll);
    session.status = 'error';
    session.error = err.message;
  });

  // `--events` emits NDJSON on stderr, one object per line:
  //   {"event":"qr_code","data":{"code":"https://wa.me/settings/linked_devices#2@…"},"ts":…}
  // The same payload also appears on stdout in --qr-format text mode.
  const consumeEvents = (text: string) => {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed) as {
          event?: string;
          data?: { code?: string; message?: string };
        };
        if (parsed.event === 'qr_code' && parsed.data?.code) {
          session.payload = parsed.data.code;
        }
        if (parsed.event === 'error' && parsed.data?.message && session.status === 'pending') {
          session.status = 'error';
          session.error = parsed.data.message;
        }
      } catch {
        // Not an event line; the stdout handler covers the plain payload.
      }
    }
  };

  const consumeStdout = (text: string) => {
    const url = text.match(/https:\/\/wa\.me\/settings\/linked_devices#\S+/)?.[0];
    if (url) session.payload = url;
  };

  child.stdout.on('data', (c: Buffer) => consumeStdout(c.toString('utf8')));
  child.stderr.on('data', (c: Buffer) => consumeEvents(c.toString('utf8')));
  child.on('close', (code) => {
    clearInterval(poll);
    if (session.status === 'pending') {
      // A clean exit right after pairing is normal — confirm before failing.
      void wacliStatus(account)
        .then((status) => {
          if (status.authenticated) markWhatsAppLinked(session, account);
          else {
            session.status = 'error';
            session.error = `wacli auth exited with code ${code}.`;
          }
        })
        .catch(() => {
          session.status = 'error';
          session.error = `wacli auth exited with code ${code}.`;
        });
    }
  });

  await waitForPayload(session);
}

function markWhatsAppLinked(session: LinkSession, account: string): void {
  if (session.status !== 'pending') return;
  session.status = 'linked';
  session.label = 'WhatsApp';
  void saveAccount({
    userId: session.userId,
    provider: 'whatsapp',
    handle: account,
    label: 'WhatsApp',
  }).then(() => {
    // Inbound messages only arrive while this account's sync is following;
    // the webhook it carries is what makes the console update live.
    startSync(account, session.userId);
    return reconcileIngest();
  });
}

// --- Telegram --------------------------------------------------------------

/**
 * Telegram's QR login: export a login token, render it as `tg://login?token=…`,
 * and poll until the app confirms. GramJS's signInUserWithQrCode drives that
 * whole handshake, including the token rotation, so we let it run in the
 * background and surface each URL it produces.
 */
async function startTelegramLink(session: LinkSession): Promise<void> {
  if (!isConfigured()) {
    throw new Error('TELEGRAM_API_ID / TELEGRAM_API_HASH are not set on the server.');
  }

  const client = newAuthClient();
  await client.connect();
  session.dispose = () => {
    void client.disconnect().catch(() => {});
  };

  const { apiId, apiHash } = apiCredentials();
  void client
    .signInUserWithQrCode(
      { apiId, apiHash },
      {
        onError: async (err: Error) => {
          session.status = 'error';
          session.error = err.message;
          return true; // stop retrying
        },
        qrCode: async (code: { token: Buffer; expires: number }) => {
          // base64url, unpadded — the form Telegram's apps expect.
          const token = code.token
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
          session.payload = `tg://login?token=${token}`;
        },
        // 2FA accounts cannot complete a QR login without the cloud password;
        // tell the user to use the phone-number flow instead.
        password: async () => {
          throw new Error(
            'This account has two-step verification. Use the phone-number sign-in instead.',
          );
        },
      },
    )
    .then(async () => {
      const label = await adoptClient(session.userId, client, 'QR');
      session.status = 'linked';
      session.label = label;
      const account = await getAccount(session.userId, 'telegram');
      if (account) void startTelegramMirror(session.userId, account.id);
    })
    .catch((e: unknown) => {
      if (session.status === 'pending') {
        session.status = 'error';
        session.error = e instanceof Error ? e.message : 'QR sign-in failed.';
      }
    });

  await waitForPayload(session);
}
