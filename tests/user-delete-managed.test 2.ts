import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transaction,
  userFindUnique,
  userDelete,
  chatConversationUpdateMany,
} = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFindUnique: vi.fn(),
  userDelete: vi.fn(),
  chatConversationUpdateMany: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('../lib/rbac', () => ({
  ADMIN_ROLE_NAME: 'admin',
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: transaction,
  },
}));

import { deleteManagedUser } from '../lib/user';

describe('deleteManagedUser', () => {
  beforeEach(() => {
    transaction.mockReset();
    userFindUnique.mockReset();
    userDelete.mockReset();
    chatConversationUpdateMany.mockReset();
  });

  it('clears chat conversation creators before deleting the user', async () => {
    transaction.mockImplementation(async (callback) =>
      callback({
        user: {
          findUnique: userFindUnique,
          delete: userDelete,
        },
        chatConversation: {
          updateMany: chatConversationUpdateMany,
        },
      }),
    );
    userFindUnique.mockResolvedValue({ id: 7 });
    chatConversationUpdateMany.mockResolvedValue({ count: 2 });
    userDelete.mockResolvedValue({ id: 7 });

    await expect(deleteManagedUser(7)).resolves.toBe(true);

    expect(chatConversationUpdateMany).toHaveBeenCalledWith({
      where: { createdById: 7 },
      data: { createdById: null },
    });
    expect(userDelete).toHaveBeenCalledWith({
      where: { id: 7 },
    });
  });

  it('returns false without deleting anything when the user does not exist', async () => {
    transaction.mockImplementation(async (callback) =>
      callback({
        user: {
          findUnique: userFindUnique,
          delete: userDelete,
        },
        chatConversation: {
          updateMany: chatConversationUpdateMany,
        },
      }),
    );
    userFindUnique.mockResolvedValue(null);

    await expect(deleteManagedUser(99)).resolves.toBe(false);

    expect(chatConversationUpdateMany).not.toHaveBeenCalled();
    expect(userDelete).not.toHaveBeenCalled();
  });
});
