import 'server-only';

import type { ChildProcess } from 'child_process';

import { listAccountsForProvider } from './messaging-accounts';
import { webhookSecret } from './messaging-webhook-secret';
import {
  killStrayWacli,
  spawnWacli,
  terminateWacli,
  wacliProcessPattern,
  webhookBase,
} from './wacli-runtime';

/**
 * Supervisor for the per-account `wacli sync --follow` processes.
 *
 * WhatsApp is the only provider that needs a long-lived process per linked
 * account: wacli mirrors the account into its own store, and new inbound
 * messages only land there while `sync --follow` is running. Telegram serves
 * history on demand, and Signal is drained per request, so neither needs this.
 *
 * One process per linked user is the real operational cost of per-user
 * WhatsApp. Processes are restarted with backoff if they exit, and stopped when
 * the account is unlinked. Everything is keyed by the wacli account name.
 */

interface SyncProcess {
  account: string;
  userId?: number;
  child: ChildProcess;
  /** The exact wacli argv, needed to stop the process inside a container. */
  args: string[];
  startedAt: number;
  restarts: number;
  /** Set when we killed it deliberately, so `close` doesn't restart it. */
  stopping: boolean;
}

declare global {
  var whatsappSyncGlobal: Map<string, SyncProcess> | undefined;
  var whatsappSyncTimersGlobal: Map<string, NodeJS.Timeout> | undefined;
}

function processes(): Map<string, SyncProcess> {
  globalThis.whatsappSyncGlobal ??= new Map();
  return globalThis.whatsappSyncGlobal;
}

function timers(): Map<string, NodeJS.Timeout> {
  globalThis.whatsappSyncTimersGlobal ??= new Map();
  return globalThis.whatsappSyncTimersGlobal;
}

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
/** Treat a process that survived this long as healthy and reset its backoff. */
const HEALTHY_AFTER_MS = 60_000;

export interface SyncState {
  account: string;
  running: boolean;
  restarts: number;
  uptimeMs: number;
}

export function syncStatus(account: string): SyncState {
  const proc = processes().get(account);
  return {
    account,
    running: Boolean(proc && !proc.child.killed),
    restarts: proc?.restarts ?? 0,
    uptimeMs: proc ? Date.now() - proc.startedAt : 0,
  };
}

/**
 * Start `sync --follow` for one account. No-op if it is already running.
 *
 * `--webhook` is what makes WhatsApp live: wacli POSTs each incoming message
 * straight to /api/messaging/webhook, which writes it to Postgres and pushes an
 * SSE event. `userId` is required for that — without it the process still syncs
 * its local mirror, but nothing reaches the console until the next backfill.
 */
export function startSync(account: string, userId?: number, restarts = 0): void {
  if (!account) return;
  const existing = processes().get(account);
  if (existing && !existing.child.killed) return;

  // `--refresh-contacts` imports saved contact names from the session store
  // at startup (a local read, no network), so chats are named rather than
  // bare numbers. `contacts refresh` can't be run separately: this process
  // holds the store lock for as long as it follows.
  const args = ['--account', account, 'sync', '--follow', '--refresh-contacts'];
  // Pre-downloading every attachment in the account's history is opt-in: it
  // pulled 4 GB in the first half hour of one link and keeps growing, while
  // the app fetches attachments on demand (and caches them) when a thread is
  // opened. The only thing pre-download buys is old media that WhatsApp's
  // servers have since expired.
  if (/^(1|true|yes)$/i.test((process.env.WACLI_DOWNLOAD_MEDIA ?? '').trim())) args.push('--download-media');
  if (userId) {
    // The webhook always points at this app on the same host (or the Docker
    // host gateway), which wacli refuses as a private address unless told
    // explicitly that it is allowed.
    args.push(
      '--webhook',
      `${webhookBase()}/api/messaging/webhook?token=${webhookSecret()}&user=${userId}`,
      '--webhook-allow-private',
    );
  }

  const child = spawnWacli(args, { stdio: ['ignore', 'ignore', 'pipe'] });

  const proc: SyncProcess = {
    account,
    child,
    args,
    startedAt: Date.now(),
    restarts,
    stopping: false,
    userId,
  };
  processes().set(account, proc);

  // wacli keeps progress and errors on stderr; surface only the tail on exit so
  // a chatty sync doesn't flood the server log.
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-2000);
  });

  child.on('error', (err) => {
    console.error(`[whatsapp-sync] ${account} failed to spawn: ${err.message}`);
  });

  child.on('close', (code) => {
    processes().delete(account);
    if (proc.stopping) return;

    const lived = Date.now() - proc.startedAt;
    const nextRestarts = lived > HEALTHY_AFTER_MS ? 0 : restarts + 1;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** nextRestarts, MAX_BACKOFF_MS);
    console.error(
      `[whatsapp-sync] ${account} exited (code ${code}); restarting in ${Math.round(delay / 1000)}s. ${stderr.trim().slice(-300)}`,
    );

    const timer = setTimeout(() => {
      timers().delete(account);
      startSync(account, proc.userId, nextRestarts);
    }, delay);
    // Don't hold the event loop open on a restart timer.
    timer.unref?.();
    timers().set(account, timer);
  });
}

