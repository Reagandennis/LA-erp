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
  // simplewebauthn wraps the browser's DOMException; the original is in `cause`.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  reportBrowserError(registering ? 'register' : 'verify', error, cause);
  const detail = ` (${cause?.name || name || 'Error'}: ${(cause?.message || (error instanceof Error ? error.message : String(error))).slice(0, 160)})`;
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
    return new DeviceCheckFailure(
      registering
        ? `This computer refused to create a device key. On Windows, set up Windows Hello (a PIN or fingerprint) in Settings → Accounts → Sign-in options, then try again. On a Mac, use Chrome and choose to save the passkey in the Chrome profile on this Mac.${detail}`
        : `This computer refused the device check.${detail}`,
      'unsupported',
    );
  }
  return new DeviceCheckFailure(`The device check failed. Please try again.${detail}`);
}

/** Sends the browser's own error to the server log so an administrator can see it. */
function reportBrowserError(step: string, error: unknown, cause: Error | null): void {
  if (typeof window === 'undefined') return;
  const e = error instanceof Error ? error : null;
  const facts: Record<string, string | boolean | null> = {
    step,
    errorName: e?.name ?? null,
    errorCode: (e as { code?: string } | null)?.code ?? null,
    errorMessage: (e?.message ?? String(error)).slice(0, 300),
    causeName: cause?.name ?? null,
    causeMessage: cause?.message?.slice(0, 300) ?? null,
    origin: window.location.origin,
    userAgent: navigator.userAgent.slice(0, 300),
  };
  void fetch('/api/auth/device/diagnostic', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: 'login', facts }),
  }).catch(() => undefined);
}

export function deviceCheckSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

/** Tell the server what this browser lacks, for the administrator's log. */
export function reportDeviceCheckProblem(context: 'login' | 'session'): void {
  if (typeof window === 'undefined') return;
  const facts: Record<string, string | boolean | null> = {
    origin: window.location.origin,
    isSecureContext: window.isSecureContext,
    publicKeyCredential: typeof window.PublicKeyCredential,
    credentials: typeof navigator.credentials,
    inFrame: window.self !== window.top,
    userAgent: navigator.userAgent.slice(0, 300),
  };
  void fetch('/api/auth/device/diagnostic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, facts }),
  }).catch(() => undefined);
}

/**
 * Why the device check cannot run here, in words the person can act on.
 * Browsers hide passkeys on pages they do not consider secure (plain http,
 * a bare IP address, or a certificate warning that was clicked through), which
 * is far more common than a browser that genuinely lacks support.
 */
export function deviceCheckProblem(): string {
  if (typeof window === 'undefined') return '';
  const here = `${window.location.origin}, ${suggestDeviceLabel()}`;
  if (!window.isSecureContext || window.location.protocol !== 'https:') {
    return `The browser does not treat this address (${here}) as secure, so it blocks the device check. Open the site at its normal https:// address with no certificate warning.`;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(window.location.hostname)) {
    return `Device checks do not work on an IP address (${here}). Open the site by its name instead.`;
  }
  return `This browser has the device check switched off (${here}). Use an up-to-date Chrome, Edge or Safari outside private or in-app browsing, and check that a company policy is not blocking passkeys.`;
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
