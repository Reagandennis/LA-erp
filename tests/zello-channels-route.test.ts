import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { requireAdminRequest, enforceRateLimit, recordAuditEvent, createZelloChannel } = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  enforceRateLimit: vi.fn(),
  recordAuditEvent: vi.fn(),
  createZelloChannel: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({ requireAdminRequest }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit }));
vi.mock('../lib/audit', () => ({ recordAuditEvent }));
vi.mock('../lib/zello-work', () => ({ createZelloChannel }));

import { POST } from '../app/api/zello/channels/route';

function post(body: unknown) {
  return new NextRequest('http://localhost/api/zello/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/zello/channels', () => {
  beforeEach(() => {
    requireAdminRequest.mockReset();
    enforceRateLimit.mockReset();
    recordAuditEvent.mockReset();
    createZelloChannel.mockReset();
    enforceRateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 });
    recordAuditEvent.mockResolvedValue(undefined);
  });

  it('passes through the 401 for an unauthenticated request', async () => {
    requireAdminRequest.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const res = await POST(post({ name: 'Ops' }));

    expect(res.status).toBe(401);
    expect(createZelloChannel).not.toHaveBeenCalled();
  });

  it('passes through the 403 for a non-admin, even with the module', async () => {
    requireAdminRequest.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const res = await POST(post({ name: 'Ops' }));

    expect(res.status).toBe(403);
    expect(createZelloChannel).not.toHaveBeenCalled();
  });

  it('rate limits repeated creates', async () => {
    requireAdminRequest.mockResolvedValue({ auth: { user: { id: 1 } }, response: null });
    enforceRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });

    const res = await POST(post({ name: 'Ops' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(createZelloChannel).not.toHaveBeenCalled();
  });

  it('rejects a missing name without calling Zello', async () => {
    requireAdminRequest.mockResolvedValue({ auth: { user: { id: 1 } }, response: null });

    const res = await POST(post({ name: '   ' }));

    expect(res.status).toBe(400);
    expect(createZelloChannel).not.toHaveBeenCalled();
  });

  it('creates the channel and writes an audit event', async () => {
    requireAdminRequest.mockResolvedValue({ auth: { user: { id: 7 } }, response: null });
    createZelloChannel.mockResolvedValue({ ok: true, configured: true, error: null, name: 'Ops North' });

    const res = await POST(post({ name: 'Ops North' }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ ok: true, name: 'Ops North' });
    expect(createZelloChannel).toHaveBeenCalledWith('Ops North');
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'zello.channel.created',
        entityType: 'zello-channel',
        entityId: 'Ops North',
        actorUserId: 7,
      }),
    );
  });

  it('maps a Zello rejection to 400 and does not audit', async () => {
    requireAdminRequest.mockResolvedValue({ auth: { user: { id: 7 } }, response: null });
    createZelloChannel.mockResolvedValue({
      ok: false,
      configured: true,
      error: 'Channel already exists',
      name: 'Ops',
    });

    const res = await POST(post({ name: 'Ops' }));
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.error).toBe('Channel already exists');
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('maps an unconfigured integration to 503', async () => {
    requireAdminRequest.mockResolvedValue({ auth: { user: { id: 7 } }, response: null });
    createZelloChannel.mockResolvedValue({
      ok: false,
      configured: false,
      error: 'Zello is not configured on this server.',
      name: 'Ops',
    });

    const res = await POST(post({ name: 'Ops' }));

    expect(res.status).toBe(503);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
