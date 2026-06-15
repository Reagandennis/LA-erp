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

async function authenticate(): Promise<{ base: string; cookie: string } | { error: string }> {
  const network = (process.env.ZELLO_NETWORK ?? '').trim();
  const apiKey = (process.env.ZELLO_API_KEY ?? '').trim();
  const username = (process.env.ZELLO_USERNAME ?? '').trim();
  const password = process.env.ZELLO_PASSWORD ?? '';
  if (!network || !apiKey || !username || !password) return { error: 'not-configured' };

  const base = `https://${network}.zellowork.com`;
  try {
    const tokenRes = await fetch(`${base}/user/gettoken`, { cache: 'no-store' });
    const cookie = readSessionCookie(tokenRes);
    const tokenData = (await tokenRes.json().catch(() => null)) as { token?: string } | null;
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
    return { base, cookie };
  } catch {
    return { error: 'Could not reach the Zello Work network.' };
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
