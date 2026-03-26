import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

import { getJwtSecret } from './env';

export const SESSION_COOKIE_NAME = 'auth_token';
const SESSION_DURATION_SECONDS = 60 * 60 * 24;

export type SessionTokenPayload = {
  sub: string;
  sid: string;
  ver: number;
  email: string;
};

export function signSessionToken(input: {
  userId: number;
  sessionId: string;
  email: string;
  sessionVersion: number;
}) {
  return jwt.sign(
    {
      sub: String(input.userId),
      sid: input.sessionId,
      ver: input.sessionVersion,
      email: input.email,
    },
    getJwtSecret(),
    { expiresIn: SESSION_DURATION_SECONDS },
  );
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionTokenPayload;
  } catch {
    return null;
  }
}

export function getSessionCookieValue(request: NextRequest) {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export function getSessionCookieOptions(value: string) {
  return {
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_DURATION_SECONDS,
    path: '/',
  };
}

export function getClearedSessionCookieOptions() {
  return {
    ...getSessionCookieOptions(''),
    maxAge: 0,
  };
}

export function getSessionDurationSeconds() {
  return SESSION_DURATION_SECONDS;
}
