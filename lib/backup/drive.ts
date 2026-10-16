import 'server-only';

import { createHash, createSign } from 'crypto';
import { Readable } from 'stream';

/**
 * Google Drive v3 client for backups, signed in as a service account — just
 * what backups need, over plain fetch, so no Google SDK is pulled in.
 *
 * Separate from lib/google-drive.ts on purpose: that client borrows a person's
 * browser token, which lapses within the hour, while a 2 a.m. backup runs with
 * nobody signed in. Service accounts have no storage of their own, so
 * everything is written to a Shared Drive the account has been added to (as a
 * Content manager); every call therefore passes `supportsAllDrives`.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Resumable upload chunk: a multiple of 256 KiB, held in memory one at a time. */
const CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_ATTEMPTS = 6;

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  projectId: string | null;
}

/** Validate a service account key file, with messages an admin can act on. */
export function parseServiceAccount(json: string): ServiceAccount {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new DriveError('That is not a valid JSON key file.');
  }
  if (raw.type !== 'service_account') {
    throw new DriveError('The key must be a service account key (its "type" is "service_account").');
  }
  const clientEmail = typeof raw.client_email === 'string' ? raw.client_email : '';
  const privateKey = typeof raw.private_key === 'string' ? raw.private_key : '';
  if (!clientEmail || !privateKey.includes('PRIVATE KEY')) {
    throw new DriveError('The key file is missing its client_email or private_key.');
  }
  return { clientEmail, privateKey, projectId: typeof raw.project_id === 'string' ? raw.project_id : null };
}

/** The id in a Drive link (`…/folders/<id>`, `?id=<id>`), or the value itself if it already is one. */
export function driveIdFromLink(link: string): string | null {
  const value = link.trim();
  const fromPath = value.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1];
  const fromQuery = value.match(/[?&]id=([A-Za-z0-9_-]{10,})/)?.[1];
  const bare = /^[A-Za-z0-9_-]{10,}$/.test(value) ? value : null;
  return fromPath ?? fromQuery ?? bare;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
  driveId?: string;
  trashed?: boolean;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

