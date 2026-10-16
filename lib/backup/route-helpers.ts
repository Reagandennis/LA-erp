import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { enforceRateLimit } from '../rate-limit';
import { requireAdminRequest } from '../request-auth';

/** Admin-only, rate-limited: the common front door of every backup route. */
export async function backupAdminRequest(request: NextRequest, scope: string, limit = 20) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return { auth: null, response: response ?? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

  const rateLimit = await enforceRateLimit({ scope: `admin.backups.${scope}`, key: `${auth.user.id}`, limit, windowMs: 60 * 1000 });
  if (!rateLimit.allowed) {
    return {
      auth: null,
      response: NextResponse.json(
        { error: 'Too many requests. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 },
      ),
    };
  }
  return { auth, response: null };
}

export function errorResponse(error: unknown, fallback: string, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error && error.message ? error.message : fallback }, { status });
}
