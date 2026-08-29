import 'server-only';

import { randomBytes } from 'crypto';

/**
 * Per-process secret authorising the local wacli webhook.
 *
 * It is generated once per server start and never persisted: the only holders
 * are the `wacli sync --follow --webhook` processes this app spawns itself, so
 * a restart simply mints a new one and respawns them with it.
 */
declare global {
  var messagingWebhookSecretGlobal: string | undefined;
}

export function webhookSecret(): string {
  // A pinned value keeps sync processes valid across a restart; without one we
  // mint a per-process secret and rely on orphan reaping to respawn them.
  const pinned = (process.env.MESSAGING_WEBHOOK_SECRET ?? '').trim();
  if (pinned) return pinned;
  globalThis.messagingWebhookSecretGlobal ??= randomBytes(32).toString('hex');
  return globalThis.messagingWebhookSecretGlobal;
}
