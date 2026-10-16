/**
 * In-memory pub/sub bus for Server-Sent Events delivery.
 *
 * ⚠️  Production note: This bus lives in the Node.js process heap.
 * It works perfectly for single-server deployments (Docker, a single
 * VPS, Render single instance, etc.).
 *
 * If you ever scale to multiple replicas or deploy to a serverless
 * host (Vercel, AWS Lambda) where each request may land on a different
 * process, replace this with a Redis pub/sub adapter:
 *
 *   import { createClient } from 'ioredis';
 *   const sub = createClient(); sub.subscribe('chat');
 *   sub.on('message', (_, raw) => { ... fan out to local controllers ... });
 *
 * Or use Pusher Channels (managed WebSockets, zero infra).
 */

type Controller = ReadableStreamDefaultController<Uint8Array>;

declare global {
  var chatBusSubscribersGlobal: Map<number, Set<Controller>> | undefined;
}

// userId → set of open SSE controllers for that user. Kept on globalThis like
// the other process-wide state: the background ingest started from
// instrumentation.ts can load its own copy of this module, and a bus that
// isn't shared would silently drop every event it publishes.
globalThis.chatBusSubscribersGlobal ??= new Map<number, Set<Controller>>();
const subscribers = globalThis.chatBusSubscribersGlobal;

export function subscribe(userId: number, ctrl: Controller): void {
  if (!subscribers.has(userId)) subscribers.set(userId, new Set());
  subscribers.get(userId)?.add(ctrl);
}

export function unsubscribe(userId: number, ctrl: Controller): void {
  subscribers.get(userId)?.delete(ctrl);
  if (subscribers.get(userId)?.size === 0) subscribers.delete(userId);
}

/**
 * Push an SSE event to every connected controller for `userId`.
 * Silently drops closed controllers and cleans them up.
 */
export function publish(userId: number, event: string, data: unknown): void {
  const ctrlSet = subscribers.get(userId);
  if (!ctrlSet) return;

  const payload = new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );

  const dead: Controller[] = [];
  for (const ctrl of ctrlSet) {
    try {
      ctrl.enqueue(payload);
    } catch {
      dead.push(ctrl);
    }
  }
  for (const ctrl of dead) ctrlSet.delete(ctrl);
}

/**
 * Broadcast to all members of a conversation except the sender.
 */
export function broadcastToMembers(
  memberIds: number[],
  event: string,
  data: unknown,
): void {
  for (const id of memberIds) publish(id, event, data);
}
