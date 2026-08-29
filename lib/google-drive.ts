import 'server-only';

import { isInlineSafe } from './file-response';

/**
 * Google Drive v3 client.
 *
 * Mirrors how the Google contacts import already works (see lib/google-contacts.ts):
 * the browser obtains an access token through the shared GoogleAuthProvider —
 * which already requests the `auth/drive` scope — and the server calls Drive
 * with it as a bearer token. That means no client secret, no refresh tokens and
 * no new Cloud Console setup; the trade-off is that consent lapses roughly
 * hourly and the user re-approves.
 *
 * Every call is scoped to whoever's token is presented, so one user can never
 * see another's Drive through this module.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Fields worth asking for — Drive omits most metadata unless named. */
const FILE_FIELDS =
  'id,name,mimeType,size,modifiedTime,iconLink,thumbnailLink,webViewLink,parents,shared,trashed,owners(displayName,emailAddress)';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  sizeBytes: number | null;
  modifiedAt: string | null;
  webViewLink: string | null;
  shared: boolean;
  ownerName: string | null;
  /** True for Docs/Sheets/Slides, which must be exported rather than downloaded. */
  isGoogleDoc: boolean;
  /**
   * Whether `/content` will actually render this in the browser.
   *
   * Computed from the same inline-safe set `fileResponse` enforces, and after
   * any Workspace export is applied — a Google Sheet exports to .xlsx, which
   * downloads rather than renders, so it is NOT previewable even though it is a
   * Google Doc.
   */
  previewable: boolean;
}

export interface DriveListing {
  files: DriveFile[];
  nextPageToken: string | null;
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

/**
 * Google Workspace documents have no bytes of their own — asking for `alt=media`
 * fails, so they are exported to a concrete format instead.
 */
const EXPORT_AS: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': {
    mimeType: 'application/pdf',
    extension: 'pdf',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'application/pdf',
    extension: 'pdf',
  },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: 'png' },
};

export function exportTargetFor(mimeType: string) {
  return EXPORT_AS[mimeType] ?? null;
}

async function driveFetch(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    // Drive reports the useful part in a JSON error envelope; fall back to the
    // status text when it doesn't.
    const detail = await response
      .json()
      .then((body: { error?: { message?: string } }) => body?.error?.message)
      .catch(() => null);
    throw new DriveError(detail || response.statusText || 'Google Drive request failed', response.status);
  }
  return response;
}

function toDriveFile(raw: Record<string, unknown>): DriveFile {
  const mimeType = String(raw.mimeType ?? '');
  const owners = raw.owners as Array<{ displayName?: string }> | undefined;
  const size = raw.size ? Number(raw.size) : null;
  const isFolder = mimeType === FOLDER_MIME;
  const isGoogleDoc = mimeType.startsWith('application/vnd.google-apps.') && !isFolder;
  const exportTarget = exportTargetFor(mimeType);
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'Untitled'),
    mimeType,
    isFolder,
    sizeBytes: Number.isFinite(size) ? size : null,
    modifiedAt: (raw.modifiedTime as string) ?? null,
    webViewLink: (raw.webViewLink as string) ?? null,
    shared: Boolean(raw.shared),
    ownerName: owners?.[0]?.displayName ?? null,
    isGoogleDoc,
    previewable: isFolder ? false : isInlineSafe(exportTarget?.mimeType ?? mimeType),
  };
}

/** Escape a value for Drive's query language, where `'` delimits strings. */
function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export interface ListOptions {
  folderId?: string;
  /** Free-text search. When set, the whole Drive is searched, not one folder. */
  search?: string;
  pageToken?: string;
  pageSize?: number;
  /** Include items in the trash. Off by default, matching the Drive UI. */
  includeTrashed?: boolean;
}

