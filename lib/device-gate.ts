import 'server-only';

import jwt from 'jsonwebtoken';

import { getJwtSecret } from './env';

/**
 * The step between "password accepted" and "signed in" for people who must use
 * an approved work device.
 *
 * Their password (or Google identity) earns this short-lived cookie instead of
 * a session. It only lets them run the device check; it opens nothing else.
 * It is signed with a key derived from the session secret, so it can never be
 * mistaken for a session token, and it is only sent to the device-check routes.
 */
export const DEVICE_GATE_COOKIE_NAME = 'device_gate';
const DEVICE_GATE_SECONDS = 10 * 60;
const DEVICE_GATE_PATH = '/api/auth/device';

export type SignInMethod = 'password' | 'google';

export type DeviceGatePayload = {
  sub: string;
  ver: number;
  method: SignInMethod;
};

function gateSecret() {
  return `${getJwtSecret()}:device-gate`;
}

export function signDeviceGateToken(input: {
  userId: number;
  sessionVersion: number;
  method: SignInMethod;
}) {
  return jwt.sign(
    { sub: String(input.userId), ver: input.sessionVersion, method: input.method },
    gateSecret(),
    { expiresIn: DEVICE_GATE_SECONDS, algorithm: 'HS256' },
  );
}

export function verifyDeviceGateToken(token: string): DeviceGatePayload | null {
  try {
    const payload = jwt.verify(token, gateSecret(), { algorithms: ['HS256'] }) as DeviceGatePayload;
    return payload.sub && Number.isInteger(payload.ver) ? payload : null;
  } catch {
    return null;
  }
}

export function getDeviceGateCookieOptions(value: string) {
  return {
    name: DEVICE_GATE_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: DEVICE_GATE_SECONDS,
    path: DEVICE_GATE_PATH,
  };
}

export function getClearedDeviceGateCookieOptions() {
  return { ...getDeviceGateCookieOptions(''), maxAge: 0 };
}
