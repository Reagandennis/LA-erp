import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The device check, exercised end to end against a software authenticator
 * that speaks real WebAuthn: it makes an ES256 key, and signs registrations
 * and sign-ins exactly as Touch ID or Windows Hello would. Only the database
 * is faked (in memory), so the cryptographic checks here are the real ones.
 */

// --- In-memory database ----------------------------------------------------------

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ devices: [] as Row[], challenges: [] as Row[], users: [] as Row[], seq: 0 }));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; lt?: Date; gt?: Date };
      if ('not' in c) return value !== c.not;
      if (c.lt) return (value as Date) < c.lt;
      if (c.gt) return (value as Date) > c.gt;
    }
    return value === cond;
  });
}

vi.mock('server-only', () => ({}));
vi.mock('../lib/auth', () => ({ getRequestAuth: vi.fn() }));
vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: Row }) => db.users.find((u) => matches(u, where)) ?? null,
    },
    device: {
      findMany: async ({ where }: { where: Row }) => db.devices.filter((d) => matches(d, where)),
      findUnique: async ({ where }: { where: Row }) => db.devices.find((d) => matches(d, where)) ?? null,
      count: async ({ where }: { where: Row }) => db.devices.filter((d) => matches(d, where)).length,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `dev_${++db.seq}`, ...data };
        db.devices.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = db.devices.find((d) => matches(d, where))!;
        return Object.assign(row, data);
      },
    },
    deviceChallenge: {
      create: async ({ data }: { data: Row }) => {
        db.challenges.push({ id: `ch_${++db.seq}`, createdAt: new Date(), ...data });
      },
      findFirst: async ({ where }: { where: Row }) => db.challenges.filter((c) => matches(c, where)).at(-1) ?? null,
      deleteMany: async ({ where }: { where: Row }) => {
        const before = db.challenges.length;
        db.challenges = db.challenges.filter((c) => !matches(c, where));
        return { count: before - db.challenges.length };
      },
    },
  },
}));

process.env.JWT_SECRET = 'test-secret-for-work-devices';

import { getDeviceGateCookieOptions, signDeviceGateToken, verifyDeviceGateToken } from '../lib/device-gate';
import { verifySessionToken } from '../lib/session-token';
import {
  DeviceCheckError,
  beginDeviceRegistration,
  beginDeviceVerification,
  finishDeviceRegistration,
  finishDeviceVerification,
  getWebAuthnConfig,
  resolveDevicePrincipal,
} from '../lib/work-devices';

// --- Software authenticator ----------------------------------------------------------

const b64url = (data: Uint8Array | string) => Buffer.from(data).toString('base64url');
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest();

/** CBOR byte string header for the lengths used here. */
function cborBytes(data: Uint8Array): Buffer {
  const head = data.length < 24 ? [0x40 | data.length] : data.length < 256 ? [0x58, data.length] : [0x59, data.length >> 8, data.length & 0xff];
  return Buffer.concat([Buffer.from(head), data]);
}
const cborText = (text: string) => Buffer.concat([Buffer.from([0x60 | text.length]), Buffer.from(text)]);

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
/** "Backup eligible": the key is allowed to sync to other devices. */
const FLAG_BE = 0x08;
const FLAG_AT = 0x40;

class SoftwareAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly coseKey: Buffer;
  private counter = 0;

  constructor(private readonly options: { synced?: boolean; origin?: string; rpID?: string } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    // COSE_Key: {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
    this.coseKey = Buffer.concat([
      Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]),
      cborBytes(Buffer.from(jwk.x!, 'base64url')),
      Buffer.from([0x22]),
      cborBytes(Buffer.from(jwk.y!, 'base64url')),
    ]);
  }

  private get origin() {
    return this.options.origin ?? 'https://erp.example.com';
  }

  private authData(withKey: boolean): Buffer {
    const flags = FLAG_UP | FLAG_UV | (this.options.synced ? FLAG_BE : 0) | (withKey ? FLAG_AT : 0);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(++this.counter);
    const head = Buffer.concat([sha256(this.options.rpID ?? 'erp.example.com'), Buffer.from([flags]), count]);
    if (!withKey) return head;
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    return Buffer.concat([head, Buffer.alloc(16), idLength, this.credentialId, this.coseKey]);
  }

  private clientData(type: string, challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  register(options: { challenge: string }) {
    const authData = this.authData(true);
    const attestationObject = Buffer.concat([
      Buffer.from([0xa3]),
      cborText('fmt'),
      cborText('none'),
      cborText('attStmt'),
      Buffer.from([0xa0]),
      cborText('authData'),
      cborBytes(authData),
    ]);
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key' as const,
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ['internal' as const],
      },
    };
  }

  authenticate(options: { challenge: string }) {
    const authData = this.authData(false);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
    };
  }
}