/**
 * Kill any `wacli … sync` still running for this account from a previous server
 * process.
 *
 * When the app is killed, its children are re-parented to init and keep running
 * (and in container mode they were never our children at all — only the
 * `docker exec` client was). They hold wacli's store lock — so the new process
 * can never start its own sync — and they post to the webhook with the previous
 * run's secret, which is now rejected. Reaping them on boot is what makes a
 * restart or deploy recover.
 */
async function reapOrphans(account: string): Promise<void> {
  // Never signal a child this process is already supervising.
  const ours = new Set([...processes().values()].map((p) => p.child.pid));
  const reaped = await killStrayWacli(wacliProcessPattern(account, 'sync'), ours);
  if (reaped.length === 0) return;
  for (const pid of reaped) {
    console.log(`[whatsapp-sync] reaped orphaned sync process ${pid} for ${account}`);
  }
  // Give the lock a moment to clear before the caller respawns.
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

/** Stop every supervised sync — used when the server itself is shutting down. */
export function stopAllSync(): void {
  for (const account of [...processes().keys()]) stopSync(account);
}

declare global {
  var whatsappShutdownHookedGlobal: boolean | undefined;
}

/**
 * Kill our sync children when the server exits.
 *
 * This lives here rather than in instrumentation.ts because that file is also
 * compiled for the Edge runtime, where `process.once`/`process.exit` don't
 * exist — Next flags them even inside a nodejs-only branch.
 */
export function installShutdownHooks(): void {
  if (globalThis.whatsappShutdownHookedGlobal) return;
  globalThis.whatsappShutdownHookedGlobal = true;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopAllSync();
      process.exit(0);
    });
  }
  process.once('exit', stopAllSync);
}

/** Stop one account's sync and cancel any pending restart. */
export function stopSync(account: string): void {
  const timer = timers().get(account);
  if (timer) {
    clearTimeout(timer);
    timers().delete(account);
  }
  const proc = processes().get(account);
  if (!proc) return;
  proc.stopping = true;
  terminateWacli(proc.child, proc.args);
  processes().delete(account);
}

/**
 * Reconcile running processes against the linked accounts in the database:
 * start what's missing, stop what's no longer linked. Safe to call repeatedly.
 */
export async function reconcileSyncProcesses(): Promise<SyncState[]> {
  const accounts = await listAccountsForProvider('whatsapp');
  const wanted = new Set(accounts.map((a) => a.handle).filter(Boolean));

  for (const account of accounts) {
    if (!account.handle) continue;
    // Clear any leftover process from a previous run before claiming the lock.
    if (!processes().has(account.handle)) await reapOrphans(account.handle);
    startSync(account.handle, account.userId);
  }
  for (const account of [...processes().keys()]) {
    if (!wanted.has(account)) stopSync(account);
  }
  return [...wanted].map(syncStatus);
}
