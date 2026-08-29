import 'server-only';

/**
 * Short-lived, per-user store for a Google access token.
 *
 * The browser holds the token (the shared GoogleAuthProvider obtains it), but
 * `<img src>` and download links are plain GETs — and putting an OAuth token in
 * a URL would leak it into browser history, referrers and server logs. So the
 * client hands the token over once, and afterwards every request is identified
 * by the normal session cookie.
 *
 * Memory-only and deliberately so: a restart simply asks the user to reconnect,
 * and the token is never written anywhere it could outlive its own expiry.
 */

interface DriveSession {
  token: string;
  expiresAt: number;
}

declare global {
  var googleDriveSessionsGlobal: Map<number, DriveSession> | undefined;
}

function sessions(): Map<number, DriveSession> {
  globalThis.googleDriveSessionsGlobal ??= new Map();
  return globalThis.googleDriveSessionsGlobal;
}

/**
 * Google's implicit-flow tokens last an hour. Expiring slightly early means the
 * UI prompts to reconnect rather than showing a wall of failed requests.
 */
const DEFAULT_TTL_MS = 55 * 60 * 1000;

export function storeDriveToken(userId: number, token: string, ttlMs = DEFAULT_TTL_MS): void {
  sessions().set(userId, { token, expiresAt: Date.now() + ttlMs });
}

export function getDriveToken(userId: number): string | null {
  const session = sessions().get(userId);
  if (!session) return null;
  if (Date.now() >= session.expiresAt) {
    sessions().delete(userId);
    return null;
  }
  return session.token;
}

export function clearDriveToken(userId: number): void {
  sessions().delete(userId);
}

export function driveTokenExpiry(userId: number): number | null {
  const session = sessions().get(userId);
  if (!session || Date.now() >= session.expiresAt) return null;
  return session.expiresAt;
}
