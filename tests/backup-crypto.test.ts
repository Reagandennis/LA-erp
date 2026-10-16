import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { createGzip } from 'zlib';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { decryptBuffer, encryptStream, generateKey, keyFingerprint, MAGIC } from '../lib/backup/crypto';

const run = promisify(execFile);

async function encrypt(key: string, data: Buffer, gzip = false): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline([
    Readable.from([data.subarray(0, 7), data.subarray(7)]),
    ...(gzip ? [createGzip()] : []),
    encryptStream(key),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  ]);
  return Buffer.concat(chunks);
}

describe('backup encryption', () => {
  const key = generateKey();
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'laerp-backup-test-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips, with the documented header', async () => {
    const plain = Buffer.from('pg_dump output, or any archive '.repeat(1000));
    const sealed = await encrypt(key, plain);
    expect(sealed.subarray(0, 8).equals(MAGIC)).toBe(true);
    expect(sealed.length).toBe(plain.length + 8 + 12 + 16);
    expect(decryptBuffer(key, sealed).equals(plain)).toBe(true);
  });

  it('encrypts an empty part too (an empty folder still restores)', async () => {
    expect(decryptBuffer(key, await encrypt(key, Buffer.alloc(0))).length).toBe(0);
  });

  it('refuses a wrong key and any altered byte', async () => {
    const sealed = await encrypt(key, Buffer.from('secret'));
    expect(() => decryptBuffer(generateKey(), sealed)).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[22] ^= 1;
    expect(() => decryptBuffer(key, tampered)).toThrow();
  });

  it('fingerprints a key without revealing it', () => {
    expect(keyFingerprint(key)).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
    expect(keyFingerprint(key)).toBe(keyFingerprint(key));
    expect(keyFingerprint(generateKey())).not.toBe(keyFingerprint(key));
  });

  it('is opened by the standalone restore script, gunzipping .gz parts', async () => {
    const plain = Buffer.from('restore me '.repeat(5000));
    const folder = join(dir, 'snapshot');
    await run('mkdir', ['-p', folder]);
    await writeFile(join(folder, 'database.dump.enc'), await encrypt(key, plain));
    await writeFile(join(folder, 'config.tar.gz.enc'), await encrypt(key, plain, true));
    await writeFile(join(dir, 'key.txt'), key);

    const out = join(dir, 'restored');
    await run(process.execPath, ['scripts/backup-decrypt.mjs', '--key-file', join(dir, 'key.txt'), folder, out]);
    expect((await readFile(join(out, 'database.dump'))).equals(plain)).toBe(true);
    expect((await readFile(join(out, 'config.tar'))).equals(plain)).toBe(true);

    await expect(
      run(process.execPath, ['scripts/backup-decrypt.mjs', '--key', generateKey(), join(folder, 'database.dump.enc'), join(dir, 'x')]),
    ).rejects.toThrow(/wrong key/);
  });
});
