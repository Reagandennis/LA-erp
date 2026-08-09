import 'server-only';

import jwt from 'jsonwebtoken';

import { getJwtSecret } from '@/lib/env';

const CONFIRM_TYPE = 'ai_action_confirm';
const EXPIRY = '10m';

export interface ConfirmPayload {
  tool: string;
  args: Record<string, unknown>;
}

/** Sign a short-lived token authorising one destructive tool call for one user. */
export function signConfirmation(userId: number, tool: string, args: Record<string, unknown>): string {
  return jwt.sign({ type: CONFIRM_TYPE, sub: String(userId), tool, args }, getJwtSecret(), {
    expiresIn: EXPIRY,
  });
}

/** Verify a confirm token belongs to this user and return the held call, or null. */
export function verifyConfirmation(token: string, userId: number): ConfirmPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as {
      type?: string;
      sub?: string;
      tool?: string;
      args?: Record<string, unknown>;
    };
    if (decoded.type !== CONFIRM_TYPE) return null;
    if (decoded.sub !== String(userId)) return null;
    if (typeof decoded.tool !== 'string') return null;
    return { tool: decoded.tool, args: decoded.args ?? {} };
  } catch {
    return null;
  }
}
