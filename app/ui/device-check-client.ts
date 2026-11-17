'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

import { SILENT_BANNER_HEADER } from '@/app/ui/banner';

/**
 * Browser half of the work-device check: asks the computer's built-in
 * authenticator (Touch ID, Windows Hello) to create or use the passkey that
 * identifies this machine, and passes the result to the server.
 */

export class DeviceCheckFailure extends Error {
  constructor(
    message: string,
    /** Server reason, e.g. `pending`, `synced-passkey`, `expired`; or `cancelled`. */
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'DeviceCheckFailure';
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', [SILENT_BANNER_HEADER]: '1' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!response.ok) {
    throw new DeviceCheckFailure(payload?.error || 'The device check failed. Please try again.', payload?.code ?? null);
  }
  return (payload ?? {}) as T;
}

/** Turns what the browser throws into something worth showing a person. */
function browserFailure(error: unknown, registering: boolean): DeviceCheckFailure {
  if (error instanceof DeviceCheckFailure) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'InvalidStateError' && registering) {
    return new DeviceCheckFailure('This device is already registered. Use "Confirm this device" instead.', 'already-registered');
  }
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new DeviceCheckFailure(
      registering
        ? 'The request was cancelled or timed out. Try again.'
        : 'The check was cancelled, or this computer is not one of your registered devices.',
      'cancelled',
    );
  }
  if (name === 'NotSupportedError' || name === 'SecurityError') {
    return new DeviceCheckFailure('This browser cannot do the device check here. Use an up-to-date Chrome, Edge or Safari.', 'unsupported');
  }
  return new DeviceCheckFailure('The device check failed. Please try again.');
}

export function deviceCheckSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

/** "Chrome on macOS": a starting name for the device the person can change. */
export function suggestDeviceLabel(): string {
  if (typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows PC'
          : /Linux/.test(ua)
            ? 'Linux PC'
            : 'computer';
  return `${os} (${browser})`;
}

export type RegisteredDevice = { id: string; label: string; status: 'pending' | 'approved' | 'revoked' };

/**
 * Registers the computer this is running on. `login`: for the person part-way
 * through signing in. `session`: for the person already signed in.
 * The device still needs an administrator's approval before it can be used.
 */
export async function registerThisDevice(context: 'login' | 'session', label: string): Promise<RegisteredDevice> {
  try {
    const { options } = await post<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
      '/api/auth/device/options',
      { mode: 'register', context },
    );
    const response = await startRegistration({ optionsJSON: options });
    const { device } = await post<{ device: RegisteredDevice }>('/api/auth/device/register', { context, label, response });
    return device;
  } catch (error) {
    throw browserFailure(error, true);
  }
}

/** Proves this is an approved device and, if so, completes the sign-in. */
export async function confirmThisDevice(): Promise<void> {
  try {
    const { options } = await post<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
      '/api/auth/device/options',
      { mode: 'verify', context: 'login' },
    );
    const response = await startAuthentication({ optionsJSON: options });
    await post('/api/auth/device/verify', { response });
  } catch (error) {
    throw browserFailure(error, false);
  }
}
