import 'server-only';

import { createPublicKey } from 'node:crypto';
import jwt from 'jsonwebtoken';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS: [string, ...string[]] = [
  'https://accounts.google.com',
  'accounts.google.com',
];
const JWKS_TTL_MS = 60 * 60 * 1000;

type GoogleJwk = {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
};

export interface GoogleIdentity {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  hostedDomain: string | null;
}

let jwksCache: { keys: GoogleJwk[]; fetchedAt: number } | null = null;

export function getGoogleClientId() {
  return (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
}

/**
 * Optional allow-list of Google Workspace domains (`hd` claim), comma separated.
 * When set, only accounts in those domains may sign in with Google.
 */
function getAllowedHostedDomains() {
  return (process.env.GOOGLE_ALLOWED_HD ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

async function fetchJwks(force = false): Promise<GoogleJwk[]> {
  const fresh =
    jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;

  if (fresh && !force) {
    return jwksCache!.keys;
  }

  const response = await fetch(GOOGLE_JWKS_URL, { cache: 'no-store' });

  if (!response.ok) {
    // Fall back to a stale cache rather than locking everyone out during a blip.
    if (jwksCache) {
      return jwksCache.keys;
    }

    throw new Error(`Unable to fetch Google signing keys (${response.status})`);
  }

  const body = (await response.json()) as { keys?: GoogleJwk[] };
  const keys = body.keys ?? [];
  jwksCache = { keys, fetchedAt: Date.now() };

  return keys;
}

async function findSigningKey(kid: string) {
  const keys = await fetchJwks();
  const match = keys.find((key) => key.kid === kid);

  if (match) {
    return match;
  }

  // Google rotates keys; a miss usually means our cache is behind.
  const refreshed = await fetchJwks(true);
  return refreshed.find((key) => key.kid === kid) ?? null;
}

/**
 * Verifies a Google Identity Services ID token locally (signature, issuer,
 * audience, expiry) and returns the identity it asserts. Returns `null` for any
 * token we cannot fully trust.
 */
export async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleIdentity | null> {
  const clientId = getGoogleClientId();

  if (!clientId) {
    return null;
  }

  const decoded = jwt.decode(idToken, { complete: true });

  if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
    return null;
  }

  if (decoded.header.alg !== 'RS256') {
    return null;
  }

  const jwk = await findSigningKey(decoded.header.kid);

  if (!jwk) {
    return null;
  }

  let payload: jwt.JwtPayload;

  try {
    payload = jwt.verify(idToken, createPublicKey({ key: jwk, format: 'jwk' }), {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: GOOGLE_ISSUERS,
    }) as jwt.JwtPayload;
  } catch {
    return null;
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const sub = typeof payload.sub === 'string' ? payload.sub : '';

  if (!email || !sub) {
    return null;
  }

  const hostedDomain =
    typeof payload.hd === 'string' ? payload.hd.trim().toLowerCase() : null;
  const allowedDomains = getAllowedHostedDomains();

  if (allowedDomains.length > 0 && (!hostedDomain || !allowedDomains.includes(hostedDomain))) {
    return null;
  }

  return {
    googleSub: sub,
    email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : null,
    hostedDomain,
  };
}
