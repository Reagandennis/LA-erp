import { publish } from './chat-bus';

/**
 * Tells a user's open browser tabs that their notification feed changed, so the
 * bell refetches at once instead of discovering it on its next poll.
 *
 * Rides the per-user Server-Sent Events stream the messaging consoles already
 * hold open (`/api/messaging/stream`), through the in-process chat bus. That
 * bus lives in this Node process's heap: it covers the single `next start`
 * the systemd unit runs, but a second replica would need a shared broker
 * (see the note in lib/chat-bus.ts).
 *
 * Never throws and never awaits: a notification write must not fail because
 * nobody is listening.
 */
export const NOTIFICATIONS_EVENT = 'notifications';

export function notifyNotificationsChanged(userIds: number | Iterable<number>): void {
  const ids = typeof userIds === 'number' ? [userIds] : [...new Set(userIds)];
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) continue;
    try {
      publish(id, NOTIFICATIONS_EVENT, { at: Date.now() });
    } catch {
      // A closed stream is cleaned up by the bus; nothing else to do.
    }
  }
}
