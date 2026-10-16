import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Transform } from 'stream';

/**
 * Backup encryption: AES-256-GCM, one random nonce per file.
 *
 * File layout (documented in the manifest, and read by
 * scripts/backup-decrypt.mjs, which needs nothing but Node to restore):
 *
 *   "LAERPBK1" (8 bytes) | nonce (12) | ciphertext | auth tag (16)
 *
 * The tag at the end authenticates the whole file, so a truncated or altered
 * backup fails to decrypt instead of restoring garbage.
 */

export const MAGIC = Buffer.from('LAERPBK1', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function generateKey(): string {
  return randomBytes(32).toString('base64');
}

function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32) throw new Error('The backup key must be 32 bytes, base64-encoded.');
  return bytes;
}

/** Short, shareable id of a key ("3f9a-…"), so a snapshot says which key opens it. */
export function keyFingerprint(key: string): string {
  const hex = createHash('sha256').update(keyBytes(key)).digest('hex').slice(0, 16);
  return hex.match(/.{4}/g)!.join('-');
}

export function encryptStream(key: string): Transform {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), nonce);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!started) {
        started = true;
        this.push(Buffer.concat([MAGIC, nonce]));
      }
      callback(null, cipher.update(chunk));
    },
    flush(callback) {
      if (!started) this.push(Buffer.concat([MAGIC, nonce]));
      this.push(cipher.final());
      callback(null, cipher.getAuthTag());
    },
  });
}

/** Decrypt a whole (small) backup file in memory; throws if it was altered or the key is wrong. */
export function decryptBuffer(key: string, data: Buffer): Buffer {
  if (data.length < MAGIC.length + NONCE_BYTES + TAG_BYTES || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not an LA-ERP backup file.');
  }
  const nonce = data.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES);
  const tag = data.subarray(data.length - TAG_BYTES);
  const body = data.subarray(MAGIC.length + NONCE_BYTES, data.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
