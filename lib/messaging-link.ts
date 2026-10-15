import 'server-only';

import { type ChildProcess, spawn } from 'child_process';

import {
  getAccount,
  type LinkedAccount,
  listAccounts,
  type MessagingProvider,
  newWacliAccountName,
  phoneFromJid,
  saveAccount,
} from './messaging-accounts';
import { adoptClient, apiCredentials, isConfigured, newAuthClient, startTelegramMirror } from './telegram';
import { logout as wacliLogout, removeAccount as removeWacliAccount, getStatus as wacliStatus } from './wacli';
import { spawnWacli, terminateWacli } from './wacli-runtime';
import { reconcileIngest } from './messaging-ingest';
import { startSync, stopSync } from './whatsapp-sync';

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
 *
 * A WhatsApp attempt either adds another account (a new wacli store) or, given
 * an account id, re-pairs one whose session the phone has ended.
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
  /** The account this attempt linked, once it has. */
  accountId: number | null;
  startedAt: number;
  /** Set while a paired WhatsApp is being checked and saved. */
  finishing: boolean;
  /** Cleanup for whatever is holding the link open. */
  dispose: () => void;
}

/** Each WhatsApp account runs its own `sync --follow`; this bounds that per user. */
export const MAX_WHATSAPP_ACCOUNTS = 5;

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
  accountId: number | null;
}

function viewOf(session: LinkSession): LinkView {
  return {
    status: session.status,
    payload: session.payload,
    error: session.error,
    label: session.label,
    accountId: session.accountId,
  };
}

export function readLink(userId: number, provider: MessagingProvider): LinkView | null {
  const session = sessions().get(key(userId, provider));
  if (!session) return null;

  // Expire a stale attempt rather than showing a QR the provider has abandoned.
  if (session.status === 'pending' && Date.now() - session.startedAt > LINK_TTL_MS) {
    cancelLink(userId, provider);
    return { status: 'expired', payload: null, error: 'The code expired. Start again.', label: null, accountId: null };
  }

  const view = viewOf(session);
  // A finished attempt is reported once, then cleared.
  if (session.status === 'linked' || session.status === 'error') {
    cancelLink(userId, provider);
  }
  return view;
}

/**
 * Start (or restart) a link attempt. For WhatsApp, `accountId` re-pairs that
 * existing account; without it the attempt adds a new one.
 */
