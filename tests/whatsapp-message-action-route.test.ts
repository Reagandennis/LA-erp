import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// --- Route gate ----------------------------------------------------------------

const { resolveMessagingRequest } = vi.hoisted(() => ({ resolveMessagingRequest: vi.fn() }));
vi.mock('../lib/messaging-routes', () => ({ resolveMessagingRequest }));

// --- wacli ---------------------------------------------------------------------

const wacli = vi.hoisted(() => ({
  editMessage: vi.fn(),
  getMedia: vi.fn(),
  getMessageSender: vi.fn(),
  linkedJid: vi.fn(),
  revokeMessage: vi.fn(),
  sendMedia: vi.fn(),
  sendReaction: vi.fn(),
  sendText: vi.fn(),
  checkNumbers: vi.fn(),
}));
vi.mock('../lib/wacli', () => wacli);

// --- Mirror --------------------------------------------------------------------

const repo = vi.hoisted(() => ({
  applyMessageEdit: vi.fn(),
  applyMessageRevoke: vi.fn(),
  applyReactions: vi.fn(),
  getChat: vi.fn(),
  getMessage: vi.fn(),
  recordOutgoing: vi.fn(),
  upsertChats: vi.fn(),
}));
vi.mock('../lib/messaging-repo', () => repo);

const cache = vi.hoisted(() => ({ readCache: vi.fn(), writeCache: vi.fn() }));
vi.mock('../lib/messaging-media-cache', () => cache);
vi.mock('../lib/messaging-ingest', () => ({ mediaKindFromMime: () => 'image' }));

const DM = '254712345678@s.whatsapp.net';
const GROUP = '120363409684536137@g.us';
const LINKED = { userId: 1, account: { id: 3, userId: 1, handle: 'laerp-user-1', provider: 'whatsapp', shared: false } };

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}?account=3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const OWN = {
  id: 'M1',
  chatId: DM,
  senderName: 'You',
  fromMe: true,
  text: 'hello',
  timestamp: '2026-11-09T10:00:00.000Z',
  media: null,
  senderJid: null,
  reactions: [],
  edited: false,
  revoked: false,
  forwarded: false,
};
const THEIRS = { ...OWN, id: 'M2', chatId: GROUP, senderName: 'Ada', fromMe: false, senderJid: null };

beforeEach(() => {
  vi.resetModules();
  for (const fn of [...Object.values(wacli), ...Object.values(repo), ...Object.values(cache)]) fn.mockReset();
  resolveMessagingRequest.mockReset();
  resolveMessagingRequest.mockResolvedValue({ ctx: LINKED, response: null });
  wacli.linkedJid.mockResolvedValue('254796004050@s.whatsapp.net');
  repo.applyReactions.mockResolvedValue(1);
  repo.recordOutgoing.mockResolvedValue(undefined);
});

