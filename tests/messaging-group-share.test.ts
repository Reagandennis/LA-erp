import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  messagingAccount: { findFirst: vi.fn(), findMany: vi.fn() },
  userGroup: { findFirst: vi.fn() },
  messagingAccountGroupShare: { createMany: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: db }));

import { getUsableAccount, setAccountGroupShare } from '../lib/messaging-accounts';

const row = (id: number, userId: number, provider = 'whatsapp') => ({ id, userId, provider, handle: `h${id}`, label: null, session: null });
const inGroupWith = (userId: number) => ({ some: { group: { members: { some: { userId } } } } });

beforeEach(() => {
  for (const table of Object.values(db)) for (const fn of Object.values(table)) fn.mockReset();
});

describe('WhatsApp numbers shared with a group', () => {
  it('prefers the caller’s own account', async () => {
    db.messagingAccount.findFirst.mockResolvedValueOnce(row(3, 7));
    expect(await getUsableAccount(7, 'whatsapp', 3)).toMatchObject({ id: 3, shared: false });
    expect(db.messagingAccount.findFirst).toHaveBeenCalledTimes(1);
  });

  it('otherwise looks only among numbers shared with one of the caller’s groups', async () => {
    db.messagingAccount.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...row(9, 2), user: { name: 'Mary' } });
    expect(await getUsableAccount(7, 'whatsapp', 9)).toMatchObject({ id: 9, userId: 2, shared: true, ownerName: 'Mary' });
    expect(db.messagingAccount.findFirst.mock.calls[1]![0].where).toEqual({
      provider: 'whatsapp',
      userId: { not: 7 },
      groupShares: inGroupWith(7),
      id: 9,
    });
  });

  it('never shares Telegram or Signal', async () => {
    db.messagingAccount.findFirst.mockResolvedValue(null);
    expect(await getUsableAccount(7, 'telegram', 9)).toBeNull();
    expect(db.messagingAccount.findFirst).toHaveBeenCalledTimes(1);
  });

  it('lets only the owner share, and only with a group they are in', async () => {
    db.messagingAccount.findFirst.mockResolvedValueOnce(null);
    expect(await setAccountGroupShare(7, 9, 1, true)).toBe(false);
    expect(db.messagingAccount.findFirst.mock.calls[0]![0].where).toEqual({ id: 9, userId: 7, provider: 'whatsapp' });

    db.messagingAccount.findFirst.mockResolvedValueOnce({ id: 3 });
    db.userGroup.findFirst.mockResolvedValueOnce(null);
    expect(await setAccountGroupShare(7, 3, 1, true)).toBe(false);
    expect(db.messagingAccountGroupShare.createMany).not.toHaveBeenCalled();

    db.messagingAccount.findFirst.mockResolvedValueOnce({ id: 3 });
    db.userGroup.findFirst.mockResolvedValueOnce({ id: 1 });
    expect(await setAccountGroupShare(7, 3, 1, true)).toBe(true);
    expect(db.messagingAccountGroupShare.createMany).toHaveBeenCalledWith({ data: [{ accountId: 3, groupId: 1 }], skipDuplicates: true });
  });
});