export async function listFiles(token: string, options: ListOptions = {}): Promise<DriveListing> {
  const clauses: string[] = [];
  if (!options.includeTrashed) clauses.push('trashed = false');

  if (options.search?.trim()) {
    clauses.push(`name contains '${escapeQuery(options.search.trim())}'`);
  } else {
    // Browsing: show one folder's children. 'root' is Drive's alias for My Drive.
    clauses.push(`'${escapeQuery(options.folderId || 'root')}' in parents`);
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    pageSize: String(Math.min(Math.max(options.pageSize ?? 100, 1), 1000)),
    // Folders first, then most recently touched — the order people expect.
    orderBy: 'folder,modifiedTime desc',
    // Include files from shared drives, not just My Drive.
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  if (options.pageToken) params.set('pageToken', options.pageToken);

  const response = await driveFetch(token, `${DRIVE_API}/files?${params.toString()}`);
  const body = (await response.json()) as {
    files?: Record<string, unknown>[];
    nextPageToken?: string;
  };
  return {
    files: (body.files ?? []).map(toDriveFile),
    nextPageToken: body.nextPageToken ?? null,
  };
}

export async function getFile(token: string, fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: 'true' });
  const response = await driveFetch(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params}`);
  return toDriveFile((await response.json()) as Record<string, unknown>);
}

/** Walk up the parent chain so the UI can show a breadcrumb trail. */
export async function getBreadcrumb(
  token: string,
  folderId: string,
): Promise<Array<{ id: string; name: string }>> {
  const trail: Array<{ id: string; name: string }> = [];
  let current = folderId;
  // Bounded: a malformed parent chain must not loop forever.
  for (let depth = 0; depth < 20 && current && current !== 'root'; depth += 1) {
    try {
      const params = new URLSearchParams({ fields: 'id,name,parents', supportsAllDrives: 'true' });
      const response = await driveFetch(
        token,
        `${DRIVE_API}/files/${encodeURIComponent(current)}?${params}`,
      );
      const body = (await response.json()) as { id: string; name: string; parents?: string[] };
      trail.unshift({ id: body.id, name: body.name });
      current = body.parents?.[0] ?? '';
    } catch {
      break; // A parent we can't read just truncates the trail.
    }
  }
  return trail;
}

export interface DriveContent {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}

/**
 * Largest file we will proxy through the app. Beyond this the UI sends the user
 * to Drive's own viewer instead of pulling the bytes through Node.
 */
export const MAX_PROXY_BYTES = 50 * 1024 * 1024;

export class DriveTooLargeError extends Error {
  constructor(readonly sizeBytes: number) {
    super('File is too large to open here.');
    this.name = 'DriveTooLargeError';
  }
}

/**
 * Fetch a file's bytes, exporting Workspace documents to a downloadable format.
 *
 * Buffered rather than streamed so the response can go through `fileResponse`,
 * the same helper that serves in-app uploads — it forces anything not on the
 * inline-safe list to download, which is what stops a hostile Drive file from
 * executing in this origin.
 */
export async function getFileContent(token: string, fileId: string): Promise<DriveContent> {
  const meta = await getFile(token, fileId);
  const exportTarget = exportTargetFor(meta.mimeType);

  if (!exportTarget && meta.sizeBytes && meta.sizeBytes > MAX_PROXY_BYTES) {
    throw new DriveTooLargeError(meta.sizeBytes);
  }

  const url = exportTarget
    ? `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
    : `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

  const response = await driveFetch(token, url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PROXY_BYTES) throw new DriveTooLargeError(bytes.length);

  return {
    bytes,
    mimeType: exportTarget?.mimeType ?? meta.mimeType,
    fileName: exportTarget ? `${meta.name}.${exportTarget.extension}` : meta.name,
  };
}

export async function createFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<DriveFile> {
  const response = await driveFetch(token, `${DRIVE_API}/files?supportsAllDrives=true&fields=${FILE_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: parentId && parentId !== 'root' ? [parentId] : undefined,
    }),
  });
  return toDriveFile((await response.json()) as Record<string, unknown>);
}

export async function uploadFile(
  token: string,
  file: { bytes: Buffer; mimeType: string; name: string },
  parentId?: string,
): Promise<DriveFile> {
  const metadata = {
    name: file.name,
    parents: parentId && parentId !== 'root' ? [parentId] : undefined,
  };

  // Multipart upload: a JSON metadata part followed by the raw bytes.
  const boundary = `laerp-${Date.now().toString(16)}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
    ),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const response = await driveFetch(
    token,
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=${FILE_FIELDS}`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    },
  );
  return toDriveFile((await response.json()) as Record<string, unknown>);
}

export async function renameFile(token: string, fileId: string, name: string): Promise<DriveFile> {
  const response = await driveFetch(
    token,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${FILE_FIELDS}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
  return toDriveFile((await response.json()) as Record<string, unknown>);
}

/**
 * Move a file to the Drive trash rather than deleting it outright.
 *
 * Deliberate: an accidental click in this console should be recoverable from
 * Drive's own bin, exactly as it would be in Drive's UI. Nothing here can
 * destroy a file permanently.
 */
export async function trashFile(token: string, fileId: string): Promise<void> {
  await driveFetch(
    token,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    },
  );
}

export interface DriveQuota {
  limitBytes: number | null;
  usageBytes: number;
  usageInDriveBytes: number | null;
  userEmail: string | null;
  userName: string | null;
}

export async function getQuota(token: string): Promise<DriveQuota> {
  const params = new URLSearchParams({ fields: 'storageQuota,user(displayName,emailAddress)' });
  const response = await driveFetch(token, `${DRIVE_API}/about?${params}`);
  const body = (await response.json()) as {
    storageQuota?: { limit?: string; usage?: string; usageInDrive?: string };
    user?: { displayName?: string; emailAddress?: string };
  };
  const limit = body.storageQuota?.limit ? Number(body.storageQuota.limit) : null;
  return {
    // An unlimited (Workspace) account reports no limit at all.
    limitBytes: Number.isFinite(limit) ? limit : null,
    usageBytes: Number(body.storageQuota?.usage ?? 0) || 0,
    usageInDriveBytes: body.storageQuota?.usageInDrive
      ? Number(body.storageQuota.usageInDrive)
      : null,
    userEmail: body.user?.emailAddress ?? null,
    userName: body.user?.displayName ?? null,
  };
}
