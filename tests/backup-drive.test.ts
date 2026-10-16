import { createHash, generateKeyPairSync } from 'crypto';
import { Readable } from 'stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { DriveClient, driveIdFromLink, parseServiceAccount } from '../lib/backup/drive';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'laerp',
  client_email: 'backups@laerp.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
});

const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=abc';

describe('service account and links', () => {
  it('accepts a service account key and explains what is wrong with anything else', () => {
    expect(parseServiceAccount(KEY_JSON).clientEmail).toBe('backups@laerp.iam.gserviceaccount.com');
    expect(() => parseServiceAccount('{nope')).toThrow(/valid JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ type: 'authorized_user' }))).toThrow(/service account/);
  });

  it('reads the id out of every common Drive link shape', () => {
    expect(driveIdFromLink('https://drive.google.com/drive/folders/0AbCdEfGhIjKlMnOpQ')).toBe('0AbCdEfGhIjKlMnOpQ');
    expect(driveIdFromLink('https://drive.google.com/drive/u/1/folders/1xYzAbCdEfGh?usp=sharing')).toBe('1xYzAbCdEfGh');
    expect(driveIdFromLink('https://drive.google.com/open?id=1xYzAbCdEfGh')).toBe('1xYzAbCdEfGh');
    expect(driveIdFromLink('0AbCdEfGhIjKlMnOpQ')).toBe('0AbCdEfGhIjKlMnOpQ');
    expect(driveIdFromLink('not a link')).toBeNull();
  });
});

describe('resumable upload', () => {
  const fetchMock = vi.fn();
  /** What Drive "stored", reassembled from the chunk PUTs it received. */
  let stored: Buffer;
  let ranges: string[];

  beforeEach(() => {
    stored = Buffer.alloc(0);
    ranges = [];
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string | URL, init: RequestInit = {}) => {
      const href = String(url);
      if (href.startsWith('https://oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'tok', expires_in: 3600 });
      }
      if (href.includes('uploadType=resumable')) {
        return new Response(null, { status: 200, headers: { location: SESSION } });
      }
      if (href === SESSION && init.method === 'PUT') {
        const range = (init.headers as Record<string, string>)['Content-Range'];
        ranges.push(range);
        if (init.body) stored = Buffer.concat([stored, Buffer.from(init.body as Uint8Array)]);
        if (range.endsWith('/*')) {
          return new Response(null, { status: 308, headers: { range: `bytes=0-${stored.length - 1}` } });
        }
        return Response.json({ id: 'file-1' });
      }
      if (href.includes('/files/file-1')) {
        return Response.json({ id: 'file-1', name: 'x', size: String(stored.length), md5Checksum: createHash('md5').update(stored).digest('hex') });
      }
      throw new Error(`unexpected request ${init.method ?? 'GET'} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('streams in 16 MiB chunks of unknown total, then finalises — bytes and checksum intact', async () => {
    const MiB = 1024 * 1024;
    const data = Buffer.alloc(40 * MiB);
    for (let i = 0; i < data.length; i += 4096) data[i] = i % 251;
    // Arrives in odd-sized pieces, as from pg_dump.
    const pieces = [] as Buffer[];
    for (let i = 0; i < data.length; i += 3 * MiB + 17) pieces.push(data.subarray(i, i + 3 * MiB + 17));

    const client = new DriveClient(parseServiceAccount(KEY_JSON));
    const file = await client.upload('database.dump.enc', 'folder-1', Readable.from(pieces));

    expect(ranges).toEqual([`bytes 0-${16 * MiB - 1}/*`, `bytes ${16 * MiB}-${32 * MiB - 1}/*`, `bytes ${32 * MiB}-${40 * MiB - 1}/${40 * MiB}`]);
    expect(stored.equals(data)).toBe(true);
    expect(file.bytes).toBe(data.length);
    expect(file.localMd5).toBe(file.md5Checksum);
  });

  it('finalises with an empty request when the data ends exactly on a chunk boundary', async () => {
    const MiB = 1024 * 1024;
    const client = new DriveClient(parseServiceAccount(KEY_JSON));
    await client.upload('x.enc', 'folder-1', Readable.from([Buffer.alloc(16 * MiB)]));
    expect(ranges).toEqual([`bytes 0-${16 * MiB - 1}/*`, `bytes */${16 * MiB}`]);
  });

  it('abandons the upload when the source fails, so no truncated file is kept', async () => {
    const client = new DriveClient(parseServiceAccount(KEY_JSON));
    const failing = new Readable({
      read() {
        this.destroy(new Error('pg_dump: connection lost'));
      },
    });
    await expect(client.upload('database.dump.enc', 'folder-1', failing)).rejects.toThrow('pg_dump: connection lost');
    // The session is cancelled; it was never finalised with a total.
    expect(ranges.some((r) => !r.endsWith('/*'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === SESSION && (init as RequestInit)?.method === 'DELETE')).toBe(true);
  });
});