// --- Fixtures ----------------------------------------------------------------------

const config = { rpID: 'erp.example.com', origin: 'https://erp.example.com' };
const pat = { id: 7, email: 'pat@example.com', name: 'Pat', sessionVersion: 3 };
const sam = { id: 8, email: 'sam@example.com', name: 'Sam', sessionVersion: 1 };

async function register(authenticator: SoftwareAuthenticator, user = pat) {
  const options = await beginDeviceRegistration(config, user);
  return finishDeviceRegistration(config, user, { response: authenticator.register(options), label: '  Front   office laptop ' });
}

async function signInWith(authenticator: SoftwareAuthenticator, user = pat) {
  const options = await beginDeviceVerification(config, user.id);
  return finishDeviceVerification(config, user.id, authenticator.authenticate(options));
}

const approve = (deviceId: string) => {
  db.devices.find((d) => d.id === deviceId)!.status = 'approved';
};

const failsWith = (code: string) => expect.objectContaining({ name: 'DeviceCheckError', code });

beforeEach(() => {
  db.devices = [];
  db.challenges = [];
  db.users = [];
  db.seq = 0;
  vi.unstubAllEnvs();
});

// --- Tests ---------------------------------------------------------------------------

describe('registering a work device', () => {
  it('stores a hardware-bound device as pending, not usable yet', async () => {
    const device = await register(new SoftwareAuthenticator());

    expect(device).toMatchObject({ userId: 7, status: 'pending', label: 'Front office laptop' });
    expect(db.devices).toHaveLength(1);
  });

  it('refuses a passkey that syncs to other devices', async () => {
    await expect(register(new SoftwareAuthenticator({ synced: true }))).rejects.toEqual(failsWith('synced-passkey'));
    expect(db.devices).toHaveLength(0);
  });

  it('refuses a registration made on another site', async () => {
    const phishing = new SoftwareAuthenticator({ origin: 'https://erp-example.com.evil.test' });
    await expect(register(phishing)).rejects.toEqual(failsWith('verification-failed'));
    expect(db.devices).toHaveLength(0);
  });

  it('uses each challenge once', async () => {
    const authenticator = new SoftwareAuthenticator();
    const options = await beginDeviceRegistration(config, pat);
    const response = authenticator.register(options);
    await finishDeviceRegistration(config, pat, { response });

    await expect(finishDeviceRegistration(config, pat, { response })).rejects.toEqual(failsWith('challenge-expired'));
  });

  it('refuses a challenge that has expired', async () => {
    const authenticator = new SoftwareAuthenticator();
    const options = await beginDeviceRegistration(config, pat);
    db.challenges[0]!.expiresAt = new Date(Date.now() - 1000);

    await expect(
      finishDeviceRegistration(config, pat, { response: authenticator.register(options) }),
    ).rejects.toEqual(failsWith('challenge-expired'));
  });
});

