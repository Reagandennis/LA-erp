import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  countAdmins,
  deleteManagedUser,
  enforceRateLimit,
  getUserAccessById,
  isUserAdmin,
  recordAuditEvent,
  requireAdminRequest,
  updateManagedUser,
  userHasRole,
} = vi.hoisted(() => ({
  countAdmins: vi.fn(),
  deleteManagedUser: vi.fn(),
  enforceRateLimit: vi.fn(),
  getUserAccessById: vi.fn(),
  isUserAdmin: vi.fn(),
  recordAuditEvent: vi.fn(),
  requireAdminRequest: vi.fn(),
  updateManagedUser: vi.fn(),
  userHasRole: vi.fn(),
}));

vi.mock('../lib/audit', () => ({
  recordAuditEvent,
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    role: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../lib/rate-limit', () => ({
  enforceRateLimit,
}));

vi.mock('../lib/rbac', () => ({
  ADMIN_ROLE_NAME: 'admin',
}));

vi.mock('../lib/request-auth', () => ({
  requireAdminRequest,
}));

vi.mock('../lib/user', () => ({
  countAdmins,
  deleteManagedUser,
  getUserAccessById,
  isUserAdmin,
  updateManagedUser,
  userHasRole,
}));

import { DELETE } from '../app/api/admin/users/[userId]/route';

describe('admin user delete route', () => {
  beforeEach(() => {
    countAdmins.mockReset();
    deleteManagedUser.mockReset();
    enforceRateLimit.mockReset();
    getUserAccessById.mockReset();
    isUserAdmin.mockReset();
    recordAuditEvent.mockReset();
    requireAdminRequest.mockReset();
    updateManagedUser.mockReset();
    userHasRole.mockReset();

    requireAdminRequest.mockResolvedValue({
      auth: { user: { id: 1 } },
      response: null,
    });
    enforceRateLimit.mockResolvedValue({ allowed: true });
    recordAuditEvent.mockResolvedValue(undefined);
  });

  it('deletes a user and records an audit event', async () => {
    getUserAccessById.mockResolvedValue({
      id: 2,
      email: 'member@example.com',
      name: 'Member User',
      status: 'active',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      sessionVersion: 1,
      roles: [],
      permissions: [],
      modules: [],
    });
    isUserAdmin.mockResolvedValue(false);
    deleteManagedUser.mockResolvedValue(true);

    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/users/2', { method: 'DELETE' }),
      { params: Promise.resolve({ userId: '2' }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true });
    expect(deleteManagedUser).toHaveBeenCalledWith(2);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.user.deleted',
        entityType: 'user',
        entityId: '2',
        actorUserId: 1,
        metadata: { email: 'member@example.com' },
      }),
    );
  });

  it('blocks deletion of the last administrator', async () => {
    getUserAccessById.mockResolvedValue({
      id: 2,
      email: 'admin@example.com',
      name: 'Admin User',
      status: 'active',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      sessionVersion: 1,
      roles: [],
      permissions: [],
      modules: [],
    });
    isUserAdmin.mockResolvedValue(true);
    countAdmins.mockResolvedValue(1);

    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/users/2', { method: 'DELETE' }),
      { params: Promise.resolve({ userId: '2' }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('last administrator');
    expect(deleteManagedUser).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
