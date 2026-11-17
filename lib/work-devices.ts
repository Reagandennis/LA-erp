import 'server-only';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { NextRequest, NextResponse } from 'next/server';

import { getRequestAuth } from './auth';
import {
  DEVICE_GATE_COOKIE_NAME,
  getDeviceGateCookieOptions,
  signDeviceGateToken,
  verifyDeviceGateToken,
  type SignInMethod,
} from './device-gate';
import { prisma } from './prisma';

/**
 * Approved work devices.
 *
 * A device is a passkey (WebAuthn credential) created by the computer's own
 * hardware: Touch ID's Secure Enclave, Windows Hello's TPM, a phone's secure
 * chip. The private key cannot be read or copied off that machine, so proving
 * possession of it proves the sign-in is coming from that machine.
 *
 * Passkeys that sync between a person's devices (iCloud Keychain, Google
 * Password Manager) are refused, because a synced key would also unlock the
 * app on their personal phone or laptop.
 *
 * An admin approves each device before it counts, and people flagged
 * `requireApprovedDevice` can only hold a session opened from one.
 */

const RP_NAME = 'LA-ERP';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** A person registers a handful of machines at most; this only stops abuse. */
export const MAX_DEVICES_PER_USER = 10;
export const MAX_DEVICE_LABEL_LENGTH = 60;

export type DeviceStatus = 'pending' | 'approved' | 'revoked';

export type DeviceErrorCode =
  | 'not-configured'
  | 'no-devices'
  | 'too-many-devices'
  | 'challenge-expired'
  | 'verification-failed'
  | 'synced-passkey'
  | 'already-registered'
  | 'unknown-device'
  | 'pending'
  | 'revoked';

/** A device check that failed for a reason worth telling the person about. */
export class DeviceCheckError extends Error {
  constructor(
    public readonly code: DeviceErrorCode,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'DeviceCheckError';
  }
}

// --- Configuration -------------------------------------------------------------

export interface WebAuthnConfig {
  /** The site's hostname. Passkeys are scoped to it and unusable anywhere else. */
  rpID: string;
  /** The exact origin the browser must report, e.g. https://erp.example.com. */
  origin: string;
}

/**
 * Where the app is served from, which every device check is pinned to.
 *
 * Production must set WEBAUTHN_ORIGIN. The request's own Host header is not
 * trusted there: a look-alike site relaying requests could otherwise have
 * devices registered against its own name. Development falls back to the
 * address the dev server was opened on (use localhost, not 127.0.0.1:
 * browsers refuse passkeys on bare IP addresses).
 */
export function getWebAuthnConfig(request: NextRequest): WebAuthnConfig | null {
  const configured = process.env.WEBAUTHN_ORIGIN?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      return { rpID: url.hostname, origin: url.origin };
    } catch {
      return null;
    }
  }
  if (process.env.NODE_ENV === 'production') return null;
  return { rpID: request.nextUrl.hostname, origin: request.nextUrl.origin };
}

export function requireWebAuthnConfig(request: NextRequest): WebAuthnConfig {
  const config = getWebAuthnConfig(request);
  if (!config) {
    throw new DeviceCheckError(
      'not-configured',
      'Work-device sign-in is not set up on this server yet. Ask an administrator.',
      503,
    );
  }
  return config;
}

// --- Who is asking ---------------------------------------------------------------

export interface DeviceUser {
  id: number;
  email: string;
  name: string;
  sessionVersion: number;
}

export type DevicePrincipal =
  | { via: 'login'; user: DeviceUser; method: SignInMethod }
  | { via: 'session'; user: DeviceUser };

/**
 * The person a device request is for.
 *
 * `login`: someone part-way through signing in, holding the device-gate cookie
 * their password earned. `session`: someone already signed in, registering the
 * machine they are on. The caller says which it means, so a leftover gate
 * cookie from another account can never be picked up by accident.
 */
export async function resolveDevicePrincipal(
  request: NextRequest,
  context: 'login' | 'session',
): Promise<DevicePrincipal | null> {
  if (context === 'session') {
    const auth = await getRequestAuth(request);
    if (!auth) return null;
    const { id, email, name, sessionVersion } = auth.user;
    return { via: 'session', user: { id, email, name, sessionVersion } };
  }

  const token = request.cookies.get(DEVICE_GATE_COOKIE_NAME)?.value;
  const gate = token ? verifyDeviceGateToken(token) : null;
  if (!gate) return null;

  const user = await prisma.user.findUnique({
    where: { id: Number(gate.sub) },
    select: { id: true, email: true, name: true, status: true, sessionVersion: true },
  });
  // A password reset or access change since the password step voids the gate.
  if (!user || user.status !== 'active' || user.sessionVersion !== gate.ver) return null;
  return {
    via: 'login',
    method: gate.method,
    user: { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion },
  };
}

/**
 * The answer to a correct password from someone who must use an approved
 * device: no session yet, just the gate cookie and word that the device check
 * comes next. `hasDevices` tells the sign-in screen whether to lead with
 * "confirm this device" or "register this device".
 */
