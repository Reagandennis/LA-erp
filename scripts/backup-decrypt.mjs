#!/usr/bin/env node
/**
 * Decrypt LA-ERP backups downloaded from Google Drive.
 *
 * Needs only Node — no app code, no packages — so it works on a fresh machine
 * after losing the server. Point it at one file or a whole snapshot folder:
 *
 *   node scripts/backup-decrypt.mjs --key <recovery key> "2026-10-16 02.00 (scheduled)" restored/
 *   node scripts/backup-decrypt.mjs --key-file key.txt database.dump.enc database.dump
 *
 * `.gz.enc` files are decompressed too, so the output is ready for
 * pg_restore / tar. Each file's auth tag is checked: a truncated or altered
 * backup, or the wrong key, is an error rather than garbage output.
 *
 * Layout: "LAERPBK1" | 12-byte nonce | AES-256-GCM ciphertext | 16-byte tag
 */
import { createDecipheriv } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const MAGIC = 'LAERPBK1';
const HEADER = 8 + 12;
const TAG = 16;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let key = null;
const paths = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--key') key = args[++i];
  else if (args[i] === '--key-file') key = readFileSync(args[++i], 'utf8').trim();
  else if (args[i] === '-h' || args[i] === '--help') {
    console.log('usage: backup-decrypt.mjs (--key KEY | --key-file FILE) <file.enc | snapshot-folder> [output]');
    process.exit(0);
  } else paths.push(args[i]);
}
if (!key) fail('pass the recovery key with --key or --key-file');
const keyBytes = Buffer.from(key, 'base64');
if (keyBytes.length !== 32) fail('the recovery key must be 32 bytes, base64-encoded');
if (paths.length === 0) fail('name a .enc file or a snapshot folder');

async function decryptFile(input, output) {
  const size = statSync(input).size;
  if (size < HEADER + TAG) throw new Error('too small to be a backup');
  const fd = openSync(input, 'r');
  const header = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  readSync(fd, header, 0, HEADER, 0);
  readSync(fd, tag, 0, TAG, size - TAG);
  closeSync(fd);
  if (header.subarray(0, 8).toString('ascii') !== MAGIC) throw new Error('not an LA-ERP backup file');

  const decipher = createDecipheriv('aes-256-gcm', keyBytes, header.subarray(8));
  decipher.setAuthTag(tag);
  const body = size - HEADER - TAG > 0 ? createReadStream(input, { start: HEADER, end: size - TAG - 1 }) : [];
  const stages = [body, decipher, ...(input.endsWith('.gz.enc') ? [createGunzip()] : []), createWriteStream(output)];
  await pipeline(stages);
}

const outputName = (file) => basename(file).replace(/\.enc$/, '').replace(/\.gz$/, '');

const [source, target] = paths;
const isFolder = statSync(source).isDirectory();
const jobs = isFolder
  ? readdirSync(source)
      .filter((name) => name.endsWith('.enc'))
      .map((name) => [join(source, name), join(target ?? 'restored', outputName(name))])
  : [[source, target ?? outputName(source)]];
if (jobs.length === 0) fail(`no .enc files in ${source}`);
if (isFolder) mkdirSync(target ?? 'restored', { recursive: true });

let failed = 0;
for (const [input, output] of jobs) {
  try {
    await decryptFile(input, output);
    console.log(`ok   ${basename(input)} -> ${output}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${basename(input)}: ${error.message.includes('auth') ? 'wrong key, or the file is damaged' : error.message}`);
  }
}
process.exit(failed ? 1 : 0);
