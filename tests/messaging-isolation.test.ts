import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { findMany, count, findFirst } = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  findFirst: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({
  prisma: {
    messagingChat: { findMany, count, upsert: vi.fn(), updateMany: vi.fn() },
    messagingMessage: { findMany, count, findFirst, create: vi.fn() },
  },
}));
vi.mock('../lib/chat-bus', () => ({ publish: vi.fn() }));

const ADA = '+15551110000';

const { requireRequestAuth, getAccount, userHasRole, userHasModule } = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  getAccount: vi.fn(),
  userHasRole: vi.fn(),
  userHasModule: vi.fn(),
}));

/**
 * The security property this file exists for: a linked account is private to
 * the user who linked it. Two people using the Signal module at once must never
 * see each other's messages, and a route must take the account from the session
 * rather than from anything the caller sends.
 */
describe('mirror queries are scoped to one account', () => {
  beforeEach(() => {
    vi.resetModules();
    findMany.mockReset();
    count.mockReset();
    findFirst.mockReset();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    findFirst.mockResolvedValue(null);
  });

  it('filters chats by accountId', async () => {
    const { listChats } = await import('../lib/messaging-repo');
    await listChats(7);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: 7 } }),
    );
  });

  it('filters a thread by accountId AND chatId', async () => {
    const { listThread } = await import('../lib/messaging-repo');
    await listThread(7, '+15559990001');

    // Without the accountId term, one user's chat id would read another's rows.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: 7, chatId: '+15559990001' } }),
    );
  });

  it('pages backwards with `before` instead of refetching everything', async () => {
    const { listThread } = await import('../lib/messaging-repo');
    const cutoff = new Date('2026-08-26T10:00:00Z');
    await listThread(7, 'chat-1', 50, cutoff);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 7, chatId: 'chat-1', at: { lt: cutoff } },
        take: 50,
      }),
    );
  });

  it('counts per account, never globally', async () => {
    const { counts } = await import('../lib/messaging-repo');
    await counts(7);

    for (const call of count.mock.calls) {
      expect(call[0]).toEqual({ where: { accountId: 7 } });
    }
  });

  it('resolves media only within the caller\'s own account', async () => {
    const { findMedia } = await import('../lib/messaging-repo');
    await findMedia(7, 'chat-1', 'att-1');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 7, chatId: 'chat-1', mediaRef: 'att-1' },
      }),
    );
  });
});

describe('resolveMessagingRequest', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../lib/request-auth', () => ({ requireRequestAuth }));
    vi.doMock('../lib/messaging-accounts', () => ({ getAccount }));
    vi.doMock('../lib/user', () => ({ userHasRole, userHasModule }));
    vi.doMock('../lib/rbac', () => ({ ADMIN_ROLE_NAME: 'admin' }));
    requireRequestAuth.mockReset();
    getAccount.mockReset();
    userHasRole.mockReset();
    userHasModule.mockReset();
    userHasRole.mockReturnValue(false);
    userHasModule.mockReturnValue(true);
  });

  const req = () => new NextRequest('http://localhost/api/signal/chats');

  it('looks the account up for the SESSION user, not a requested one', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 77 } }, response: null });
    getAccount.mockResolvedValue({ id: 1, userId: 77, provider: 'signal', handle: ADA, label: null, session: null });

    const { resolveMessagingRequest } = await import('../lib/messaging-routes');
    const result = await resolveMessagingRequest(req(), 'signal');

    expect(getAccount).toHaveBeenCalledWith(77, 'signal');
    expect(result.ctx?.userId).toBe(77);
    expect(result.ctx?.account?.handle).toBe(ADA);
  });

  it('picks one of the caller\'s own accounts with ?account=', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 77 } }, response: null });
    getAccount.mockResolvedValue({ id: 12, userId: 77, provider: 'whatsapp', handle: 'laerp-user-77-0a1b2c3d', label: null, session: null });

    const { resolveMessagingRequest } = await import('../lib/messaging-routes');
    const result = await resolveMessagingRequest(new NextRequest('http://localhost/api/whatsapp/chats?account=12'), 'whatsapp');

    // The id is looked up among the session user's accounts, never on its own.
    expect(getAccount).toHaveBeenCalledWith(77, 'whatsapp', 12);
    expect(result.ctx?.account?.id).toBe(12);
  });

  it('404s an account id that is not the caller\'s, instead of falling back to another', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 77 } }, response: null });
    getAccount.mockResolvedValue(null);

    const { resolveMessagingRequest } = await import('../lib/messaging-routes');
    const result = await resolveMessagingRequest(new NextRequest('http://localhost/api/whatsapp/chats?account=99'), 'whatsapp');

    expect(result.ctx).toBeNull();
    expect(result.response?.status).toBe(404);
  });

  it('400s a malformed account id without looking anything up', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 77 } }, response: null });

    const { resolveMessagingRequest } = await import('../lib/messaging-routes');
    for (const bad of ['abc', '-1', '1.5', '0']) {
      const result = await resolveMessagingRequest(new NextRequest(`http://localhost/api/whatsapp/chats?account=${bad}`), 'whatsapp');
      expect(result.response?.status).toBe(400);
    }
    expect(getAccount).not.toHaveBeenCalled();
  });

  it('returns a null account rather than failing when the user has not linked', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 5 } }, response: null });
    getAccount.mockResolvedValue(null);

    const { resolveMessagingRequest } = await import('../lib/messaging-routes');
    const result = await resolveMessagingRequest(req(), 'signal');

    expect(result.response).toBeNull();
    expect(result.ctx?.account).toBeNull();
  });

  it('403s a user without the module, and never looks up an account', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 5 } }, response: null });
    userHasModule.mockReturnValue(false);

    const { resolveMessagingRequest } = await import('../lib/messaging-routes');
    const result = await resolveMessagingRequest(req(), 'signal');

    expect(result.response?.status).toBe(403);
    expect(getAccount).not.toHaveBeenCalled();
  });

  it('passes an unauthenticated response straight through', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const { resolveMessagingRequest } = await import('../lib/messaging-routes');
    const result = await resolveMessagingRequest(req(), 'signal');

    expect(result.response?.status).toBe(401);
    expect(getAccount).not.toHaveBeenCalled();
  });
});
