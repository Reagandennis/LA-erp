import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createFolder,
  DriveTooLargeError,
  exportTargetFor,
  getQuota,
  listFiles,
  renameFile,
  trashFile,
  uploadFile,
} from '../lib/google-drive';

const TOKEN = 'ya29.test-token';

function mockJson(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: ok ? status : status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function lastUrl(mock: ReturnType<typeof mockJson>): URL {
  return new URL(String(mock.mock.calls.at(-1)![0]));
}

describe('listFiles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the bearer token and asks only for the fields we use', async () => {
    const fetchMock = mockJson({ files: [] });
    await listFiles(TOKEN);

    const init = fetchMock.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(lastUrl(fetchMock).searchParams.get('fields')).toContain('files(');
  });

  it('browses a folder and hides trashed items by default', async () => {
    const fetchMock = mockJson({ files: [] });
    await listFiles(TOKEN, { folderId: 'abc123' });

    const q = lastUrl(fetchMock).searchParams.get('q')!;
    expect(q).toContain("'abc123' in parents");
    expect(q).toContain('trashed = false');
  });

  it('searches the whole Drive instead of one folder when a query is given', async () => {
    const fetchMock = mockJson({ files: [] });
    await listFiles(TOKEN, { folderId: 'abc123', search: 'invoice' });

    const q = lastUrl(fetchMock).searchParams.get('q')!;
    expect(q).toContain("name contains 'invoice'");
    expect(q).not.toContain('in parents');
  });

  it("escapes quotes so a search term can't break out of the Drive query", async () => {
    // Drive's query language delimits strings with ' — an unescaped one would
    // let a search term close the string and append its own clauses.
    const fetchMock = mockJson({ files: [] });
    await listFiles(TOKEN, { search: "o'brien' or trashed = true" });

    const q = lastUrl(fetchMock).searchParams.get('q')!;
    // The search sits inside exactly one quoted string: every quote the user
    // supplied is escaped, so none of them terminates it.
    const term = q.slice(q.indexOf("name contains '") + "name contains '".length);
    expect(term).toBe("o\\'brien\\' or trashed = true'");
    expect(term.match(/(?<!\\)'/g)).toHaveLength(1); // only the closing quote
  });

  it('normalises a Drive file, including folder and Workspace detection', async () => {
    mockJson({
      files: [
        { id: '1', name: 'Reports', mimeType: 'application/vnd.google-apps.folder' },
        { id: '2', name: 'Plan', mimeType: 'application/vnd.google-apps.document' },
        { id: '3', name: 'photo.png', mimeType: 'image/png', size: '2048', shared: true },
      ],
    });

    const { files } = await listFiles(TOKEN);

    expect(files[0]).toMatchObject({ isFolder: true, isGoogleDoc: false });
    expect(files[1]).toMatchObject({ isFolder: false, isGoogleDoc: true });
    expect(files[2]).toMatchObject({ isFolder: false, sizeBytes: 2048, shared: true });
  });

  it('surfaces the message Google actually returned', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Insufficient permission' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(listFiles(TOKEN)).rejects.toThrow('Insufficient permission');
  });
});

describe('previewable', () => {
  afterEach(() => vi.restoreAllMocks());

  async function previewableFor(mimeType: string): Promise<boolean> {
    mockJson({ files: [{ id: '1', name: 'x', mimeType }] });
    const { files } = await listFiles(TOKEN);
    return files[0]!.previewable;
  }

  it('marks types the browser can actually render', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'application/pdf', 'text/plain']) {
      expect(await previewableFor(mime)).toBe(true);
    }
  });

  it('marks Docs and Slides previewable because they export to PDF', async () => {
    expect(await previewableFor('application/vnd.google-apps.document')).toBe(true);
    expect(await previewableFor('application/vnd.google-apps.presentation')).toBe(true);
  });

  it('does NOT mark a Google Sheet previewable', async () => {
    // Regression: Sheets export to .xlsx, which fileResponse forces to download.
    // Offering "Open preview" for one opened a blank tab that silently
    // downloaded the file instead of showing anything.
    expect(await previewableFor('application/vnd.google-apps.spreadsheet')).toBe(false);
  });

  it('does not mark folders or opaque binaries previewable', async () => {
    expect(await previewableFor('application/vnd.google-apps.folder')).toBe(false);
    expect(await previewableFor('application/zip')).toBe(false);
    expect(
      await previewableFor(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(false);
  });

  it('never marks SVG previewable, since it can carry script', async () => {
    expect(await previewableFor('image/svg+xml')).toBe(false);
  });
});

