import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  enforceRateLimit,
  getUserByEmail,
  hashPassword,
  recordAuditEvent,
  resetManagedUserPassword,
  verifyPassword,
} = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  getUserByEmail: vi.fn(),
  hashPassword: vi.fn(),
  recordAuditEvent: vi.fn(),
  resetManagedUserPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
  hashPassword,
  verifyPassword,
}));

vi.mock('../lib/audit', () => ({
  recordAuditEvent,
}));

vi.mock('../lib/rate-limit', () => ({
  enforceRateLimit,
}));

vi.mock('../lib/user', () => ({
  getUserByEmail,
  resetManagedUserPassword,
}));

import { POST } from '../app/api/auth/change-password/route';

const activeUser = {
  id: 7,
  email: 'pilot@example.com',
  passwordHash: 'old-hash',
  status: 'active',
};

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const validBody = {
  email: 'Pilot@Example.com',
  currentPassword: 'oldpass1',
  newPassword: 'newpass22',
};

describe('change password route', () => {
  beforeEach(() => {
    enforceRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 4, retryAfterSeconds: 900 });
    getUserByEmail.mockReset().mockResolvedValue(activeUser);
    hashPassword.mockReset().mockResolvedValue('new-hash');
    recordAuditEvent.mockReset();
    resetManagedUserPassword.mockReset();
    verifyPassword.mockReset().mockResolvedValue(true);
  });

  it('changes the password and signs the account out everywhere', async () => {
    const response = await post(validBody);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(getUserByEmail).toHaveBeenCalledWith('pilot@example.com');
    expect(verifyPassword).toHaveBeenCalledWith('oldpass1', 'old-hash');
    expect(hashPassword).toHaveBeenCalledWith('newpass22');
    // No keepSessionId: every session is revoked.
    expect(resetManagedUserPassword).toHaveBeenCalledWith({ userId: 7, passwordHash: 'new-hash' });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password.changed', targetUserId: 7 }),
    );
  });

  it('rejects a wrong current password without changing anything', async () => {
    verifyPassword.mockResolvedValue(false);

    const response = await post(validBody);

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Invalid email or current password');
    expect(resetManagedUserPassword).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.password.change.failed',
        metadata: expect.objectContaining({ reason: 'bad-password' }),
      }),
    );
  });

  it('answers an unknown email exactly like a wrong password', async () => {
    getUserByEmail.mockResolvedValue(null);

    const response = await post(validBody);

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Invalid email or current password');
    expect(resetManagedUserPassword).not.toHaveBeenCalled();
  });

  it('refuses a restricted account even with the right password', async () => {
    getUserByEmail.mockResolvedValue({ ...activeUser, status: 'suspended' });

    const response = await post(validBody);

    expect(response.status).toBe(403);
    expect(resetManagedUserPassword).not.toHaveBeenCalled();
  });

  it('rejects a weak new password before touching the database', async () => {
    const response = await post({ ...validBody, newPassword: 'short' });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('at least 8 characters');
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it('rejects a new password equal to the current one', async () => {
    const response = await post({ ...validBody, newPassword: validBody.currentPassword });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('different');
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it('stops checking passwords once the rate limit is hit', async () => {
    enforceRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 120 });

    const response = await post(validBody);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('returns service unavailable when PostgreSQL cannot be reached', async () => {
    enforceRateLimit.mockRejectedValue({
      name: 'PrismaClientInitializationError',
      message: "Can't reach database server at `localhost:5433`",
    });

    const response = await post(validBody);

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('temporarily unavailable');
  });
});
