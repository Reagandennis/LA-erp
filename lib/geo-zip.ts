/**
 * Just enough ZIP to open a `.kmz`, which is a zip holding a `doc.kml`.
 *
 * Adding a zip library for one archive format would be the only third-party
 * dependency in this whole feature, and Node already ships the hard part
 * (`zlib.inflateRawSync`). What is left is reading the central directory, which
 * is a fixed-layout record walk.
 *
 * Sizes and offsets are read from the central directory rather than the local
 * headers, because an archive written with streaming (general-purpose flag bit 3)
 * leaves the local header sizes zeroed.
 */

import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const EOCD_MIN_SIZE = 22;
/** The zip comment is a uint16 length, so the EOCD can be at most this far from the end. */
const MAX_COMMENT = 0xffff;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const ZIP64_MARKER_32 = 0xffffffff;
const ZIP64_MARKER_16 = 0xffff;

function findEocd(buf: Buffer): number {
  const earliest = Math.max(0, buf.length - EOCD_MIN_SIZE - MAX_COMMENT);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= earliest; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Every file in the archive, in central-directory order. Directory entries are
 * skipped. Throws with a readable message rather than returning junk when the
 * archive is not something we can handle.
 */
export function readZipEntries(buf: Buffer): ZipEntry[] {
  if (buf.length < EOCD_MIN_SIZE) {
    throw new Error('Not a zip archive — the file is too small.');
  }

  const eocd = findEocd(buf);
  if (eocd < 0) {
    throw new Error('Not a zip archive — no end-of-central-directory record found.');
  }

  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (totalEntries === ZIP64_MARKER_16 || cdOffset === ZIP64_MARKER_32) {
    throw new Error('ZIP64 archives are not supported. Re-save the KMZ without ZIP64.');
  }
  if (cdOffset >= buf.length) {
    throw new Error('Zip archive is truncated or corrupt.');
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error('Zip central directory is corrupt.');
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    // Directory marker, not a file.
    if (name.endsWith('/')) continue;

    if (flags & 0x1) {
      throw new Error(`"${name}" is encrypted — encrypted archives are not supported.`);
    }
    if (compressedSize === ZIP64_MARKER_32 || localOffset === ZIP64_MARKER_32) {
      throw new Error('ZIP64 archives are not supported. Re-save the KMZ without ZIP64.');
    }
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error(`Zip entry "${name}" points outside the archive.`);
    }

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const end = start + compressedSize;
    if (end > buf.length) {
      throw new Error(`Zip entry "${name}" is truncated.`);
    }
    const raw = buf.subarray(start, end);

    if (method === METHOD_STORE) {
      entries.push({ name, data: Buffer.from(raw) });
    } else if (method === METHOD_DEFLATE) {
      entries.push({ name, data: inflateRawSync(raw) });
    } else {
      throw new Error(`Zip entry "${name}" uses unsupported compression method ${method}.`);
    }
  }

  return entries;
}
