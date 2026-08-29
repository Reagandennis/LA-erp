import 'server-only';

import crypto from 'crypto';

/**
 * Zello Work Server API client (presence / roster).
 *
 * Auth flow (verified against ladyaskari.zellowork.com):
 *   GET  /user/gettoken           -> { token, sid }  (+ PHPSESSID cookie)
 *   POST /user/login              username, password = md5( md5(pwd) + token + apiKey )
 *   then session cookie authorises /user/get, /channel/get …
 *
 * Credentials come from env (server-side only):
 *   ZELLO_NETWORK, ZELLO_API_KEY, ZELLO_USERNAME, ZELLO_PASSWORD
 */

export interface ZelloRosterUser {
  name: string;
  fullName: string | null;
  online: boolean;
  status: string;
}

export interface ZelloRosterChannel {
  name: string;
}

export interface ZelloRoster {
  configured: boolean;
  error: string | null;
  channels: ZelloRosterChannel[];
  users: ZelloRosterUser[];
  total: number;
  online: number;
}

function md5(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}

function readSessionCookie(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const all = headers.getSetCookie ? headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  const match = all.join('; ').match(/PHPSESSID=([^;]+)/);
  return match ? `PHPSESSID=${match[1]}` : null;
}

const ONLINE_VALUES = new Set(['online', 'available', 'busy', 'standby', 'connected', '1', 'true']);

function isOnline(raw: Record<string, unknown>): boolean {
  if (raw.online === true || raw.online === 1 || raw.online === '1') return true;
  const status = String(raw.status ?? raw.presence ?? '').toLowerCase();
  return ONLINE_VALUES.has(status);
}

