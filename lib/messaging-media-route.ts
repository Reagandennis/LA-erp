import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import type { MessagingProvider } from './messaging-accounts';
import { readCache, writeCache } from './messaging-media-cache';
import { type MessagingContext, resolveMessagingRequest } from './messaging-routes';
import { enforceRateLimit } from './rate-limit';
import { getUploadLimitMb, mbToBytes } from './upload-limits';

/**
 * Shared handlers behind `GET /api/<service>/media` and
 * `POST /api/<service>/send-media`.
 *
 * The three providers differ only in how bytes are fetched and sent, so each
 * route file supplies those two functions and the module slug; everything else
 * — auth, rate limiting, size caps, header hygiene — lives here once.
 */

export interface FetchedMedia {
  bytes: Buffer;
  mimeType: string;
  fileName: string | null;
}

export interface SendOutcome {
  ok: boolean;
  error?: string;
  /** Provider's id for the sent message, when it reports one. */
  messageId?: string;
}

export interface SentFile {
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}

interface MediaRouteConfig<S> {
  /** Provider slug; also the module permission checked. */
  provider: MessagingProvider;
  /**
   * Turn the caller's linked account into whatever the provider keys on — the
   * platform user id for Telegram, the CLI account handle for Signal/WhatsApp.
   * Returning null means "not linked", which is a 409 rather than an error.
   */
  scopeOf: (ctx: MessagingContext) => S | null;
  getMedia: (scope: S, chatId: string, ref: string) => Promise<FetchedMedia | null>;
  sendMedia: (
    scope: S,
    chatId: string,
    file: { bytes: Buffer; mimeType: string; fileName: string },
    caption: string,
  ) => Promise<SendOutcome>;
  /**
   * Called after a successful send, for providers that don't echo our own
   * messages back and so need the mirror updated by hand.
   */
  onSent?: (ctx: MessagingContext, chatId: string, result: SendOutcome, file: SentFile, caption: string) => Promise<void>;
}

/**
 * Content types we are willing to echo back into a browser response.
 * Anything else is forced to a download so a hostile attachment can't be
 * rendered inline as HTML/SVG in the app's origin.
 */
const INLINE_SAFE = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'application/pdf',
]);

/**
 * At most this many provider downloads in flight per server process.
 *
 * A thread with 200 photos fires 200 media requests on first open. Each one
 * holds a whole attachment in memory (and, for wacli, a `docker exec`
 * process), so without a ceiling the peak is 200 × attachment size. Requests
 * beyond the ceiling wait their turn; the browser shows them a moment later.
 */
const MAX_CONCURRENT_DOWNLOADS = 4;

declare global {
  var messagingMediaDownloadQueueGlobal: { active: number; waiting: Array<() => void> } | undefined;
}

function downloadQueue() {
  globalThis.messagingMediaDownloadQueueGlobal ??= { active: 0, waiting: [] };
  return globalThis.messagingMediaDownloadQueueGlobal;
}

/** Run `task` once a download slot is free. */
async function withDownloadSlot<T>(task: () => Promise<T>): Promise<T> {
  const queue = downloadQueue();
  if (queue.active >= MAX_CONCURRENT_DOWNLOADS) {
    await new Promise<void>((resolve) => queue.waiting.push(resolve));
  }
  queue.active++;
  try {
    return await task();
  } finally {
    queue.active--;
    queue.waiting.shift()?.();
  }
}

/** Strip anything that could break out of a quoted header value. */
function safeFileName(name: string | null): string {
  const base = (name ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  return base || 'attachment';
}

export function createMediaGET<S>(config: MediaRouteConfig<S>) {
  return async function GET(request: NextRequest) {
    const { ctx, response } = await resolveMessagingRequest(request, config.provider);
    if (response || !ctx) return response;
    const scope = config.scopeOf(ctx);
    if (scope === null) {
      return NextResponse.json({ error: 'Link your account first.' }, { status: 409 });
    }

    const { searchParams } = new URL(request.url);
    const chatId = (searchParams.get('chatId') ?? '').trim();
    const ref = (searchParams.get('ref') ?? '').trim();
    if (!chatId || !ref) {
      return NextResponse.json({ error: 'chatId and ref are required.' }, { status: 400 });
    }

    // Downloads hit the provider (and for wacli, the WhatsApp servers), so keep
    // a per-user ceiling on how hard a page can pull.
    const rateLimit = await enforceRateLimit({
      scope: `${config.provider}.media.get`,
      key: `${ctx.userId}`,
      limit: 240,
      windowMs: 60 * 1000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many media requests.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }

    // Cache first: a thread full of photos would otherwise fire one provider
    // download per image every time it is opened.
    let media: FetchedMedia | null = ctx.account
      ? await readCache(ctx.account.id, chatId, ref)
      : null;

    if (!media) {
      try {
        media = await withDownloadSlot(() => config.getMedia(scope, chatId, ref));
      } catch {
        media = null;
      }
      if (media && ctx.account) {
        await writeCache(ctx.account.id, chatId, ref, media);
      }
    }
    if (!media) return NextResponse.json({ error: 'Media unavailable.' }, { status: 404 });

    const type = (media.mimeType || 'application/octet-stream').toLowerCase().split(';')[0]!.trim();
    const inline = INLINE_SAFE.has(type);
    const fileName = safeFileName(media.fileName);

    return new NextResponse(new Uint8Array(media.bytes), {
      status: 200,
      headers: {
        'Content-Type': inline ? type : 'application/octet-stream',
        'Content-Length': String(media.bytes.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`,
        // Attachments are per-conversation and permission-gated: never let a
        // shared cache hold them, but allow the tab to reuse its own copy.
        'Cache-Control': 'private, max-age=300, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  };
}

export function createSendMediaPOST<S>(config: MediaRouteConfig<S>) {
  return async function POST(request: NextRequest) {
    const { ctx, response } = await resolveMessagingRequest(request, config.provider);
    if (response || !ctx) return response;
    const scope = config.scopeOf(ctx);
    if (scope === null) {
      return NextResponse.json({ error: 'Link your account first.' }, { status: 409 });
    }

    const rateLimit = await enforceRateLimit({
      scope: `${config.provider}.media.send`,
      key: `${ctx.userId}`,
      limit: 30,
      windowMs: 60 * 1000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many attachments sent. Slow down and try again.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Expected a multipart upload.' }, { status: 400 });
    }

    const chatId = String(form.get('chatId') ?? '').trim();
    const caption = String(form.get('caption') ?? '').trim();
    const file = form.get('file');
    if (!chatId) return NextResponse.json({ error: 'A chat id is required.' }, { status: 400 });
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
    }

    const limitMb = await getUploadLimitMb('fileMb');
    const maxBytes = mbToBytes(limitMb);
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `Attachments are limited to ${limitMb} MB.` },
        { status: 413 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const sent: SentFile = {
      mimeType: file.type || 'application/octet-stream',
      fileName: safeFileName(file.name),
      sizeBytes: bytes.length,
    };
    const result = await config.sendMedia(scope, chatId, { bytes, ...sent }, caption);

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Send failed.' }, { status: 502 });
    }
    if (config.onSent) await config.onSent(ctx, chatId, result, sent, caption);
    return NextResponse.json({ ok: true });
  };
}
