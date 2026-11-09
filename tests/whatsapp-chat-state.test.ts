import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// --- wacli: the binary is never run; its argv is what matters ---------------

const { runWacli } = vi.hoisted(() => ({ runWacli: vi.fn() }));
vi.mock('../lib/wacli-runtime', () => ({ runWacli, wacliScratch: () => ({}) }));
vi.mock('../lib/whatsapp-sync', () => ({ syncStatus: vi.fn(() => ({ running: true })) }));

// --- Prisma mirror -------------------------------------------------------------

const { findMany, findUnique, updateMany, groupBy, publish } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  groupBy: vi.fn(),
  publish: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({
  prisma: {
    messagingChat: { findMany, findUnique, updateMany, groupBy, upsert: vi.fn(), count: vi.fn() },
    messagingMessage: { findMany: vi.fn(), create: vi.fn(), groupBy: vi.fn() },
    messagingAccount: { findMany: vi.fn() },
  },
}));
vi.mock('../lib/chat-bus', () => ({ publish }));

// --- Route gate ----------------------------------------------------------------

const { resolveMessagingRequest } = vi.hoisted(() => ({ resolveMessagingRequest: vi.fn() }));
vi.mock('../lib/messaging-routes', () => ({ resolveMessagingRequest }));

const JID = '120363409684536137@g.us';
const LINKED = { userId: 1, account: { id: 3, handle: 'laerp-user-1', provider: 'whatsapp' } };
const FOREVER = new Date('9999-12-31T00:00:00.000Z');

function wacliOk() {
  runWacli.mockResolvedValue({ stdout: JSON.stringify({ success: true, data: { ok: true }, error: null }), stderr: '', error: null });
}

function post(body: unknown) {
  return new NextRequest('http://localhost/api/whatsapp/chat-state?account=3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ROW = {
  chatId: JID,
  kind: 'group',
  name: 'Ops',
  lastMessageAt: new Date('2026-11-01T10:00:00Z'),
  unreadCount: 2,
  archived: false,
  pinned: false,
  mutedUntil: null as Date | null,
};

beforeEach(() => {
  vi.resetModules();
  runWacli.mockReset();
  findMany.mockReset();
  findUnique.mockReset();
  updateMany.mockReset();
  groupBy.mockReset();
  publish.mockReset();
  resolveMessagingRequest.mockReset();
  resolveMessagingRequest.mockResolvedValue({ ctx: LINKED, response: null });
  updateMany.mockResolvedValue({ count: 1 });
  findUnique.mockResolvedValue(ROW);
  findMany.mockResolvedValue([]);
  groupBy.mockResolvedValue([]);
});

describe('wacli chat state commands', () => {
  it('mutes with the chosen duration in seconds and a deadline inside ours', async () => {
    wacliOk();
    const { setChatState } = await import('../lib/wacli');

    expect(await setChatState('laerp-user-1', JID, 'mute', '8h')).toEqual({ ok: true });
    expect(runWacli.mock.calls[0]![0]).toEqual([
      '--json',
      '--account',
      'laerp-user-1',
      '--timeout',
      '25s',
      'chats',
      'mute',
      '--chat',
      JID,
      '--duration',
      '28800s',
    ]);
  });

  it('mutes for good with a zero duration, and never sends one for the other actions', async () => {
    wacliOk();
    const { setChatState } = await import('../lib/wacli');

    await setChatState('laerp-user-1', JID, 'mute');
    expect(runWacli.mock.calls[0]![0]).toEqual(expect.arrayContaining(['--duration', '0s']));

    for (const action of ['unmute', 'archive', 'unarchive', 'pin', 'unpin'] as const) {
      runWacli.mockClear();
      await setChatState('laerp-user-1', JID, action);
      const args = runWacli.mock.calls[0]![0] as string[];
      expect(args).toEqual(expect.arrayContaining(['chats', action, '--chat', JID]));
      expect(args).not.toContain('--duration');
    }
  });

  it("reports wacli's own error instead of throwing", async () => {
    runWacli.mockResolvedValue({
      stdout: JSON.stringify({ success: false, data: null, error: 'chat not found' }),
      stderr: '',
      error: null,
    });
    const { setChatState } = await import('../lib/wacli');
    expect(await setChatState('laerp-user-1', JID, 'archive')).toEqual({ ok: false, error: 'chat not found' });
  });
});

describe('POST /api/whatsapp/chat-state', () => {
  it('rejects an action or duration that is not on the list, without touching wacli', async () => {
    const { POST } = await import('../app/api/whatsapp/chat-state/route');

    const bad = await POST(post({ id: JID, action: 'delete' }));
    expect(bad.status).toBe(400);
    const badDuration = await POST(post({ id: JID, action: 'mute', duration: '1y' }));
    expect(badDuration.status).toBe(400);
    const noId = await POST(post({ action: 'mute' }));
    expect(noId.status).toBe(400);

    expect(runWacli).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('changes the account first, then the mirror, and returns the chat as stored', async () => {
    wacliOk();
    const until = new Date('2026-11-02T10:00:00Z');
    findUnique.mockResolvedValue({ ...ROW, mutedUntil: until });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
    try {
      const { POST } = await import('../app/api/whatsapp/chat-state/route');
      const r = await POST(post({ id: JID, action: 'mute', duration: '1w' }));
      expect(r.status).toBe(200);

      const args = runWacli.mock.calls[0]![0] as string[];
      expect(args).toEqual(expect.arrayContaining(['--account', 'laerp-user-1', 'chats', 'mute', '--chat', JID, '--duration', '604800s']));

      // Scoped to the caller's own account, never just the chat id.
      expect(updateMany).toHaveBeenCalledWith({
        where: { accountId: 3, chatId: JID },
        data: { mutedUntil: new Date('2026-11-08T10:00:00Z') },
      });
      // Other open tabs learn of it.
      expect(publish).toHaveBeenCalledWith(1, 'messaging', expect.objectContaining({ accountId: 3, chatIds: [JID], live: false }));

      const body = (await r.json()) as { chat: { mutedUntil: string; archived: boolean } };
      expect(body.chat.mutedUntil).toBe(until.toISOString());
      expect(body.chat.archived).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stores an open-ended mute as the far-future sentinel and unmute as null', async () => {
    wacliOk();
    const { POST } = await import('../app/api/whatsapp/chat-state/route');

    await POST(post({ id: JID, action: 'mute' }));
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { mutedUntil: FOREVER } }));

    await POST(post({ id: JID, action: 'unmute' }));
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { mutedUntil: null } }));

    await POST(post({ id: JID, action: 'archive' }));
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { archived: true } }));

    await POST(post({ id: JID, action: 'pin' }));
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { pinned: true } }));
  });

  it('leaves the mirror alone when WhatsApp refused the change', async () => {
    runWacli.mockResolvedValue({ stdout: '', stderr: 'not connected', error: new Error('exit 1') });
    const { POST } = await import('../app/api/whatsapp/chat-state/route');

    const r = await POST(post({ id: JID, action: 'archive' }));
    expect(r.status).toBe(502);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('passes the gate’s response through untouched', async () => {
    resolveMessagingRequest.mockResolvedValue({
      ctx: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });
    const { POST } = await import('../app/api/whatsapp/chat-state/route');
    const r = await POST(post({ id: JID, action: 'archive' }));
    expect(r.status).toBe(403);
    expect(runWacli).not.toHaveBeenCalled();
  });
});

