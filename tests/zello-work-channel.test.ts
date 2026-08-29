import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { CHANNEL_NAME_RULE, createZelloChannel, isValidZelloChannelName } from '../lib/zello-work';

const ZELLO_KEYS = ['ZELLO_NETWORK', 'ZELLO_API_KEY', 'ZELLO_USERNAME', 'ZELLO_PASSWORD'];

/** Stand in for the two-step gettoken -> login handshake, then the add call. */
function mockZelloFlow(addResponse: unknown, addStatus = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/user/gettoken')) {
      return new Response(JSON.stringify({ token: 'tok', sid: 'sid-1' }), {
        headers: { 'content-type': 'application/json', 'set-cookie': 'PHPSESSID=abc123; path=/' },
      });
    }
    if (url.includes('/user/login')) {
      return new Response(JSON.stringify({ code: '200', status: 'OK' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/channel/add')) {
      return new Response(JSON.stringify(addResponse), {
        status: addStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe('isValidZelloChannelName', () => {
  it('accepts ordinary names', () => {
    for (const name of ['Ops', 'Ops 1', 'ops-north', 'ops_north', 'Team.2']) {
      expect(isValidZelloChannelName(name)).toBe(true);
    }
  });

  it('rejects empty, overlong and unsafe names', () => {
    expect(isValidZelloChannelName('')).toBe(false);
    expect(isValidZelloChannelName('a'.repeat(41))).toBe(false);
    expect(isValidZelloChannelName('ops/../admin')).toBe(false);
    expect(isValidZelloChannelName('ops?name=x')).toBe(false);
  });
});

describe('createZelloChannel', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ZELLO_KEYS) saved[k] = process.env[k];
    process.env.ZELLO_NETWORK = 'testnet';
    process.env.ZELLO_API_KEY = 'key';
    process.env.ZELLO_USERNAME = 'svc';
    process.env.ZELLO_PASSWORD = 'pw';
  });

  afterEach(() => {
    for (const k of ZELLO_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
    vi.restoreAllMocks();
  });

  it('reports not-configured without ever calling Zello', async () => {
    for (const k of ZELLO_KEYS) delete process.env[k];
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await createZelloChannel('Ops');

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid name before authenticating', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await createZelloChannel('bad/name');

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toBe(CHANNEL_NAME_RULE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUTs the channel with the session cookie and a url-encoded name', async () => {
    const fetchMock = mockZelloFlow({ code: '200', status: 'OK' });

    const result = await createZelloChannel('  Ops North  ');

    expect(result).toEqual({ ok: true, configured: true, error: null, name: 'Ops North' });
    const addCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/channel/add'));
    expect(addCall).toBeDefined();
    expect(String(addCall![0])).toBe('https://testnet.zellowork.com/channel/add?name=Ops%20North');
    expect(addCall![1]).toMatchObject({ method: 'PUT' });
    expect((addCall![1] as RequestInit & { headers: Record<string, string> }).headers.cookie).toBe(
      'PHPSESSID=abc123',
    );
  });

  it('surfaces a Zello rejection verbatim (e.g. duplicate name)', async () => {
    mockZelloFlow({ code: '409', status: 'Channel already exists' });

    const result = await createZelloChannel('Ops');

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toBe('Channel already exists');
  });

  it('does not throw when the network is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await createZelloChannel('Ops');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Could not reach the Zello Work network.');
  });
});
