import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// --- wacli: the binary is never run; its argv is what matters ---------------

const { runWacli } = vi.hoisted(() => ({ runWacli: vi.fn() }));
vi.mock('../lib/wacli-runtime', () => ({ runWacli, wacliScratch: () => ({}) }));

const { syncStatus, withSyncPaused } = vi.hoisted(() => ({
  syncStatus: vi.fn(() => ({ running: true })),
  withSyncPaused: vi.fn(async (_account: string, task: () => Promise<unknown>) => task()),
}));
vi.mock('../lib/whatsapp-sync', () => ({ syncStatus, withSyncPaused }));

// --- Prisma mirror -------------------------------------------------------------

const { findUnique, update, updateMany, publish } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  publish: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({
  prisma: {
    messagingMessage: { findUnique, update, updateMany, create: vi.fn(), findMany: vi.fn() },
    messagingChat: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('../lib/chat-bus', () => ({ publish }));
vi.mock('../lib/messaging-accounts', () => ({ listAccountsForProvider: vi.fn(), isAppWacliAccountName: () => true, accountViewers: async () => [] }));
vi.mock('../lib/messaging-media-cache', () => ({ MAX_CACHED_BYTES: 1, prefetchMedia: vi.fn() }));

const ACCOUNT = 'laerp-user-1';
const GROUP = '120363409684536137@g.us';
const DM = '254712345678@s.whatsapp.net';

function wacliOk(data: unknown = { ok: true }) {
  runWacli.mockResolvedValue({ stdout: JSON.stringify({ success: true, data, error: null }), stderr: '', error: null });
}

beforeEach(() => {
  vi.resetModules();
  runWacli.mockReset();
  syncStatus.mockReset();
  syncStatus.mockReturnValue({ running: true });
  withSyncPaused.mockClear();
  findUnique.mockReset();
  update.mockReset();
  updateMany.mockReset();
  publish.mockReset();
});

describe('wacli message commands', () => {
  it('reacts through the delegated send path, naming the author for a group message', async () => {
    wacliOk({ sent: true, id: 'R1' });
    const { sendReaction } = await import('../lib/wacli');

    expect(await sendReaction(ACCOUNT, GROUP, 'M1', '👍', '254700000001@s.whatsapp.net')).toEqual({
      ok: true,
      messageId: 'R1',
    });
    expect(runWacli.mock.calls[0]![0]).toEqual([
      '--json',
      '--account',
      ACCOUNT,
      '--timeout',
      '20s',
      'send',
      'react',
      '--to',
      GROUP,
      '--id',
      'M1',
      '--reaction',
      '👍',
      '--sender',
      '254700000001@s.whatsapp.net',
      '--post-send-wait',
      '0',
    ]);
  });

  it('removes a reaction with an empty emoji and no sender for a direct chat', async () => {
    wacliOk({ sent: true, id: 'R2' });
    const { sendReaction } = await import('../lib/wacli');

    await sendReaction(ACCOUNT, DM, 'M1', '');
    const args = runWacli.mock.calls[0]![0] as string[];
    expect(args).toEqual(expect.arrayContaining(['--reaction', '']));
    expect(args).not.toContain('--sender');
  });

  it('edits through `messages edit`, delegated like a send', async () => {
    wacliOk({ edited: true, id: 'E1' });
    const { editMessage } = await import('../lib/wacli');

    expect(await editMessage(ACCOUNT, DM, 'M1', 'fixed')).toEqual({ ok: true, messageId: 'E1' });
    expect(runWacli.mock.calls[0]![0]).toEqual([
      '--json',
      '--account',
      ACCOUNT,
      '--timeout',
      '30s',
      'messages',
      'edit',
      '--chat',
      DM,
      '--id',
      'M1',
      '--message',
      'fixed',
      '--post-send-wait',
      '0',
    ]);
  });

  it('revokes with the sync paused, waiting for the store lock', async () => {
    wacliOk({ revoked: true });
    const { revokeMessage } = await import('../lib/wacli');

    expect(await revokeMessage(ACCOUNT, DM, 'M1')).toEqual({ ok: true });
    expect(withSyncPaused).toHaveBeenCalledWith(ACCOUNT, expect.any(Function));
    expect(runWacli.mock.calls[0]![0]).toEqual([
      '--json',
      '--account',
      ACCOUNT,
      '--lock-wait',
      '15s',
      '--timeout',
      '45s',
      'messages',
      'revoke',
      '--chat',
      DM,
      '--id',
      'M1',
    ]);
  });

  it("reports wacli's refusal to revoke instead of throwing", async () => {
    runWacli.mockResolvedValue({
      stdout: JSON.stringify({ success: false, data: null, error: 'message is too old to revoke' }),
      stderr: '',
      error: null,
    });
    const { revokeMessage } = await import('../lib/wacli');
    expect(await revokeMessage(ACCOUNT, DM, 'M1')).toEqual({ ok: false, error: 'message is too old to revoke' });
  });

  it('checks numbers live and keeps only well-formed ones as arguments', async () => {
    wacliOk([
      { query: '+254712345678', phone: '254712345678', jid: '1@lid', registered: true, responded: true },
      { query: '+254700000000', phone: '254700000000', registered: false, responded: true },
    ]);
    const { checkNumbers } = await import('../lib/wacli');

    const result = await checkNumbers(ACCOUNT, ['+254 712 345 678', '+254700000000', 'not-a-number']);
    expect(runWacli.mock.calls[0]![0]).toEqual([
      '--json',
      '--account',
      ACCOUNT,
      '--timeout',
      '20s',
      'contacts',
      'check',
      '+254712345678',
      '+254700000000',
    ]);
    expect(result).toEqual({
      ok: true,
      results: [
        { query: '+254712345678', phone: '254712345678', jid: '1@lid', registered: true, responded: true },
        { query: '+254700000000', phone: '254700000000', jid: null, registered: false, responded: true },
      ],
    });
  });

  it('strips the device suffix from the linked JID', async () => {
    wacliOk({ authenticated: true, linked_jid: '254796004050:12@s.whatsapp.net', connected: true, store: {} });
    const { linkedJid } = await import('../lib/wacli');
    expect(await linkedJid(ACCOUNT)).toBe('254796004050@s.whatsapp.net');
  });
});

describe('wacli records → mirror', () => {
  it('turns a webhook reaction into a reaction event and not a message', async () => {
    const { wacliToIngest, wacliToReaction } = await import('../lib/messaging-ingest');
    const raw = {
      Chat: GROUP,
      ID: 'REACT1',
      SenderJID: '254728734429@s.whatsapp.net',
      PushName: 'Millie',
      Timestamp: '2026-11-04T15:55:44Z',
      FromMe: false,
      Text: '',
      ReactionToID: '3EB0CF47',
      ReactionEmoji: '👍',
    };
    expect(wacliToIngest(raw)).toBeNull();
    expect(wacliToReaction(raw)).toEqual({
      chatId: GROUP,
      targetId: '3EB0CF47',
      senderJid: '254728734429@s.whatsapp.net',
      senderName: 'Millie',
      emoji: '👍',
      fromMe: false,
      at: new Date('2026-11-04T15:55:44Z'),
    });
  });

  it('a removed reaction carries an empty emoji; ordinary messages are not reactions', async () => {
    const { wacliToReaction } = await import('../lib/messaging-ingest');
    expect(wacliToReaction({ Chat: DM, ID: 'R', ReactionToID: 'T', ReactionEmoji: '', FromMe: true })?.emoji).toBe('');
    expect(wacliToReaction({ Chat: DM, ID: 'M', Text: 'hello' })).toBeNull();
    expect(wacliToReaction({ EventType: 'receipt', Chat: DM, ID: 'R', ReactionToID: 'T' } as never)).toBeNull();
  });

  it('keeps the sender id and the edited / forwarded / deleted flags on a message', async () => {
    const { wacliToIngest } = await import('../lib/messaging-ingest');
    const edited = wacliToIngest({
      Chat: GROUP,
      ID: 'M1',
      SenderJID: '254746970822@s.whatsapp.net',
      PushName: 'Netvan',
      Text: 'new price',
      Edited: true,
      IsForwarded: true,
      Timestamp: '2026-11-02T06:49:29Z',
    });
    expect(edited).toMatchObject({
      messageId: 'M1',
      senderJid: '254746970822@s.whatsapp.net',
      senderName: 'Netvan',
      text: 'new price',
      edited: true,
      forwarded: true,
      revoked: false,
    });

    const revoked = wacliToIngest({ Chat: DM, ID: 'M2', Revoked: true, FromMe: false, SenderJID: DM });
    expect(revoked).toMatchObject({ revoked: true, text: 'This message was deleted', media: null });
  });

  it('applies live edits and deletions to messages the mirror already has', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue(null);
    const { applyWacliMessageUpdates } = await import('../lib/messaging-ingest');

    await applyWacliMessageUpdates(
      { id: 3, userId: 1 },
      [
        { Chat: DM, ID: 'OLD', Text: 'corrected', Edited: true },
        { Chat: DM, ID: 'GONE', Revoked: true },
        { Chat: DM, ID: 'NEW', Text: 'fresh', Edited: true },
        { Chat: DM, ID: 'R', ReactionToID: 'OLD', ReactionEmoji: '❤️' },
      ],
      new Set(['NEW']),
    );

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[0]![0]).toMatchObject({
      where: { accountId: 3, chatId: DM, messageId: 'OLD', revoked: false },
      data: { text: 'corrected', edited: true },
    });
    expect(updateMany.mock.calls[1]![0]).toMatchObject({
      where: { accountId: 3, chatId: DM, messageId: 'GONE', revoked: false },
      data: { revoked: true, text: 'This message was deleted', mediaKind: null, reactions: [] },
    });
    expect(publish).toHaveBeenCalledTimes(2);
  });
});

describe('applyReactions', () => {
  const existing = [
    { senderJid: 'a@s.whatsapp.net', senderName: 'Ada', emoji: '👍', fromMe: false, at: '2026-11-01T00:00:00.000Z' },
    { senderJid: null, senderName: 'You', emoji: '❤️', fromMe: true, at: '2026-11-01T00:00:00.000Z' },
  ];

  it("replaces a person's earlier reaction and removes it on an empty emoji", async () => {
    findUnique.mockResolvedValue({ reactions: existing });
    update.mockResolvedValue({});
    const { applyReactions } = await import('../lib/messaging-repo');

    const at = new Date('2026-11-02T00:00:00Z');
    const changed = await applyReactions(3, 1, [
      { chatId: DM, targetId: 'M1', senderJid: 'a@s.whatsapp.net', senderName: 'Ada', emoji: '😂', fromMe: false, at },
      { chatId: DM, targetId: 'M1', senderJid: null, senderName: 'You', emoji: '', fromMe: true, at },
    ]);

    expect(changed).toBe(2);
    expect(update.mock.calls[0]![0].data.reactions).toEqual([
      existing[1],
      { senderJid: 'a@s.whatsapp.net', senderName: 'Ada', emoji: '😂', fromMe: false, at: at.toISOString() },
    ]);
    expect(update.mock.calls[1]![0].data.reactions).toEqual([existing[0]]);
    expect(publish).toHaveBeenCalledWith(1, 'messaging', expect.objectContaining({ accountId: 3, chatIds: [DM], live: false }));
  });

  it('drops reactions to messages the mirror does not hold, and the same reaction twice', async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ reactions: existing });
    const { applyReactions } = await import('../lib/messaging-repo');
    const at = new Date();

    const changed = await applyReactions(3, 1, [
      { chatId: DM, targetId: 'MISSING', senderJid: 'b@s.whatsapp.net', senderName: 'Bo', emoji: '👍', fromMe: false, at },
      { chatId: DM, targetId: 'M1', senderJid: 'a@s.whatsapp.net', senderName: 'Ada', emoji: '👍', fromMe: false, at },
    ]);

    expect(changed).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('reads back malformed reaction JSON as an empty list', async () => {
    const { parseReactions } = await import('../lib/messaging-repo');
    expect(parseReactions(null)).toEqual([]);
    expect(parseReactions('nope')).toEqual([]);
    expect(parseReactions([{ emoji: '' }, { senderName: 'x', emoji: '👍' }, 7])).toEqual([
      { senderJid: null, senderName: 'x', emoji: '👍', fromMe: false, at: new Date(0).toISOString() },
    ]);
  });
});
