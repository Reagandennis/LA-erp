import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createSession,
  enforceRateLimit,
  getSessionCookieOptions,
  getUserByEmail,
  recordAuditEvent,
  verifyPassword,
} = vi.hoisted(() => ({
  createSession: vi.fn(),
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

import { POST } from '../app/api/auth/login/route';

describe('login route', () => {
  beforeEach(() => {
    createSession.mockReset();
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
});