describe('exportTargetFor', () => {
  it('maps Workspace documents to a downloadable format', () => {
    // Docs/Sheets/Slides have no bytes of their own; alt=media fails on them.
    expect(exportTargetFor('application/vnd.google-apps.document')?.extension).toBe('pdf');
    expect(exportTargetFor('application/vnd.google-apps.spreadsheet')?.extension).toBe('xlsx');
    expect(exportTargetFor('application/vnd.google-apps.presentation')?.extension).toBe('pdf');
  });

  it('leaves ordinary files alone', () => {
    expect(exportTargetFor('image/png')).toBeNull();
    expect(exportTargetFor('application/pdf')).toBeNull();
  });
});

describe('writes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates a folder with the right mime type and parent', async () => {
    const fetchMock = mockJson({ id: 'new', name: 'Ops', mimeType: 'application/vnd.google-apps.folder' });
    await createFolder(TOKEN, 'Ops', 'parent1');

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({
      name: 'Ops',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['parent1'],
    });
  });

  it('omits parents at the Drive root', async () => {
    const fetchMock = mockJson({ id: 'new', name: 'Ops' });
    await createFolder(TOKEN, 'Ops', 'root');

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.parents).toBeUndefined();
  });

  it('uploads as a multipart body containing metadata and bytes', async () => {
    const fetchMock = mockJson({ id: 'up', name: 'a.png' });
    await uploadFile(
      TOKEN,
      { bytes: Buffer.from('PNGDATA'), mimeType: 'image/png', name: 'a.png' },
      'folder1',
    );

    const init = fetchMock.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers['Content-Type']).toContain('multipart/related; boundary=');
    const raw = Buffer.from(init.body as Uint8Array).toString();
    expect(raw).toContain('"name":"a.png"');
    expect(raw).toContain('PNGDATA');
    expect(lastUrl(fetchMock).searchParams.get('uploadType')).toBe('multipart');
  });

  it('renames via PATCH', async () => {
    const fetchMock = mockJson({ id: '1', name: 'renamed' });
    await renameFile(TOKEN, '1', 'renamed');

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'renamed' });
  });

  it('trashes rather than permanently deleting', async () => {
    // An accidental click here must stay recoverable from Drive's own bin.
    const fetchMock = mockJson({});
    await trashFile(TOKEN, '1');

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ trashed: true });
    expect(init.method).not.toBe('DELETE');
  });
});

describe('getQuota', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads usage and limit', async () => {
    mockJson({
      storageQuota: { limit: '16106127360', usage: '1073741824' },
      user: { displayName: 'Ada', emailAddress: 'ada@example.com' },
    });

    const quota = await getQuota(TOKEN);

    expect(quota.limitBytes).toBe(16106127360);
    expect(quota.usageBytes).toBe(1073741824);
    expect(quota.userEmail).toBe('ada@example.com');
  });

  it('reports an unlimited account as having no limit', async () => {
    mockJson({ storageQuota: { usage: '5' } });
    const quota = await getQuota(TOKEN);
    expect(quota.limitBytes).toBeNull();
    expect(quota.usageBytes).toBe(5);
  });
});

describe('DriveTooLargeError', () => {
  it('carries the size so the UI can explain itself', () => {
    const error = new DriveTooLargeError(99);
    expect(error.sizeBytes).toBe(99);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('drive token session', () => {
  beforeEach(() => {
    (globalThis as { googleDriveSessionsGlobal?: unknown }).googleDriveSessionsGlobal = undefined;
    vi.resetModules();
  });

  it('keeps tokens separate per user', async () => {
    const { storeDriveToken, getDriveToken } = await import('../lib/google-drive-session');
    storeDriveToken(1, 'token-one');
    storeDriveToken(2, 'token-two');

    expect(getDriveToken(1)).toBe('token-one');
    expect(getDriveToken(2)).toBe('token-two');
    expect(getDriveToken(3)).toBeNull();
  });

  it('expires a token rather than serving a stale one', async () => {
    const { storeDriveToken, getDriveToken } = await import('../lib/google-drive-session');
    storeDriveToken(1, 'token', -1);
    expect(getDriveToken(1)).toBeNull();
  });

  it('forgets a token on disconnect', async () => {
    const { storeDriveToken, getDriveToken, clearDriveToken } = await import(
      '../lib/google-drive-session'
    );
    storeDriveToken(1, 'token');
    clearDriveToken(1);
    expect(getDriveToken(1)).toBeNull();
  });
});
