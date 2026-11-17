import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createSession,
  deviceGateResponse,
  enforceRateLimit,
  getSessionCookieOptions,
  getUserByEmail,
  recordAuditEvent,
  verifyPassword,
} = vi.hoisted(() => ({
  createSession: vi.fn(),
  deviceGateResponse: vi.fn(),
  enforceRateLimit: vi.fn(),
  getSessionCookieOptions: vi.fn(),
  getUserByEmail: vi.fn(),
  recordAuditEvent: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
  createSession,
  verifyPassword,
}));

vi.mock('../lib/audit', () => ({
  recordAuditEvent,
}));

vi.mock('../lib/rate-limit', () => ({
  enforceRateLimit,
}));

vi.mock('../lib/session-token', () => ({
  getSessionCookieOptions,
}));

vi.mock('../lib/user', () => ({
  getUserByEmail,
}));

vi.mock('../lib/work-devices', () => ({
  deviceGateResponse,
}));

import { POST } from '../app/api/auth/login/route';

describe('login route', () => {
  beforeEach(() => {
    createSession.mockReset();
    deviceGateResponse.mockReset();
    enforceRateLimit.mockReset();
    getSessionCookieOptions.mockReset();
    getUserByEmail.mockReset();
    recordAuditEvent.mockReset();
    verifyPassword.mockReset();
  });

  it('returns service unavailable when PostgreSQL cannot be reached', async () => {
    enforceRateLimit.mockRejectedValue({
      name: 'PrismaClientInitializationError',
      message: "Can't reach database server at `localhost:5433`",
    });

    const response = await POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'secret123',
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain('temporarily unavailable');
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  const signIn = () =>
    POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'pat@example.com', password: 'secret123' }),
      }),
    );

  it('opens no session for someone limited to approved devices: the password only earns the device check', async () => {
    enforceRateLimit.mockResolvedValue({ allowed: true });
    verifyPassword.mockResolvedValue(true);
    getUserByEmail.mockResolvedValue({
      id: 7,
      email: 'pat@example.com',
      name: 'Pat',
      status: 'active',
      sessionVersion: 3,
      passwordHash: 'hash',
      requireApprovedDevice: true,
    });
    deviceGateResponse.mockResolvedValue(Response.json({ deviceCheck: { hasDevices: true } }));

    const response = await signIn();

    expect(await response.json()).toEqual({ deviceCheck: { hasDevices: true } });
    expect(deviceGateResponse).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'password');
    expect(createSession).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('signs in as before when the account has no device rule', async () => {
    enforceRateLimit.mockResolvedValue({ allowed: true });
    verifyPassword.mockResolvedValue(true);
    getUserByEmail.mockResolvedValue({
      id: 7,
      email: 'pat@example.com',
      name: 'Pat',
      status: 'active',
      sessionVersion: 3,
      passwordHash: 'hash',
      requireApprovedDevice: false,
    });
    createSession.mockResolvedValue({ session: { id: 'sess_1' }, token: 'jwt' });
    getSessionCookieOptions.mockReturnValue({ name: 'auth_token', value: 'jwt', path: '/' });

    const response = await signIn();

    expect((await response.json()).success).toBe(true);
    expect(deviceGateResponse).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toContain('auth_token=jwt');
  });
});
