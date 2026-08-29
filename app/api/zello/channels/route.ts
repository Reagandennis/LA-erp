import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';
import { createZelloChannel } from '@/lib/zello-work';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Create a channel on the Zello Work network.
 *
 * Admin-only on purpose. Reading the roster is open to anyone holding the
 * radio-zello module (see ../roster/route.ts), but creating a channel writes to
 * the live network through the shared ZELLO_USERNAME service account, so every
 * module holder would otherwise act as that admin.
 */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'zello.channel.create',
    key: `${auth.user.id}`,
    limit: 10,
    windowMs: 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many channel changes. Slow down and try again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'A channel name is required.' }, { status: 400 });

  const result = await createZelloChannel(name);

  if (!result.ok) {
    // 503 when the integration simply isn't wired up; 400 means Zello (or our
    // own name check) rejected this particular name.
    return NextResponse.json(
      { error: result.error ?? 'Could not create the channel.' },
      { status: result.configured ? 400 : 503 },
    );
  }

  await recordAuditEvent({
    action: 'zello.channel.created',
    entityType: 'zello-channel',
    entityId: result.name,
    actorUserId: auth.user.id,
    metadata: { name: result.name, network: process.env.ZELLO_NETWORK ?? null },
    request,
  });

  return NextResponse.json({ ok: true, name: result.name });
}