async function authenticate(): Promise<{ base: string; cookie: string; sid: string | null } | { error: string }> {
  const network = (process.env.ZELLO_NETWORK ?? '').trim();
  const apiKey = (process.env.ZELLO_API_KEY ?? '').trim();
  const username = (process.env.ZELLO_USERNAME ?? '').trim();
  const password = process.env.ZELLO_PASSWORD ?? '';
  if (!network || !apiKey || !username || !password) return { error: 'not-configured' };

  const base = `https://${network}.zellowork.com`;
  try {
    const tokenRes = await fetch(`${base}/user/gettoken`, { cache: 'no-store' });
    const cookie = readSessionCookie(tokenRes);
    const tokenData = (await tokenRes.json().catch(() => null)) as { token?: string; sid?: string } | null;
    const token = tokenData?.token;
    if (!token || !cookie) return { error: 'Could not get a session token from Zello.' };

    const hashed = md5(md5(password) + token + apiKey);
    const loginRes = await fetch(`${base}/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ username, password: hashed }).toString(),
      cache: 'no-store',
    });
    const loginData = (await loginRes.json().catch(() => null)) as { status?: string; code?: string } | null;
    if (loginData?.code !== '200') {
      return { error: loginData?.status ?? 'Zello login failed.' };
    }
    return { base, cookie, sid: tokenData?.sid ?? null };
  } catch {
    return { error: 'Could not reach the Zello Work network.' };
  }
}

export interface ZelloLiveDevice {
  device: string;
  displayName: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  at: string; // ISO timestamp of the device's last position report
  speed: number | null;
  heading: number | null;
  batteryLevel: number | null;
}

export interface ZelloLocations {
  configured: boolean;
  error: string | null;
  devices: ZelloLiveDevice[];
  total: number; // total the server reports it has (for diagnostics vs. returned)
}

/**
 * Last-known device positions from the Zello Work Server API (`location/get`).
 * This is the same data the Zello Work web map shows — it returns each device's
 * stored last position, independent of whether it is transmitting right now.
 * A world-sized bounding box is used to fetch every device in the network.
 */
function mapLocation(l: Record<string, unknown>): ZelloLiveDevice {
  const lat = Number(l.latitude);
  const lon = Number(l.longitude);
  const report = Number(l.lastReport);
  // lastReport is a Unix timestamp; tolerate seconds or milliseconds.
  const ms = Number.isFinite(report) && report > 0 ? (report > 1e12 ? report : report * 1000) : Date.now();
  const accuracy = Number(l.accuracy);
  const speed = Number(l.speed);
  const heading = Number(l.heading);
  const battery = Number(l.batteryLevel);
  return {
    device: String(l.username ?? ''),
    displayName: (l.displayName as string) ?? null,
    latitude: lat,
    longitude: lon,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    at: new Date(ms).toISOString(),
    speed: Number.isFinite(speed) ? speed : null,
    heading: Number.isFinite(heading) ? heading : null,
    batteryLevel: Number.isFinite(battery) ? battery : null,
  };
}

export async function getZelloLocations(opts?: { name?: string }): Promise<ZelloLocations> {
  const empty: ZelloLocations = { configured: true, error: null, devices: [], total: 0 };
  const session = await authenticate();
  if ('error' in session) {
    if (session.error === 'not-configured') return { ...empty, configured: false };
    return { ...empty, error: session.error };
  }

  const { base, cookie, sid } = session;
  const PAGE = 200;
  const HARD_CAP = 2000; // safety bound
  const devices: ZelloLiveDevice[] = [];
  let start = 0;
  let total = 0;

  try {
    // Page through every device's last-known position (filter=none → include
    // offline devices too, so devices in other regions aren't dropped).
    for (let guard = 0; guard < HARD_CAP / PAGE + 1; guard += 1) {
      const params = new URLSearchParams();
      if (sid) params.set('sid', sid);
      params.set('northeast', '90,180');
      params.set('southwest', '-90,-180');
      params.set('filter', 'none');
      params.set('start', String(start));
      params.set('max', String(PAGE));
      if (opts?.name) params.set('name', opts.name);

      const res = await fetch(`${base}/location/get?${params.toString()}`, {
        headers: { cookie },
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => null)) as
        | { code?: string; status?: string; total?: number; returned?: number; locations?: Record<string, unknown>[] }
        | null;
      if (!data || (data.code && data.code !== '200')) {
        if (devices.length > 0) break; // keep what we already have
        return { ...empty, error: data?.status ?? 'Could not fetch locations from Zello.' };
      }

      const page = (data.locations ?? []).map(mapLocation).filter((d) => d.device && Number.isFinite(d.latitude) && Number.isFinite(d.longitude));
      devices.push(...page);
      total = Number(data.total ?? devices.length) || devices.length;

      const returned = (data.locations ?? []).length;
      start += returned;
      if (returned < PAGE || start >= total || devices.length >= HARD_CAP) break;
    }

    // De-dupe by device (paging overlaps shouldn't happen, but be safe).
    const byDevice = new Map<string, ZelloLiveDevice>();
    for (const d of devices) byDevice.set(d.device, d);

    return { configured: true, error: null, devices: [...byDevice.values()], total: total || byDevice.size };
  } catch {
    if (devices.length > 0) return { configured: true, error: null, devices, total: total || devices.length };
    return { ...empty, error: 'Could not reach the Zello Work network.' };
  }
}

export async function getZelloRoster(): Promise<ZelloRoster> {
  const empty: ZelloRoster = { configured: true, error: null, channels: [], users: [], total: 0, online: 0 };
  const session = await authenticate();
  if ('error' in session) {
    if (session.error === 'not-configured') {
      return { ...empty, configured: false };
    }
    return { ...empty, error: session.error };
  }

  const { base, cookie } = session;
  const [usersRaw, channelsRaw] = await Promise.all([
    fetch(`${base}/user/get`, { headers: { cookie }, cache: 'no-store' })
      .then((r) => r.json())
      .catch(() => null),
    fetch(`${base}/channel/get`, { headers: { cookie }, cache: 'no-store' })
      .then((r) => r.json())
      .catch(() => null),
  ]);

  const users: ZelloRosterUser[] = ((usersRaw?.users ?? []) as Record<string, unknown>[])
    .map((u) => {
      const online = isOnline(u);
      return {
        name: String(u.name ?? ''),
        fullName: (u.full_name as string) ?? null,
        online,
        status: String(u.status ?? (online ? 'Online' : 'Offline')),
      };
    })
    .filter((u) => u.name)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));

  const channels: ZelloRosterChannel[] = ((channelsRaw?.channels ?? []) as Record<string, unknown>[])
    .map((c) => ({ name: String(c.name ?? '') }))
    .filter((c) => c.name);

  return {
    configured: true,
    error: null,
    channels,
    users,
    total: users.length,
    online: users.filter((u) => u.online).length,
  };
}

// --- Channel management ----------------------------------------------------

export interface ZelloChannelCreateResult {
  ok: boolean;
  configured: boolean;
  error: string | null;
  name: string;
}

/**
 * Zello Work channel names. Deliberately conservative — letters, digits,
 * space, dot, hyphen and underscore, 1-40 chars. Zello itself may accept more;
 * widen this if a legitimate name is rejected.
 */
const CHANNEL_NAME_RE = /^[A-Za-z0-9 ._-]{1,40}$/;

export function isValidZelloChannelName(name: string): boolean {
  return CHANNEL_NAME_RE.test(name);
}

export const CHANNEL_NAME_RULE =
  'Channel names may use letters, numbers, spaces, dots, hyphens and underscores (max 40 characters).';

/**
 * Create a channel on the Zello Work network (`PUT /channel/add?name=…`).
 *
 * This is a WRITE against the live network, using the shared service account in
 * ZELLO_USERNAME/ZELLO_PASSWORD — gate callers on admin, not on module access.
 * Zello answers `{ code, status }` like the rest of the Server API; anything
 * other than code "200" is surfaced verbatim so duplicate-name and permission
 * errors reach the operator unchanged.
 */
export async function createZelloChannel(rawName: string): Promise<ZelloChannelCreateResult> {
  const name = rawName.trim();
  const fail = { ok: false, configured: true, name };

  if (!isValidZelloChannelName(name)) {
    return { ...fail, error: CHANNEL_NAME_RULE };
  }

  const session = await authenticate();
  if ('error' in session) {
    if (session.error === 'not-configured') {
      return { ...fail, configured: false, error: 'Zello is not configured on this server.' };
    }
    return { ...fail, error: session.error };
  }

  const { base, cookie } = session;
  try {
    const res = await fetch(`${base}/channel/add?name=${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { cookie },
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as { code?: string; status?: string } | null;
    if (!data || data.code !== '200') {
      return { ...fail, error: data?.status ?? 'Zello rejected the new channel.' };
    }
    return { ok: true, configured: true, error: null, name };
  } catch {
    return { ...fail, error: 'Could not reach the Zello Work network.' };
  }
}