export async function startLink(
  userId: number,
  provider: MessagingProvider,
  options: { accountId?: number } = {},
): Promise<LinkView> {
  cancelLink(userId, provider);

  const session: LinkSession = {
    userId,
    provider,
    status: 'pending',
    payload: null,
    error: null,
    label: null,
    accountId: null,
    startedAt: Date.now(),
    finishing: false,
    dispose: () => {},
  };
  sessions().set(key(userId, provider), session);

  try {
    if (provider === 'signal') await startSignalLink(session);
    else if (provider === 'whatsapp') await startWhatsAppLink(session, options.accountId);
    else await startTelegramLink(session);
  } catch (e) {
    session.status = 'error';
    session.error = e instanceof Error ? e.message : 'Could not start linking.';
  }

  return viewOf(session);
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

/**
 * Each WhatsApp account is an isolated wacli account (its own store, mirror DB
 * and media directory). A new link creates a fresh one; a re-link pairs the
 * account's existing store again so its history is kept. `--qr-format text`
 * prints the raw pairing payload instead of a terminal QR so the browser can
 * render it.
 */
async function startWhatsAppLink(session: LinkSession, relinkId?: number): Promise<void> {
  let relinking: LinkedAccount | null = null;
  if (relinkId !== undefined) {
    relinking = await getAccount(session.userId, 'whatsapp', relinkId);
    if (!relinking) throw new Error('That WhatsApp account is no longer linked.');
    // Its sync can't run without a session, and would hold the lock auth needs.
    stopSync(relinking.handle);
  } else if ((await listAccounts(session.userId, 'whatsapp')).length >= MAX_WHATSAPP_ACCOUNTS) {
    throw new Error(`You can link up to ${MAX_WHATSAPP_ACCOUNTS} WhatsApp accounts. Unlink one to add another.`);
  }
  const account = relinking?.handle ?? newWacliAccountName(session.userId);

  // Idempotent: adding an existing account is a no-op, so this is safe to retry.
  await new Promise<void>((resolve) => {
    const add = spawnWacli(['accounts', 'add', account, '--no-auth'], { stdio: 'ignore' });
    add.on('close', () => resolve());
    add.on('error', () => resolve());
  });

  const authArgs = ['--account', account, 'auth', '--qr-format', 'text', '--events'];
  const child = spawnWacli(authArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  /**
   * A new store that never got paired is removed again, so abandoned QR codes
   * don't leave empty accounts behind. Runs at most once, and never for a
   * re-link, whose store holds the account's history.
   */
  let discarded = false;
  const discardIfUnpaired = () => {
    if (relinking || discarded || session.status === 'linked' || session.finishing) return;
    discarded = true;
    // Give the dying auth process a moment to let go of the store.
    setTimeout(() => void removeWacliAccount(account, { logout: false }), 1500).unref?.();
  };

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
          void finishWhatsAppLink(session, account, relinking, phoneFromJid(status.linkedJid));
        }
      })
      .catch(() => {});
  }, 2500);
  poll.unref?.();

  session.dispose = () => {
    clearInterval(poll);
    // Stops the process wherever it lives — plain `kill` would leave a
    // containerised `auth` running after its docker exec client died.
    terminateWacli(child, authArgs);
    discardIfUnpaired();
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

  child.stdout?.on('data', (c: Buffer) => consumeStdout(c.toString('utf8')));
  child.stderr?.on('data', (c: Buffer) => consumeEvents(c.toString('utf8')));
  child.on('close', (code) => {
    clearInterval(poll);
    if (session.status !== 'pending' || session.finishing) {
      discardIfUnpaired();
      return;
    }
    // A clean exit right after pairing is normal — confirm before failing.
    const fail = () => {
      session.status = 'error';
      session.error = `wacli auth exited with code ${code}.`;
      discardIfUnpaired();
    };
    void wacliStatus(account)
      .then((status) => {
        if (status.authenticated) {
          void finishWhatsAppLink(session, account, relinking, phoneFromJid(status.linkedJid));
        } else fail();
      })
      .catch(fail);
  });

  await waitForPayload(session);
}

/**
 * Record a freshly paired WhatsApp account, unless it is one the user already
 * has: the same number twice would mirror every chat twice, and re-pairing an
 * account from a different phone would mix two numbers' history in one store.
 * A rejected pairing is signed out again so it leaves the phone's device list.
 */
async function finishWhatsAppLink(
  session: LinkSession,
  account: string,
  relinking: LinkedAccount | null,
  phone: string | null,
): Promise<void> {
  if (session.status !== 'pending' || session.finishing) return;
  session.finishing = true;

  try {
    const others = (await listAccounts(session.userId, 'whatsapp')).filter((a) => a.handle !== account);
    const otherPhones = await Promise.all(
      others.map(async (a) =>
        a.label?.startsWith('+') ? a.label : phoneFromJid((await wacliStatus(a.handle)).linkedJid),
      ),
    );
    const previous = relinking?.label?.startsWith('+') ? relinking.label : null;
    const problem =
      phone && otherPhones.includes(phone)
        ? `${phone} is already linked.`
        : phone && previous && phone !== previous
          ? `This account is ${previous}. Scan with that phone, or add ${phone} as another account.`
          : null;

    if (problem) {
      session.status = 'error';
      session.error = problem;
      session.dispose();
      if (relinking) await wacliLogout(account);
      else await removeWacliAccount(account, { logout: true });
      return;
    }

    const saved = await saveAccount({
      userId: session.userId,
      provider: 'whatsapp',
      handle: account,
      label: phone ?? relinking?.label ?? 'WhatsApp',
    });
    session.accountId = saved.id;
    session.label = saved.label;
    session.status = 'linked';

    // Inbound messages only arrive while this account's sync is following;
    // the webhook it carries is what makes the console update live.
    startSync(account, saved.id);
    void reconcileIngest();
  } catch (e) {
    session.status = 'error';
    session.error = e instanceof Error ? e.message : 'Could not save the linked account.';
  } finally {
    session.finishing = false;
  }
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
