import { AsyncLocalStorage } from 'node:async_hooks';

import { publishAll } from './chat-bus';
import { CHANGED_EVENT } from './live-sources';

/**
 * Tells every open browser tab which kinds of record just changed, so pages
 * refresh themselves instead of waiting for a reload.
 *
 * One choke point: lib/prisma.ts reports every database write here, whichever
 * module or background job made it. Writes are gathered for a moment and sent
 * as one event on the per-user stream the app already holds open
 * (`/api/messaging/stream`, fed by the in-process bus in lib/chat-bus.ts).
 *
 * The event carries model names only, never data. Each page re-reads through
 * its own access checks, so nobody is shown anything their modules do not
 * already allow.
 */

/**
 * Never announced: bookkeeping that changes constantly and that no screen
 * waits on, plus chat traffic, which has its own purpose-built live events.
 */
const SILENT_MODELS = new Set([
  'Session',
  'AuditLog',
  'RateLimitBucket',
  'AiUsage',
  'ExchangeRateSnapshot',
  'QuoteSequence',
  'InvoiceSequence',
  'TripSequence',
  'TrackingSequence',
  'MessagingMessage',
  'MessagingChat',
  'WhatsAppMessage',
  'Message',
  'MessageNotification',
  'ConversationMember',
  'ZelloDeviceLocation',
]);

/** Prisma operations that change rows. */
const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

export function isWriteOperation(operation: string): boolean {
  return WRITE_OPERATIONS.has(operation);
}

// --- Reads stay quiet --------------------------------------------------------

interface Scope {
  quiet: boolean;
  at: number;
}

/** A mark older than this is ignored: it belongs to a request long finished. */
const SCOPE_TTL_MS = 60_000;

declare global {
  var liveEventScopeGlobal: AsyncLocalStorage<Scope> | undefined;
  var liveEventPendingGlobal: { models: Set<string>; timer: NodeJS.Timeout | null; firstAt: number } | undefined;
}

// On globalThis like the bus itself: background jobs and route handlers can
// load separate copies of this module and must still share one queue.
globalThis.liveEventScopeGlobal ??= new AsyncLocalStorage<Scope>();
globalThis.liveEventPendingGlobal ??= { models: new Set<string>(), timer: null, firstAt: 0 };
const scope = globalThis.liveEventScopeGlobal;
const pending = globalThis.liveEventPendingGlobal;

/**
 * Marks the request being handled. A write made while answering a GET is
 * housekeeping (a read receipt, a cache row, a lazily created setting), not a
 * change someone made; announcing it would have the page that caused it
 * refresh, read again, and write again, in a loop.
 *
 * Called from the session lookup every route and page starts with. The mark
 * follows the rest of that request only, and expires, so a background job
 * that happens to be started from a request is not silenced for good.
 */
export function markRequest(method: string): void {
  scope.enterWith({ quiet: method === 'GET' || method === 'HEAD', at: Date.now() });
}

function isQuiet(): boolean {
  const current = scope.getStore();
  return Boolean(current?.quiet) && Date.now() - current!.at < SCOPE_TTL_MS;
}

// --- Announcing --------------------------------------------------------------

/** Long enough to fold one save's many writes into one event; short enough to feel instant. */
const FLUSH_AFTER_MS = 250;
/** A steady stream of writes still gets through at least this often. */
const FLUSH_AT_MOST_MS = 1_000;

function flush(): void {
  pending.timer = null;
  if (pending.models.size === 0) return;
  const models = [...pending.models];
  pending.models.clear();
  try {
    publishAll(CHANGED_EVENT, { models, at: Date.now() });
  } catch {
    // A closed stream is cleaned up by the bus; nothing else to do.
  }
}

/**
 * Reports that rows of `model` changed. Never throws and never waits: a save
 * must not fail, or slow down, because of who is or is not listening.
 */
export function announceWrite(model: string | undefined, result?: unknown): void {
  try {
    if (!model || SILENT_MODELS.has(model) || isQuiet()) return;
    // A bulk write that matched nothing changed nothing.
    if (result && typeof result === 'object' && 'count' in result && (result as { count: unknown }).count === 0) return;

    const now = Date.now();
    if (pending.models.size === 0) pending.firstAt = now;
    pending.models.add(model);
    if (pending.timer) clearTimeout(pending.timer);
    const wait = Math.max(0, Math.min(FLUSH_AFTER_MS, pending.firstAt + FLUSH_AT_MOST_MS - now));
    pending.timer = setTimeout(flush, wait);
    pending.timer.unref?.();
  } catch {
    // Live updates are a convenience; the write itself already succeeded.
  }
}

/** The table a raw `INSERT`, `UPDATE` or `DELETE` touches, when it can be read off the SQL. */
export function tableOfRawWrite(args: unknown): string | undefined {
  const first = Array.isArray(args) ? args[0] : args;
  const sql =
    typeof first === 'string'
      ? first
      : first && typeof first === 'object' && 'strings' in first && Array.isArray((first as { strings: unknown }).strings)
        ? (first as { strings: string[] }).strings.join(' ')
        : Array.isArray(first)
          ? first.join(' ')
          : '';
  return sql.match(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:"public"\.)?"?([A-Za-z_]+)"?/i)?.[1];
}