export async function deviceGateResponse(
  user: { id: number; sessionVersion: number },
  method: SignInMethod,
): Promise<NextResponse> {
  const hasDevices = (await countUsableDevices(user.id)) > 0;
  const response = NextResponse.json({ deviceCheck: { hasDevices } });
  response.cookies.set(
    getDeviceGateCookieOptions(
      signDeviceGateToken({ userId: user.id, sessionVersion: user.sessionVersion, method }),
    ),
  );
  return response;
}

/**
 * The client address as our proxy saw it. Caddy appends the real address to
 * the END of X-Forwarded-For, so the last hop is the one a client can't forge.
 */
export function getClientIp(request: NextRequest): string | null {
  const hops = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return hops.length ? hops[hops.length - 1] : null;
}

/** Turns a failed device check into the JSON the sign-in screen expects. */
export function deviceErrorResponse(error: DeviceCheckError): NextResponse {
  return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
}

// --- Challenges ------------------------------------------------------------------

type ChallengePurpose = 'register' | 'verify';

/** One live challenge per person and purpose; asking again replaces the last. */
async function issueChallenge(userId: number, purpose: ChallengePurpose, challenge: string) {
  await prisma.deviceChallenge.deleteMany({
    where: { OR: [{ userId, purpose }, { expiresAt: { lt: new Date() } }] },
  });
  await prisma.deviceChallenge.create({
    data: { userId, purpose, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
}

/** Hands back the challenge and destroys it, so a captured response can't be replayed. */
async function consumeChallenge(userId: number, purpose: ChallengePurpose): Promise<string> {
  const row = await prisma.deviceChallenge.findFirst({
    where: { userId, purpose, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  const expired = new DeviceCheckError('challenge-expired', 'That took too long. Please try again.');
  if (!row) throw expired;
  const { count } = await prisma.deviceChallenge.deleteMany({ where: { id: row.id } });
  if (count !== 1) throw expired;
  return row.challenge;
}

// --- Registering a device ----------------------------------------------------------

function cleanLabel(label: string | null | undefined): string {
  const trimmed = (label ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DEVICE_LABEL_LENGTH);
  return trimmed || 'Work device';
}

export async function beginDeviceRegistration(config: WebAuthnConfig, user: DeviceUser) {
  const existing = await prisma.device.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true, status: true },
  });
  if (existing.filter((d) => d.status !== 'revoked').length >= MAX_DEVICES_PER_USER) {
    throw new DeviceCheckError(
      'too-many-devices',
      'You have reached the limit of registered devices. Ask an administrator to remove one.',
    );
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: config.rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(`la-erp-user-${user.id}`),
    attestationType: 'none',
    // Stops the same machine being registered twice.
    excludeCredentials: existing.map((d) => ({ id: d.credentialId, transports: d.transports })),
    authenticatorSelection: {
      // The machine's built-in authenticator, not a phone over Bluetooth or a USB key.
      authenticatorAttachment: 'platform',
      // Not asking for a "discoverable" passkey steers browsers that have the
      // choice (Chrome, Windows Hello, Android) to a key that stays on the device.
      residentKey: 'discouraged',
      userVerification: 'required',
    },
    preferredAuthenticatorType: 'localDevice',
  });

  await issueChallenge(user.id, 'register', options.challenge);
  return options;
}

export async function finishDeviceRegistration(
  config: WebAuthnConfig,
  user: DeviceUser,
  input: {
    response: RegistrationResponseJSON;
    label?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
) {
  const expectedChallenge = await consumeChallenge(user.id, 'register');

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
  } catch {
    verification = null;
  }
  if (!verification?.verified) {
    throw new DeviceCheckError('verification-failed', 'This device could not be verified. Please try again.');
  }

  const info = verification.registrationInfo;
  // The authenticator states whether the key is allowed to leave the device
  // ("backup eligible"). A key that can sync is not proof of this machine.
  if (info.credentialDeviceType !== 'singleDevice') {
    throw new DeviceCheckError(
      'synced-passkey',
      'That passkey syncs to your other devices (iCloud Keychain or Google Password Manager), so it cannot identify this computer. Try again and, when asked where to save it, choose this device only. Safari on a Mac always syncs, so use Chrome there; on Windows, use Windows Hello.',
    );
  }

  const clash = await prisma.device.findUnique({
    where: { credentialId: info.credential.id },
    select: { id: true },
  });
  if (clash) {
    throw new DeviceCheckError('already-registered', 'This device is already registered.', 409);
  }

  return prisma.device.create({
    data: {
      userId: user.id,
      label: cleanLabel(input.label),
      credentialId: info.credential.id,
      publicKey: info.credential.publicKey,
      counter: BigInt(info.credential.counter),
      transports: info.credential.transports ?? [],
      aaguid: info.aaguid,
      status: 'pending',
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
    select: { id: true, label: true, status: true, userId: true },
  });
}

// --- Checking a device at sign-in ----------------------------------------------------

/** How many of this person's devices could still be used or approved. */
export function countUsableDevices(userId: number) {
  return prisma.device.count({ where: { userId, status: { not: 'revoked' } } });
}

export function countApprovedDevices(userId: number) {
  return prisma.device.count({ where: { userId, status: 'approved' } });
}

export async function beginDeviceVerification(config: WebAuthnConfig, userId: number) {
  // Pending devices are offered too, so the person on one hears "waiting for
  // approval" rather than a browser error about a missing passkey.
  const devices = await prisma.device.findMany({
    where: { userId, status: { not: 'revoked' } },
    select: { credentialId: true, transports: true },
  });
  if (devices.length === 0) {
    throw new DeviceCheckError('no-devices', 'You have no registered work device yet. Register this one first.', 409);
  }

  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: devices.map((d) => ({ id: d.credentialId, transports: d.transports })),
    userVerification: 'required',
  });

  await issueChallenge(userId, 'verify', options.challenge);
  return options;
}

/**
 * Confirms the response was signed by one of this person's devices, then
 * requires that device to be approved. Returns the device a session may be
 * opened from.
 */
export async function finishDeviceVerification(
  config: WebAuthnConfig,
  userId: number,
  response: AuthenticationResponseJSON,
) {
  const expectedChallenge = await consumeChallenge(userId, 'verify');

  const device = await prisma.device.findUnique({ where: { credentialId: response.id } });
  if (!device || device.userId !== userId) {
    throw new DeviceCheckError('unknown-device', 'This device is not registered to your account.', 403);
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
      credential: {
        id: device.credentialId,
        publicKey: new Uint8Array(device.publicKey),
        counter: Number(device.counter),
        transports: device.transports,
      },
    });
  } catch {
    verification = null;
  }
  if (!verification?.verified) {
    throw new DeviceCheckError('verification-failed', 'This device could not be verified. Please try again.', 403);
  }
  if (verification.authenticationInfo.credentialDeviceType !== 'singleDevice') {
    throw new DeviceCheckError('synced-passkey', 'This passkey is no longer tied to one device. Register this computer again.', 403);
  }

  if (device.status === 'pending') {
    throw new DeviceCheckError('pending', 'This device is waiting for an administrator to approve it.', 403);
  }
  if (device.status !== 'approved') {
    throw new DeviceCheckError('revoked', 'This device is no longer approved. Ask an administrator.', 403);
  }

  await prisma.device.update({
    where: { id: device.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });

  return { id: device.id, label: device.label };
}

