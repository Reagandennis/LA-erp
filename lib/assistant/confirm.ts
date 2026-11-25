import 'server-only';

import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { getJwtSecret } from '@/lib/env';

const CONFIRM_TYPE = 'ai_action_confirm';
const EXPIRY = '10m';
/** How long a spent token is remembered; longer than a token can live. */
export const CONFIRM_WINDOW_MS = 15 * 60 * 1000;

export interface HeldCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ConfirmPayload extends HeldCall {
  /** This token's own id: a confirmation is good for one use. */
  id: string;
  /** What the model had lined up after the held call; told back to it once the call has run, never run for it. */
  then: HeldCall[];
}

/** Sign a short-lived token authorising one destructive tool call for one user. */
export function signConfirmation(
  userId: number,
  tool: string,
  args: Record<string, unknown>,
  then: HeldCall[] = [],
): string {
  return jwt.sign({ type: CONFIRM_TYPE, sub: String(userId), tool, args, then: then.slice(0, 5) }, getJwtSecret(), {
    expiresIn: EXPIRY,
    jwtid: randomUUID(),
  });
}

/** Verify a confirm token belongs to this user and return the held call, or null. */
export function verifyConfirmation(token: string, userId: number): ConfirmPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as {
      type?: string;
      sub?: string;
      jti?: string;
      tool?: string;
      args?: Record<string, unknown>;
      then?: unknown;
    };
    if (decoded.type !== CONFIRM_TYPE) return null;
    if (decoded.sub !== String(userId)) return null;
    if (typeof decoded.tool !== 'string' || typeof decoded.jti !== 'string') return null;
    const then = Array.isArray(decoded.then)
      ? decoded.then.filter(
          (call): call is HeldCall => Boolean(call) && typeof (call as HeldCall).tool === 'string',
        )
      : [];
    return { id: decoded.jti, tool: decoded.tool, args: decoded.args ?? {}, then };
  } catch {
    return null;
  }
}
