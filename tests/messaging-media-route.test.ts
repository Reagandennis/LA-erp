import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { resolveMessagingRequest, enforceRateLimit, getUploadLimitMb, readCache, writeCache } =
  vi.hoisted(() => ({
    resolveMessagingRequest: vi.fn(),
    enforceRateLimit: vi.fn(),
    getUploadLimitMb: vi.fn(),
    readCache: vi.fn(),
    writeCache: vi.fn(),
  }));

vi.mock('../lib/messaging-media-cache', () => ({
  readCache,
  writeCache,
  withDownloadSlot: <T>(task: () => Promise<T>) => task(),
}));

vi.mock('../lib/messaging-routes', () => ({ resolveMessagingRequest }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit }));
vi.mock('../lib/upload-limits', () => ({
  getUploadLimitMb,
  mbToBytes: (mb: number) => mb * 1024 * 1024,
}));

import { createMediaGET, createSendMediaPOST } from '../lib/messaging-media-route';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function get(query: string) {
  return new NextRequest(`http://localhost/api/telegram/media?${query}`);
}

describe('media routes', () => {
  const getMedia = vi.fn();
  const sendMedia = vi.fn();
  // scopeOf turns the caller's linked account into the provider's key; a null
  // return means "not linked".
  const config = {
    provider: 'telegram' as const,
    scopeOf: (ctx: { account: { handle: string } | null }) => ctx.account?.handle ?? null,
    getMedia,
    sendMedia,
  };
  const LINKED = { userId: 1, account: { id: 3, handle: 'acct-1' } };

  beforeEach(() => {
    resolveMessagingRequest.mockReset();
    enforceRateLimit.mockReset();
    getMedia.mockReset();
    sendMedia.mockReset();
    getUploadLimitMb.mockReset();

    readCache.mockReset();
    writeCache.mockReset();
    readCache.mockResolvedValue(null);
    writeCache.mockResolvedValue(undefined);
    resolveMessagingRequest.mockResolvedValue({ ctx: LINKED, response: null });
    enforceRateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 });
    getUploadLimitMb.mockResolvedValue(10);
  });

  it('passes through a 401 and never touches the provider', async () => {
    resolveMessagingRequest.mockResolvedValue({
      ctx: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const res = await createMediaGET(config)(get('chatId=1&ref=2'));

    expect(res.status).toBe(401);
    expect(getMedia).not.toHaveBeenCalled();
  });

  it('403s a user without the module', async () => {
    resolveMessagingRequest.mockResolvedValue({
      ctx: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const res = await createMediaGET(config)(get('chatId=1&ref=2'));

    expect(res.status).toBe(403);
    expect(getMedia).not.toHaveBeenCalled();
  });

  it('409s a user who has not linked an account yet', async () => {
    resolveMessagingRequest.mockResolvedValue({
      ctx: { userId: 1, account: null },
      response: null,
    });

    const res = await createMediaGET(config)(get('chatId=1&ref=2'));

    expect(res.status).toBe(409);
    expect(getMedia).not.toHaveBeenCalled();
  });

  it('scopes the provider call to the caller\'s own account', async () => {
    getMedia.mockResolvedValue({ bytes: PNG, mimeType: 'image/png', fileName: 'a.png' });

    await createMediaGET(config)(get('chatId=99&ref=5'));

    // The account comes from the resolved context, never from the query string.
    expect(getMedia).toHaveBeenCalledWith('acct-1', '99', '5');
  });

  it('requires both chatId and ref', async () => {
    for (const q of ['chatId=1', 'ref=2', '']) {
      const res = await createMediaGET(config)(get(q));
      expect(res.status).toBe(400);
    }
    expect(getMedia).not.toHaveBeenCalled();
  });

  it('streams a known-safe image inline', async () => {
    getMedia.mockResolvedValue({ bytes: PNG, mimeType: 'image/png', fileName: 'shot.png' });

    const res = await createMediaGET(config)(get('chatId=99&ref=5'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="shot.png"');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(getMedia).toHaveBeenCalledWith('acct-1', '99', '5');
  });

  it('forces a download for types that could execute in the origin', async () => {
    // An SVG or HTML attachment rendered inline would run in the app's origin.
    for (const mimeType of ['image/svg+xml', 'text/html', 'application/javascript']) {
      getMedia.mockResolvedValue({ bytes: PNG, mimeType, fileName: 'x' });
      const res = await createMediaGET(config)(get('chatId=1&ref=2'));
      expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
      expect(res.headers.get('Content-Disposition')).toContain('attachment;');
    }
  });

  it('sanitises a hostile filename out of the header', async () => {
    getMedia.mockResolvedValue({
      bytes: PNG,
      mimeType: 'image/png',
      fileName: 'a"; drop\r\nX-Evil: 1',
    });

    const res = await createMediaGET(config)(get('chatId=1&ref=2'));

    const disposition = res.headers.get('Content-Disposition')!;
    // What matters is that CR/LF and the closing quote are gone, so nothing can
    // terminate the header early and inject one of its own. Surviving letters
    // are just filename text.
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    expect(disposition.match(/"/g)).toHaveLength(2);
    expect(disposition).toBe('inline; filename="a___drop__X-Evil__1"');
  });

  it('serves a cached attachment without touching the provider', async () => {
    // A thread of 200 photos would otherwise fire 200 provider downloads on
    // every open.
    readCache.mockResolvedValue({ bytes: PNG, mimeType: 'image/png', fileName: 'c.png' });

    const res = await createMediaGET(config)(get('chatId=1&ref=2'));

    expect(res.status).toBe(200);
    expect(getMedia).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it('caches a provider fetch so the next request is free', async () => {
    getMedia.mockResolvedValue({ bytes: PNG, mimeType: 'image/png', fileName: 'n.png' });

    await createMediaGET(config)(get('chatId=1&ref=2'));

    expect(writeCache).toHaveBeenCalledWith(3, '1', '2', expect.objectContaining({ mimeType: 'image/png' }));
  });

  it('does not cache a failed fetch', async () => {
    getMedia.mockResolvedValue(null);

    await createMediaGET(config)(get('chatId=1&ref=2'));

    expect(writeCache).not.toHaveBeenCalled();
  });

  it('404s when the provider has no bytes', async () => {
    getMedia.mockResolvedValue(null);
    const res = await createMediaGET(config)(get('chatId=1&ref=2'));
    expect(res.status).toBe(404);
  });

  it('404s instead of surfacing a provider exception', async () => {
    getMedia.mockRejectedValue(new Error('boom'));
    const res = await createMediaGET(config)(get('chatId=1&ref=2'));
    expect(res.status).toBe(404);
  });

  it('rate limits downloads', async () => {
    enforceRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 12 });

    const res = await createMediaGET(config)(get('chatId=1&ref=2'));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('12');
    expect(getMedia).not.toHaveBeenCalled();
  });

  // --- uploads -------------------------------------------------------------

  function upload(fields: Record<string, string | File>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return new NextRequest('http://localhost/api/telegram/send-media', {
      method: 'POST',
      body: form,
    });
  }

  it('sends an uploaded file with its caption', async () => {
    sendMedia.mockResolvedValue({ ok: true });
    const file = new File([PNG], 'photo.png', { type: 'image/png' });

    const res = await createSendMediaPOST(config)(
      upload({ chatId: '42', caption: 'look', file }),
    );

    expect(res.status).toBe(200);
    expect(sendMedia).toHaveBeenCalledWith(
      'acct-1',
      '42',
      expect.objectContaining({ mimeType: 'image/png', fileName: 'photo.png' }),
      'look',
    );
    expect(sendMedia.mock.calls[0]![2].bytes.equals(PNG)).toBe(true);
  });

  it('rejects an upload over the configured limit', async () => {
    getUploadLimitMb.mockResolvedValue(1);
    const big = new File([Buffer.alloc(2 * 1024 * 1024)], 'big.bin', {
      type: 'application/octet-stream',
    });

    const res = await createSendMediaPOST(config)(upload({ chatId: '42', file: big }));
    const payload = await res.json();

    expect(res.status).toBe(413);
    expect(payload.error).toContain('1 MB');
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it('rejects a missing file or chat id', async () => {
    const file = new File([PNG], 'p.png', { type: 'image/png' });

    expect((await createSendMediaPOST(config)(upload({ file }))).status).toBe(400);
    expect((await createSendMediaPOST(config)(upload({ chatId: '42' }))).status).toBe(400);
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it('maps a provider send failure to 502', async () => {
    sendMedia.mockResolvedValue({ ok: false, error: 'upload rejected' });
    const file = new File([PNG], 'p.png', { type: 'image/png' });

    const res = await createSendMediaPOST(config)(upload({ chatId: '42', file }));
    const payload = await res.json();

    expect(res.status).toBe(502);
    expect(payload.error).toBe('upload rejected');
  });
});