describe('signing in from a work device', () => {
  it('refuses a device that is still waiting for approval', async () => {
    const authenticator = new SoftwareAuthenticator();
    await register(authenticator);

    await expect(signInWith(authenticator)).rejects.toEqual(failsWith('pending'));
  });

  it('accepts an approved device and records its use', async () => {
    const authenticator = new SoftwareAuthenticator();
    const device = await register(authenticator);
    approve(device.id);

    await expect(signInWith(authenticator)).resolves.toEqual({ id: device.id, label: 'Front office laptop' });
    expect(db.devices[0]!.lastUsedAt).toBeInstanceOf(Date);
    expect(db.devices[0]!.counter).toBe(BigInt(2));
  });

  it('refuses a device once it is revoked', async () => {
    const authenticator = new SoftwareAuthenticator();
    const device = await register(authenticator);
    approve(device.id);
    db.devices[0]!.status = 'revoked';
    // A revoked device is not even offered; with no other device there is nothing to check.
    await expect(beginDeviceVerification(config, pat.id)).rejects.toEqual(failsWith('no-devices'));
  });

  it("refuses another person's approved device", async () => {
    const sams = new SoftwareAuthenticator();
    approve((await register(sams, sam)).id);
    const pats = new SoftwareAuthenticator();
    approve((await register(pats)).id);

    const options = await beginDeviceVerification(config, pat.id);
    await expect(
      finishDeviceVerification(config, pat.id, sams.authenticate(options)),
    ).rejects.toEqual(failsWith('unknown-device'));
  });

  it('refuses a signature made by a different key claiming the same device', async () => {
    const real = new SoftwareAuthenticator();
    approve((await register(real)).id);
    const forged = new SoftwareAuthenticator();
    Object.assign(forged, { credentialId: real.credentialId });

    const options = await beginDeviceVerification(config, pat.id);
    await expect(
      finishDeviceVerification(config, pat.id, forged.authenticate(options)),
    ).rejects.toEqual(failsWith('verification-failed'));
  });

  it('refuses a replayed response', async () => {
    const authenticator = new SoftwareAuthenticator();
    approve((await register(authenticator)).id);

    const options = await beginDeviceVerification(config, pat.id);
    const response = authenticator.authenticate(options);
    await finishDeviceVerification(config, pat.id, response);

    await expect(finishDeviceVerification(config, pat.id, response)).rejects.toBeInstanceOf(DeviceCheckError);
  });

  it('says so when the person has no device at all', async () => {
    await expect(beginDeviceVerification(config, pat.id)).rejects.toEqual(failsWith('no-devices'));
  });
});

describe('the device gate between password and session', () => {
  const gateRequest = (token: string) =>
    new NextRequest('https://erp.example.com/api/auth/device/options', {
      method: 'POST',
      headers: { cookie: `device_gate=${token}` },
    });

  it('is not a session: the gate token is rejected as a session token', () => {
    const token = signDeviceGateToken({ userId: 7, sessionVersion: 3, method: 'password' });

    expect(verifyDeviceGateToken(token)).toMatchObject({ sub: '7', ver: 3, method: 'password' });
    expect(verifySessionToken(token)).toBeNull();
  });

  it('is only sent to the device-check routes', () => {
    expect(getDeviceGateCookieOptions('x')).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/api/auth/device' });
  });

  it('identifies the person part-way through signing in', async () => {
    db.users.push({ ...pat, status: 'active' });
    const token = signDeviceGateToken({ userId: 7, sessionVersion: 3, method: 'google' });

    await expect(resolveDevicePrincipal(gateRequest(token), 'login')).resolves.toMatchObject({
      via: 'login',
      method: 'google',
      user: { id: 7 },
    });
  });

  it('is void once the password or access has changed, or the account is suspended', async () => {
    const token = signDeviceGateToken({ userId: 7, sessionVersion: 3, method: 'password' });

    db.users = [{ ...pat, sessionVersion: 4, status: 'active' }];
    await expect(resolveDevicePrincipal(gateRequest(token), 'login')).resolves.toBeNull();

    db.users = [{ ...pat, status: 'suspended' }];
    await expect(resolveDevicePrincipal(gateRequest(token), 'login')).resolves.toBeNull();
  });

  it('rejects a forged gate cookie', async () => {
    db.users.push({ ...pat, status: 'active' });
    await expect(resolveDevicePrincipal(gateRequest('not-a-token'), 'login')).resolves.toBeNull();
  });
});

describe('where the device check is pinned', () => {
  const request = new NextRequest('https://attacker.test/api/auth/device/options');

  it('uses the configured address, never the request host', () => {
    vi.stubEnv('WEBAUTHN_ORIGIN', 'https://erp.example.com/');
    expect(getWebAuthnConfig(request)).toEqual({ rpID: 'erp.example.com', origin: 'https://erp.example.com' });
  });

  it('is off in production until the address is configured', () => {
    vi.stubEnv('WEBAUTHN_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(getWebAuthnConfig(request)).toBeNull();
  });

  it('falls back to the dev server address outside production', () => {
    vi.stubEnv('WEBAUTHN_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'development');
    const local = new NextRequest('http://localhost:3000/api/auth/device/options');
    expect(getWebAuthnConfig(local)).toEqual({ rpID: 'localhost', origin: 'http://localhost:3000' });
  });
});