export interface UploadedFile extends DriveFile {
  /** Bytes sent, and their MD5 — compared against what Drive stored. */
  bytes: number;
  localMd5: string;
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retryable: rate limits and server errors (Drive asks for exponential backoff on both). */
const retryable = (status: number) => status === 429 || status === 408 || status >= 500;

export class DriveClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly account: ServiceAccount) {}

  get clientEmail(): string {
    return this.account.clientEmail;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({ iss: this.account.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
    );
    let signature: string;
    try {
      signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(this.account.privateKey, 'base64url');
    } catch {
      throw new DriveError('The service account private key could not be read.');
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${signature}`,
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; error_description?: string; error?: string }
      | null;
    if (!response.ok || !data?.access_token) {
      throw new DriveError(
        `Google refused the service account key: ${data?.error_description || data?.error || response.status}. ` +
          'Check that the key is current and the Google Drive API is enabled for its project.',
        response.status,
      );
    }
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  /** One JSON API call, retried on rate limits and server errors. */
  private async call<T>(
    method: string,
    url: string,
    options: { body?: unknown; query?: Record<string, string> } = {},
  ): Promise<T> {
    const target = new URL(url);
    target.searchParams.set('supportsAllDrives', 'true');
    for (const [k, v] of Object.entries(options.query ?? {})) target.searchParams.set(k, v);

    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(target, {
          method,
          headers: {
            Authorization: `Bearer ${await this.accessToken()}`,
            ...(options.body !== undefined ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS) throw new DriveError(`Could not reach Google Drive: ${(error as Error).message}`);
        await sleep(2 ** attempt * 500);
        continue;
      }
      if (response.status === 401 && attempt === 1) {
        this.token = null;
        continue;
      }
      if (retryable(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      if (response.status === 204) return undefined as T;
      const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
      if (!response.ok) {
        throw new DriveError(data?.error?.message || `Google Drive returned ${response.status}`, response.status);
      }
      return data as T;
    }
  }

  getSharedDrive(driveId: string): Promise<{ id: string; name: string }> {
    return this.call('GET', `${API}/drives/${encodeURIComponent(driveId)}`, { query: { fields: 'id,name' } });
  }

  getFile(fileId: string, fields = 'id,name,mimeType,size,md5Checksum,driveId,trashed,webViewLink'): Promise<DriveFile> {
    return this.call('GET', `${API}/files/${encodeURIComponent(fileId)}`, { query: { fields } });
  }

  /** Direct children of a folder with the given name (not trashed). */
  async findChild(parentId: string, name: string, mimeType?: string): Promise<DriveFile | null> {
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = [`'${parentId}' in parents`, `name = '${escaped}'`, 'trashed = false'];
    if (mimeType) q.push(`mimeType = '${mimeType}'`);
    const data = await this.call<{ files?: DriveFile[] }>('GET', `${API}/files`, {
      query: {
        q: q.join(' and '),
        includeItemsFromAllDrives: 'true',
        fields: 'files(id,name,mimeType)',
        pageSize: '10',
      },
    });
    return data.files?.[0] ?? null;
  }

  createFolder(name: string, parentId: string, appProperties?: Record<string, string>): Promise<DriveFile> {
    return this.call('POST', `${API}/files`, {
      body: { name, mimeType: FOLDER_MIME, parents: [parentId], appProperties },
      query: { fields: 'id,name,webViewLink' },
    });
  }

  /** A small file in one request (manifests, write tests). */
  async uploadSmall(
    name: string,
    parentId: string,
    content: Buffer | string,
    options: { mimeType?: string; appProperties?: Record<string, string> } = {},
  ): Promise<UploadedFile> {
    return this.upload(name, parentId, Readable.from([Buffer.from(content)]), options);
  }

  /**
   * Stream `source` into a new file with a resumable upload.
   *
   * The total size is never needed up front, so a database dump can be
   * uploaded while pg_dump is still writing it. If `source` errors part way
   * the final chunk is never sent, and Drive discards the unfinished upload
   * rather than keeping a truncated file.
   */
  async upload(
    name: string,
    parentId: string,
    source: Readable,
    options: { mimeType?: string; appProperties?: Record<string, string> } = {},
  ): Promise<UploadedFile> {
    const mimeType = options.mimeType ?? 'application/octet-stream';
    const session = await this.startUpload(name, parentId, mimeType, options.appProperties);
    const md5 = createHash('md5');

    let offset = 0;
    let buffered: Buffer[] = [];
    let bufferedBytes = 0;
    const take = (bytes: number) => {
      const all = Buffer.concat(buffered, bufferedBytes);
      const part = all.subarray(0, bytes);
      const rest = all.subarray(bytes);
      buffered = rest.length ? [rest] : [];
      bufferedBytes = rest.length;
      return part;
    };

    try {
      for await (const chunk of source) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        buffered.push(data);
        bufferedBytes += data.length;
        while (bufferedBytes >= CHUNK_BYTES) {
          const part = take(CHUNK_BYTES);
          md5.update(part);
          await this.putChunk(session, part, offset, null);
          offset += part.length;
        }
      }
    } catch (error) {
      void this.cancelUpload(session);
      throw error;
    }

    const last = take(bufferedBytes);
    md5.update(last);
    const uploaded = await this.putChunk(session, last, offset, offset + last.length);
    const file = await this.getFile(uploaded!.id);
    return { ...file, bytes: offset + last.length, localMd5: md5.digest('hex') };
  }

  private async startUpload(
    name: string,
    parentId: string,
    mimeType: string,
    appProperties?: Record<string, string>,
  ): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=id`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
        },
        body: JSON.stringify({ name, parents: [parentId], mimeType, appProperties }),
      }).catch(() => null);
      const location = response?.headers.get('location');
      if (response?.ok && location) return location;
      if ((!response || retryable(response.status)) && attempt < MAX_ATTEMPTS) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      const data = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new DriveError(data?.error?.message || `Could not start the upload of ${name}`, response?.status);
    }
  }

  /**
   * Send one chunk (`total` set on the last). On a dropped connection or a
   * server error, ask Drive how much it kept and resend only the rest.
   */
  private async putChunk(session: string, data: Buffer, offset: number, total: number | null): Promise<DriveFile | null> {
    let sent = 0;
    for (let attempt = 1; ; attempt++) {
      const part = data.subarray(sent);
      const start = offset + sent;
      const range =
        part.length > 0 ? `bytes ${start}-${start + part.length - 1}/${total ?? '*'}` : `bytes */${total}`;
      const response = await fetch(session, {
        method: 'PUT',
        headers: { 'Content-Length': String(part.length), 'Content-Range': range },
        body: part.length > 0 ? new Uint8Array(part) : undefined,
      }).catch(() => null);

      if (response && (response.status === 200 || response.status === 201)) {
        return (await response.json()) as DriveFile;
      }
      if (response?.status === 308) {
        const received = this.receivedThrough(response);
        sent = received - offset;
        if (sent >= data.length) return null;
        continue; // Drive kept less than we sent: send the remainder.
      }
      if ((!response || retryable(response.status)) && attempt < MAX_ATTEMPTS) {
        await sleep(2 ** attempt * 500);
        // Where did the interrupted chunk get to?
        const status = await fetch(session, {
          method: 'PUT',
          headers: { 'Content-Length': '0', 'Content-Range': `bytes */${total ?? '*'}` },
        }).catch(() => null);
        if (status && (status.status === 200 || status.status === 201)) return (await status.json()) as DriveFile;
        if (status?.status === 308) sent = Math.max(0, this.receivedThrough(status) - offset);
        continue;
      }
      const body = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new DriveError(body?.error?.message || `Upload failed (${response?.status ?? 'network error'})`, response?.status);
    }
  }

  /** Bytes Drive has stored so far, from a 308's `Range: bytes=0-N`. */
  private receivedThrough(response: Response): number {
    const match = response.headers.get('range')?.match(/bytes=0-(\d+)/);
    return match ? Number(match[1]) + 1 : 0;
  }

  private async cancelUpload(session: string): Promise<void> {
    await fetch(session, { method: 'DELETE' }).catch(() => {});
  }

  /** Move to the Drive trash: recoverable there for 30 days. */
  async trash(fileId: string): Promise<void> {
    await this.call('PATCH', `${API}/files/${encodeURIComponent(fileId)}`, {
      body: { trashed: true },
      query: { fields: 'id' },
    });
  }

  /** Lock (or unlock) a file read-only, so its contents can't be changed in Drive. */
  async setReadOnly(fileId: string, readOnly: boolean, reason = 'LA-ERP backup — do not modify'): Promise<void> {
    await this.call('PATCH', `${API}/files/${encodeURIComponent(fileId)}`, {
      body: { contentRestrictions: [readOnly ? { readOnly: true, reason } : { readOnly: false }] },
      query: { fields: 'id' },
    });
  }

  /** A file's bytes. */
  async download(fileId: string): Promise<Readable> {
    const response = await fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
    });
    if (!response.ok || !response.body) {
      throw new DriveError(`Could not download the file (${response.status})`, response.status);
    }
    return Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  }
}
