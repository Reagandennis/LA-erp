import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction, userFindUnique, userDelete } = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFindUnique: vi.fn(),
  userDelete: vi.fn(),
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

/**
 * Note: this used to assert that deleteManagedUser nulled ChatConversation
 * creators itself. Migration 20260511120000_set_null_chat_conversation_creator
 * moved that guarantee into the schema (`ON DELETE SET NULL`), so the function
 * now just deletes and lets the database preserve shared conversations. The
 * old app-level assertion is gone rather than re-added — it would test code
 * that no longer exists.
 */
describe('deleteManagedUser', () => {
  const txClient = () => ({
    user: {
      findUnique: userFindUnique,
      delete: userDelete,
    },
  });

  beforeEach(() => {
    transaction.mockReset();
    userFindUnique.mockReset();
    userDelete.mockReset();
    transaction.mockImplementation(async (callback) => callback(txClient()));
  });

  it('deletes the user inside a transaction', async () => {
    userFindUnique.mockResolvedValue({ id: 7 });
    userDelete.mockResolvedValue({ id: 7 });

    await expect(deleteManagedUser(7)).resolves.toBe(true);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(userDelete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it('looks the user up before deleting', async () => {
    userFindUnique.mockResolvedValue({ id: 7 });
    userDelete.mockResolvedValue({ id: 7 });

    await deleteManagedUser(7);

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { id: true },
    });
  });

  it('returns false without deleting anything when the user does not exist', async () => {
    userFindUnique.mockResolvedValue(null);

    await expect(deleteManagedUser(99)).resolves.toBe(false);

    expect(userDelete).not.toHaveBeenCalled();
  });
});
