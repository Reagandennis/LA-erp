import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { findFirst, create, update } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ prisma: { messagingAccount: { findFirst, create, update } } }));

import {
  getAccount,
  isAppWacliAccountName,
  newWacliAccountName,
  phoneFromJid,
  saveAccount,
} from '@/lib/messaging-accounts';

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 7,
  provider: 'whatsapp',
  handle: 'laerp-user-7',
  label: null,
  session: null,
  ...over,
});

describe('saveAccount', () => {
  beforeEach(() => {
    findFirst.mockReset();
    create.mockReset().mockImplementation(async ({ data }) => row({ id: 2, ...data }));
    update.mockReset().mockImplementation(async ({ where, data }) => row({ id: where.id, ...data }));
  });

  it('adds a second WhatsApp account rather than replacing the first', async () => {
    findFirst.mockResolvedValue(null);
    const saved = await saveAccount({ userId: 7, provider: 'whatsapp', handle: 'laerp-user-7-0a1b2c3d', label: '+254700000002' });

    // WhatsApp matches on the handle, so a different store is a different account.
    expect(findFirst.mock.calls[0]![0].where).toEqual({ userId: 7, provider: 'whatsapp', handle: 'laerp-user-7-0a1b2c3d' });
    expect(create).toHaveBeenCalled();
    expect(saved.id).toBe(2);
  });

  it('updates the same WhatsApp account when it is paired again', async () => {
    findFirst.mockResolvedValue(row({ id: 4, handle: 'laerp-user-7-0a1b2c3d' }));
    await saveAccount({ userId: 7, provider: 'whatsapp', handle: 'laerp-user-7-0a1b2c3d', label: '+254700000002' });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4 } }));
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps Telegram to one account per user: a new number replaces the old', async () => {
    findFirst.mockResolvedValue(row({ id: 9, provider: 'telegram', handle: '+254700000001' }));
    await saveAccount({ userId: 7, provider: 'telegram', handle: '+254700000003', session: 'secret' });

    expect(findFirst.mock.calls[0]![0].where).toEqual({ userId: 7, provider: 'telegram' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9 }, data: expect.objectContaining({ handle: '+254700000003' }) }),
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe('getAccount', () => {
  beforeEach(() => findFirst.mockReset().mockResolvedValue(null));

  it('scopes a requested id to the user, so another user\'s id finds nothing', async () => {
    await getAccount(7, 'whatsapp', 12);
    expect(findFirst.mock.calls[0]![0].where).toEqual({ userId: 7, provider: 'whatsapp', id: 12 });
  });

  it('falls back to the first account linked', async () => {
    await getAccount(7, 'whatsapp');
    expect(findFirst.mock.calls[0]![0]).toEqual({ where: { userId: 7, provider: 'whatsapp' }, orderBy: { id: 'asc' } });
  });
});

describe('wacli account names', () => {
  it('gives every new link its own store name', () => {
    const a = newWacliAccountName(7);
    const b = newWacliAccountName(7);
    expect(a).toMatch(/^laerp-user-7-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(isAppWacliAccountName(a)).toBe(true);
  });

  it('recognises only names this app created, old and new', () => {
    expect(isAppWacliAccountName('laerp-user-1')).toBe(true);
    expect(isAppWacliAccountName('personal')).toBe(false);
    expect(isAppWacliAccountName('laerp-user-1/../x')).toBe(false);
    expect(isAppWacliAccountName('laerp-user-1-0A1B2C3D')).toBe(false);
  });
});

describe('phoneFromJid', () => {
  it('reads the number from a user or device JID', () => {
    expect(phoneFromJid('254796004050@s.whatsapp.net')).toBe('+254796004050');
    expect(phoneFromJid('254796004050:12@s.whatsapp.net')).toBe('+254796004050');
  });

  it('returns null for empty, missing or malformed values', () => {
    expect(phoneFromJid('')).toBeNull();
    expect(phoneFromJid('not-a-jid')).toBeNull();
    expect(phoneFromJid(null)).toBeNull();
  });
});