// --- Admin console -------------------------------------------------------------------

export interface AdminDevice {
  id: string;
  user: { id: number; name: string; email: string };
  label: string;
  status: DeviceStatus;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  approvedAt: string | null;
  lastUsedAt: string | null;
  /** The device behind the session making this request. */
  current: boolean;
}

const STATUS_ORDER: Record<string, number> = { pending: 0, approved: 1, revoked: 2 };

/** Every registered device, those waiting for approval first. */
export async function listDevices(currentDeviceId?: string | null): Promise<AdminDevice[]> {
  const rows = await prisma.device.findMany({
    orderBy: { createdAt: 'desc' },
    take: 1000,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return rows
    .map((row) => ({
      id: row.id,
      user: row.user,
      label: row.label,
      status: row.status as DeviceStatus,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      current: Boolean(currentDeviceId) && row.id === currentDeviceId,
    }))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3));
}

export function getDevice(deviceId: string) {
  return prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, userId: true, label: true, status: true },
  });
}

export async function approveDevice(deviceId: string, adminUserId: number) {
  await prisma.device.update({
    where: { id: deviceId },
    data: { status: 'approved', approvedAt: new Date(), approvedById: adminUserId, revokedAt: null },
  });
}

/** Withdraws approval and ends every session opened from the device. */
export async function revokeDevice(deviceId: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.session.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.device.update({ where: { id: deviceId }, data: { status: 'revoked', revokedAt: now } }),
  ]);
}

/** Forgets the device entirely; its sessions end and it must be registered afresh. */
export async function deleteDevice(deviceId: string) {
  await prisma.$transaction([
    prisma.session.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.device.delete({ where: { id: deviceId } }),
  ]);
}

/**
 * Turns the approved-device rule on or off, for the given people or (with no
 * ids) for everyone except `exceptUserId`. Returns how many people changed.
 *
 * Nothing is signed out here: sessions that did not come through a device
 * check simply stop being accepted the next time they are used.
 */
export async function setDeviceRequirement(input: {
  required: boolean;
  userIds?: number[];
  exceptUserId?: number;
}): Promise<number> {
  const { count } = await prisma.user.updateMany({
    where: {
      requireApprovedDevice: !input.required,
      ...(input.userIds ? { id: { in: input.userIds } } : {}),
      ...(input.exceptUserId ? { NOT: { id: input.exceptUserId } } : {}),
    },
    data: { requireApprovedDevice: input.required },
  });
  return count;
}