describe('mirror: muted and archived chats', () => {
  it('keeps them out of the unread badges', async () => {
    const { unreadChatCounts } = await import('../lib/messaging-repo');
    await unreadChatCounts([3]);

    const where = groupBy.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({ accountId: { in: [3] }, unreadCount: { gt: 0 }, archived: false });
    expect(where.OR).toEqual([{ mutedUntil: null }, { mutedUntil: { lte: expect.any(Date) } }]);
  });

  it('lists pinned chats first and reports an expired mute as none', async () => {
    findMany.mockResolvedValue([
      { ...ROW, chatId: 'a@g.us', pinned: true, mutedUntil: new Date('2000-01-01T00:00:00Z') },
      { ...ROW, chatId: 'b@newsletter', kind: 'channel', archived: true, mutedUntil: FOREVER },
    ]);
    const { listChats } = await import('../lib/messaging-repo');
    const chats = await listChats(3);

    expect(findMany.mock.calls[0]![0].orderBy).toEqual([{ pinned: 'desc' }, { lastMessageAt: 'desc' }]);
    expect(chats[0]).toMatchObject({ id: 'a@g.us', pinned: true, mutedUntil: null });
    expect(chats[1]).toMatchObject({ id: 'b@newsletter', kind: 'channel', archived: true, mutedUntil: FOREVER.toISOString() });
  });

  it('raises no alert preview for a live message in a muted chat', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.messagingMessage.create as ReturnType<typeof vi.fn>).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      mediaKind: null,
      mediaRef: null,
      mediaMime: null,
      mediaName: null,
      mediaSize: null,
    }));
    (prisma.messagingChat.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
    findMany.mockResolvedValue([{ chatId: JID, mutedUntil: FOREVER }]);

    const { ingestMessages } = await import('../lib/messaging-repo');
    await ingestMessages(3, 1, [
      {
        chatId: JID,
        chatName: 'Ops',
        chatKind: 'group',
        messageId: 'M1',
        senderName: 'Ada',
        fromMe: false,
        text: 'ping',
        at: new Date(),
      },
    ]);

    const event = publish.mock.calls[0]![2] as { live: boolean; preview: unknown };
    expect(event.live).toBe(true);
    expect(event.preview).toBeNull();
  });
});

describe('WhatsApp channels in the mirror', () => {
  it('recognises a channel post and names the channel as its sender', async () => {
    const { wacliToIngest } = await import('../lib/messaging-ingest');
    const out = wacliToIngest({
      ChatJID: '120363313617097254@newsletter',
      ChatName: 'Naivas Supermarket',
      MsgID: 'N1',
      SenderJID: '120363313617097254@newsletter',
      SenderName: '',
      Timestamp: '2026-10-30T07:35:57Z',
      MediaType: 'image',
    });
    expect(out).toMatchObject({
      chatKind: 'channel',
      chatName: 'Naivas Supermarket',
      chatNameIsFallback: false,
      senderName: 'Naivas Supermarket',
    });
  });

  it('never dresses a channel id up as a phone number', async () => {
    const { wacliToIngest } = await import('../lib/messaging-ingest');
    const out = wacliToIngest({ ChatJID: '120363313617097254@newsletter', MsgID: 'N2', Text: 'hi' });
    expect(out?.chatName).toBe('120363313617097254');
    expect(out?.chatNameIsFallback).toBe(true);
  });

  it("translates wacli's muted_until", async () => {
    const { wacliMutedUntil } = await import('../lib/messaging-ingest');
    expect(wacliMutedUntil(0)).toBeNull();
    expect(wacliMutedUntil(undefined)).toBeNull();
    expect(wacliMutedUntil(-1)).toEqual(FOREVER);
    expect(wacliMutedUntil(1_794_202_875)).toEqual(new Date(1_794_202_875 * 1000));
  });
});
