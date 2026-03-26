import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifySessionToken } = vi.hoisted(() => ({
  verifySessionToken: vi.fn(),
}));

vi.mock('../lib/session-token', () => ({
  SESSION_COOKIE_NAME: 'auth_token',
  verifySessionToken,
}));

import proxy from '../proxy';

describe('proxy auth gating', () => {
  beforeEach(() => {
    verifySessionToken.mockReset();
  });

  it('redirects unauthenticated users away from protected routes', () => {
    const request = new NextRequest('http://localhost/dashboard');
    const response = proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/auth/login');
  });

  it('redirects authenticated users away from auth pages', () => {
    verifySessionToken.mockReturnValue({
      sub: '1',
      sid: 'session_123',
      ver: 1,
      email: 'admin@example.com',
    });

    const request = new NextRequest('http://localhost/auth/login', {
      headers: {
        cookie: 'auth_token=token',
      },
    });
    const response = proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
  });

  it('allows authenticated users through protected routes', () => {
    verifySessionToken.mockReturnValue({
      sub: '1',
      sid: 'session_123',
      ver: 1,
      email: 'admin@example.com',
    });

    const request = new NextRequest('http://localhost/admin', {
      headers: {
        cookie: 'auth_token=token',
      },
    });
    const response = proxy(request);

    expect(response.status).toBe(200);
  });
});
