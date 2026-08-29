import { NextRequest, NextResponse } from 'next/server';

import QRCode from 'qrcode';

import { recordAuditEvent } from '@/lib/audit';
import { deleteAccount, isMessagingProvider } from '@/lib/messaging-accounts';
import { cancelLink, readLink, startLink } from '@/lib/messaging-link';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { enforceRateLimit } from '@/lib/rate-limit';
import { stopIngest } from '@/lib/messaging-ingest';
import { clearCache } from '@/lib/messaging-media-cache';
import { stopTelegramMirror } from '@/lib/telegram';
import { stopSync } from '@/lib/whatsapp-sync';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * QR linking for WhatsApp / Telegram / Signal.
 *
 * A user links their OWN account: the provider is taken from the query, but the
 * user id always comes from the session cookie, never from the request body, so
 * one user can't start or read a link attempt on another's behalf.
 *
 * GET  ?provider=x   poll the current attempt (payload rendered as a QR data URL)
 * POST { provider }  start an attempt
 * DELETE ?provider=x cancel an attempt, or unlink an already-linked account
 */

function providerFrom(request: NextRequest): string {
  return (new URL(request.url).searchParams.get('provider') ?? '').trim();
}

export async function GET(request: NextRequest) {
  const provider = providerFrom(request);
  if (!isMessagingProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  }
  const { ctx, response } = await resolveMessagingRequest(request, provider);
  if (response || !ctx) return response;

  const view = readLink(ctx.userId, provider);
  if (!view) return NextResponse.json({ status: 'idle' });

  // The payload is turned into an image here so the browser never has to carry
  // a QR library, and so the raw pairing token isn't handled by page scripts.
  const qr = view.payload
    ? await QRCode.toDataURL(view.payload, { margin: 1, width: 320 })
    : null;
  return NextResponse.json({ ...view, qr });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const provider = String(body?.provider ?? '').trim();
  if (!isMessagingProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  }
  const { ctx, response } = await resolveMessagingRequest(request, provider);
  if (response || !ctx) return response;

  // Each attempt spawns a CLI process or opens an MTProto connection.
  const rateLimit = await enforceRateLimit({
    scope: 'messaging.link',
    key: `${ctx.userId}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many link attempts. Wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const view = await startLink(ctx.userId, provider);
  const qr = view.payload ? await QRCode.toDataURL(view.payload, { margin: 1, width: 320 }) : null;
  return NextResponse.json({ ...view, qr }, { status: view.status === 'error' ? 400 : 200 });
}

export async function DELETE(request: NextRequest) {
  const provider = providerFrom(request);
  if (!isMessagingProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  }
  const { ctx, response } = await resolveMessagingRequest(request, provider);
  if (response || !ctx) return response;

  cancelLink(ctx.userId, provider);
  const removed = await deleteAccount(ctx.userId, provider);
  if (removed) {
    // Tear down whatever was feeding this account's mirror.
    stopIngest(provider, removed.id);
    // Cached attachments belong to the account that is going away.
    await clearCache(removed.id);
    if (provider === 'whatsapp') stopSync(removed.handle);
    if (provider === 'telegram') stopTelegramMirror(ctx.userId);
    await recordAuditEvent({
      action: 'messaging.account.unlinked',
      entityType: 'messaging-account',
      entityId: String(removed.id),
      actorUserId: ctx.userId,
      metadata: { provider },
      request,
    });
  }
  return NextResponse.json({ ok: true, unlinked: Boolean(removed) });
}
