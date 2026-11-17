import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cookies,
  sessionFindUnique,
  verifySessionToken,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  sessionFindUnique: vi.fn(),
  verifySessionToken: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies,
}));

vi.mock('server-only', () => ({}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    session: {
      findUnique: sessionFindUnique,
    },
  },
}));

vi.mock('../lib/session-token', () => ({
  SESSION_COOKIE_NAME: 'auth_token',
  getSessionCookieValue: (request: NextRequest) =>
    request.cookies.get('auth_token')?.value ?? null,
  getSessionDurationSeconds: vi.fn(),
  signSessionToken: vi.fn(),
  verifySessionToken,
}));

vi.mock('../lib/user', () => ({
  buildAccessUser: vi.fn(),
  userAccessInclude: {},
}));

import { getRequestAuth } from '../lib/auth';

describe('auth session resolution', () => {
  beforeEach(() => {
    cookies.mockReset();
    sessionFindUnique.mockReset();
    verifySessionToken.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats database connectivity errors as unauthenticated requests', async () => {
    verifySessionToken.mockReturnValue({
      sid: 'session_123',
      sub: '1',
      ver: 1,
      email: 'admin@example.com',
    });
    sessionFindUnique.mockRejectedValue({
      name: 'PrismaClientInitializationError',
      message: "Can't reach database server at `localhost:5433`",
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const auth = await getRequestAuth(
      new NextRequest('http://localhost/dashboard', {
        headers: {
          cookie: 'auth_token=token',
        },
      }),
    );

    expect(auth).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  describe('people limited to approved work devices', () => {
    const resolveWith = (session: { deviceId: string | null; device: { status: string } | null }, requireApprovedDevice = true) => {
      verifySessionToken.mockReturnValue({ sid: 'session_123', sub: '1', ver: 1, email: 'pat@example.com' });
      sessionFindUnique.mockResolvedValue({
        id: 'session_123',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        lastSeenAt: new Date(),
        ...session,
        user: { id: 1, status: 'active', sessionVersion: 1, requireApprovedDevice, worldClockZones: [] },
      });
      return getRequestAuth(
        new NextRequest('http://localhost/api/trips', { headers: { cookie: 'auth_token=token' } }),
      );
    };

    it('rejects a session that did not come through a device check', async () => {
      expect(await resolveWith({ deviceId: null, device: null })).toBeNull();
    });

    it('rejects a session whose device is pending or has been revoked', async () => {
      expect(await resolveWith({ deviceId: 'dev_1', device: { status: 'pending' } })).toBeNull();
      expect(await resolveWith({ deviceId: 'dev_1', device: { status: 'revoked' } })).toBeNull();
    });

    it('accepts a session opened from an approved device', async () => {
      const auth = await resolveWith({ deviceId: 'dev_1', device: { status: 'approved' } });
      expect(auth).toMatchObject({ sessionId: 'session_123', deviceId: 'dev_1' });
    });

    it('leaves everyone else alone', async () => {
      const auth = await resolveWith({ deviceId: null, device: null }, false);
      expect(auth).toMatchObject({ sessionId: 'session_123', deviceId: null });
    });
  });
});