describe('POST /api/whatsapp/message-action', () => {
  it('rejects unknown actions and messages the chat does not have', async () => {
    const { POST } = await import('../app/api/whatsapp/message-action/route');
    repo.getMessage.mockResolvedValue(OWN);

    expect((await POST(post('/api/whatsapp/message-action', { action: 'shout', chatId: DM, messageId: 'M1' }))).status).toBe(400);

    repo.getMessage.mockResolvedValue(null);
    expect((await POST(post('/api/whatsapp/message-action', { action: 'react', chatId: DM, messageId: 'M9', emoji: '👍' }))).status).toBe(404);
    expect(wacli.sendReaction).not.toHaveBeenCalled();
  });

  it("reacts to someone else's group message with their id, looking it up when the mirror lacks it", async () => {
    const { POST } = await import('../app/api/whatsapp/message-action/route');
    repo.getMessage.mockResolvedValue(THEIRS);
    wacli.getMessageSender.mockResolvedValue('254700000001@s.whatsapp.net');
    wacli.sendReaction.mockResolvedValue({ ok: true, messageId: 'R1' });

    const res = await POST(post('/api/whatsapp/message-action', { action: 'react', chatId: GROUP, messageId: 'M2', emoji: '👍' }));

    expect(res.status).toBe(200);
    expect(wacli.getMessageSender).toHaveBeenCalledWith('laerp-user-1', GROUP, 'M2');
    expect(wacli.sendReaction).toHaveBeenCalledWith('laerp-user-1', GROUP, 'M2', '👍', '254700000001@s.whatsapp.net');
    expect(repo.applyReactions).toHaveBeenCalledWith(3, 1, [
      expect.objectContaining({ chatId: GROUP, targetId: 'M2', emoji: '👍', fromMe: true, senderName: 'You' }),
    ]);
  });

  it('reacts to our own group message as ourselves, and refuses an emoji outside the set', async () => {
    const { POST } = await import('../app/api/whatsapp/message-action/route');
    repo.getMessage.mockResolvedValue({ ...OWN, chatId: GROUP });
    wacli.sendReaction.mockResolvedValue({ ok: true });

    await POST(post('/api/whatsapp/message-action', { action: 'react', chatId: GROUP, messageId: 'M1', emoji: '' }));
    expect(wacli.sendReaction).toHaveBeenCalledWith('laerp-user-1', GROUP, 'M1', '', '254796004050@s.whatsapp.net');

    const bad = await POST(post('/api/whatsapp/message-action', { action: 'react', chatId: GROUP, messageId: 'M1', emoji: '🔥' }));
    expect(bad.status).toBe(400);
    expect(wacli.sendReaction).toHaveBeenCalledTimes(1);
  });

  it('only edits and deletes our own messages, and never a deleted one', async () => {
    const { POST } = await import('../app/api/whatsapp/message-action/route');
    repo.getMessage.mockResolvedValue(THEIRS);

    expect((await POST(post('/api/whatsapp/message-action', { action: 'edit', chatId: GROUP, messageId: 'M2', text: 'x' }))).status).toBe(403);
    expect((await POST(post('/api/whatsapp/message-action', { action: 'revoke', chatId: GROUP, messageId: 'M2' }))).status).toBe(403);

    repo.getMessage.mockResolvedValue({ ...OWN, revoked: true });
    expect((await POST(post('/api/whatsapp/message-action', { action: 'edit', chatId: DM, messageId: 'M1', text: 'x' }))).status).toBe(409);
    expect(wacli.editMessage).not.toHaveBeenCalled();
    expect(wacli.revokeMessage).not.toHaveBeenCalled();
  });

  it('edits on WhatsApp first, then in the mirror', async () => {
    const { POST } = await import('../app/api/whatsapp/message-action/route');
    repo.getMessage.mockResolvedValue(OWN);
    wacli.editMessage.mockResolvedValue({ ok: true });
    repo.applyMessageEdit.mockResolvedValue({ ...OWN, text: 'hello there', edited: true });

    const res = await POST(post('/api/whatsapp/message-action', { action: 'edit', chatId: DM, messageId: 'M1', text: '  hello there ' }));

    expect(res.status).toBe(200);
    expect(wacli.editMessage).toHaveBeenCalledWith('laerp-user-1', DM, 'M1', 'hello there');
    expect(repo.applyMessageEdit).toHaveBeenCalledWith(3, 1, DM, 'M1', 'hello there');
    expect((await res.json()).message).toMatchObject({ text: 'hello there', edited: true });
  });

  it("leaves the mirror alone when WhatsApp refuses the edit", async () => {
    const { POST } = await import('../app/api/whatsapp/message-action/route');
    repo.getMessage.mockResolvedValue(OWN);
    wacli.editMessage.mockResolvedValue({ ok: false, error: 'edit window has passed' });

    const res = await POST(post('/api/whatsapp/message-action', { action: 'edit', chatId: DM, messageId: 'M1', text: 'late' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'edit window has passed' });
    expect(repo.applyMessageEdit).not.toHaveBeenCalled();
  });

  it('deletes for everyone and marks the mirror', async () => {
    const { POST } = await import('../app/api/whatsapp/message-action/route');
    repo.getMessage.mockResolvedValue(OWN);
    wacli.revokeMessage.mockResolvedValue({ ok: true });
    repo.applyMessageRevoke.mockResolvedValue({ ...OWN, revoked: true, text: 'This message was deleted' });

    const res = await POST(post('/api/whatsapp/message-action', { action: 'revoke', chatId: DM, messageId: 'M1' }));
    expect(res.status).toBe(200);
    expect(wacli.revokeMessage).toHaveBeenCalledWith('laerp-user-1', DM, 'M1');
    expect(repo.applyMessageRevoke).toHaveBeenCalledWith(3, 1, DM, 'M1');
  });

  it('forwards a text message as a new send to one of our chats, recorded as forwarded', async () => {
    const { POST } = await import('../app/api/whatsapp/message-action/route');
    repo.getMessage.mockResolvedValue(THEIRS);
    repo.getChat.mockResolvedValue({ id: DM, kind: 'dm', name: 'Ada' });
    wacli.sendText.mockResolvedValue({ ok: true, messageId: 'F1' });

    const res = await POST(post('/api/whatsapp/message-action', { action: 'forward', chatId: GROUP, messageId: 'M2', to: DM }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, chatId: DM });
    expect(wacli.sendText).toHaveBeenCalledWith('laerp-user-1', DM, 'hello');
    expect(repo.recordOutgoing).toHaveBeenCalledWith(3, 1, { chatId: DM, messageId: 'F1', text: 'hello', forwarded: true });
  });

  it('forwards an attachment from the cache, or from WhatsApp when not cached', async () => {
    const { POST } = await import('../app/api/whatsapp/message-action/route');
    const photo = { ...THEIRS, text: 'look', media: { kind: 'image', ref: 'M2', mimeType: 'image/jpeg', fileName: 'a.jpg', sizeBytes: 3 } };
    repo.getMessage.mockResolvedValue(photo);
    repo.getChat.mockResolvedValue({ id: DM, kind: 'dm', name: 'Ada' });
    cache.readCache.mockResolvedValue(null);
    wacli.getMedia.mockResolvedValue({ bytes: Buffer.from('jpg'), mimeType: 'image/jpeg', fileName: 'a.jpg' });
    wacli.sendMedia.mockResolvedValue({ ok: true, messageId: 'F2' });

    const res = await POST(post('/api/whatsapp/message-action', { action: 'forward', chatId: GROUP, messageId: 'M2', to: DM }));

    expect(res.status).toBe(200);
    expect(wacli.getMedia).toHaveBeenCalledWith('laerp-user-1', GROUP, 'M2');
    expect(wacli.sendMedia).toHaveBeenCalledWith(
      'laerp-user-1',
      DM,
      { bytes: Buffer.from('jpg'), mimeType: 'image/jpeg', fileName: 'a.jpg' },
      'look',
    );
    expect(cache.writeCache).toHaveBeenCalledWith(3, DM, 'F2', expect.objectContaining({ mimeType: 'image/jpeg' }));
    expect(repo.recordOutgoing).toHaveBeenCalledWith(
      3,
      1,
      expect.objectContaining({ chatId: DM, messageId: 'F2', forwarded: true, media: expect.objectContaining({ ref: 'F2', kind: 'image' }) }),
    );
  });

  it('refuses to forward to a chat that is not ours or to a channel', async () => {
    const { POST } = await import('../app/api/whatsapp/message-action/route');
    repo.getMessage.mockResolvedValue(OWN);

    repo.getChat.mockResolvedValue(null);
    expect((await POST(post('/api/whatsapp/message-action', { action: 'forward', chatId: DM, messageId: 'M1', to: 'x@g.us' }))).status).toBe(404);
    repo.getChat.mockResolvedValue({ id: 'n@newsletter', kind: 'channel', name: 'News' });
    expect((await POST(post('/api/whatsapp/message-action', { action: 'forward', chatId: DM, messageId: 'M1', to: 'n@newsletter' }))).status).toBe(409);
    expect(wacli.sendText).not.toHaveBeenCalled();
  });
});

describe('POST /api/messaging/new-chat (WhatsApp number check)', () => {
  it('refuses a number WhatsApp says has no account', async () => {
    const { POST } = await import('../app/api/messaging/new-chat/route');
    wacli.checkNumbers.mockResolvedValue({
      ok: true,
      results: [{ query: '+254700000000', phone: '254700000000', jid: null, registered: false, responded: true }],
    });

    const res = await POST(post('/api/messaging/new-chat', { provider: 'whatsapp', target: '+254 700 000 000' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '+254700000000 is not on WhatsApp.' });
    expect(wacli.checkNumbers).toHaveBeenCalledWith('laerp-user-1', ['+254700000000']);
    expect(repo.upsertChats).not.toHaveBeenCalled();
  });

  it('opens the chat for a registered number, and when the check itself fails', async () => {
    const { POST } = await import('../app/api/messaging/new-chat/route');
    repo.upsertChats.mockResolvedValue(undefined);

    wacli.checkNumbers.mockResolvedValue({
      ok: true,
      results: [{ query: '+254712345678', phone: '254712345678', jid: '1@lid', registered: true, responded: true }],
    });
    expect((await POST(post('/api/messaging/new-chat', { provider: 'whatsapp', target: '+254712345678' }))).status).toBe(200);

    wacli.checkNumbers.mockResolvedValue({ ok: false, error: 'sync not running' });
    expect((await POST(post('/api/messaging/new-chat', { provider: 'whatsapp', target: '+254712345678' }))).status).toBe(200);
    expect(repo.upsertChats).toHaveBeenCalledTimes(2);
  });
});
