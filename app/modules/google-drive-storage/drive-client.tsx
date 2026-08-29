'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useBanner } from '@/app/ui/banner';
import { GoogleAuthProvider, useGoogleAuth } from '@/app/ui/google-auth-provider';

/**
 * Google Drive file manager.
 *
 * Access is per-user: the browser obtains a Google token through the shared
 * GoogleAuthProvider (which already requests the Drive scope) and hands it to
 * the server once. Everything after that is a normal session-authenticated
 * request, so no token ever appears in a URL, and each person sees only their
 * own Drive.
 */

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  sizeBytes: number | null;
  modifiedAt: string | null;
  webViewLink: string | null;
  shared: boolean;
  ownerName: string | null;
  isGoogleDoc: boolean;
  /** Server-computed: whether /content will render this rather than download it. */
  previewable: boolean;
}

interface Crumb {
  id: string;
  name: string;
}

interface Quota {
  limitBytes: number | null;
  usageBytes: number;
  userEmail: string | null;
  userName: string | null;
}

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function FileGlyph({ file }: { file: DriveFile }) {
  if (file.isFolder) {
    return (
      <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" />
      </svg>
    );
  }
  const tone = file.mimeType.startsWith('image/')
    ? 'text-emerald-500'
    : file.mimeType === 'application/pdf'
      ? 'text-rose-500'
      : file.isGoogleDoc
        ? 'text-blue-500'
        : 'text-gray-400';
  return (
    <svg className={`h-5 w-5 ${tone}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.7}
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25M9 16.5v.75m3-3v3M15 12v5.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    </svg>
  );
}

function DriveManager() {
  const { token, login, loading: authLoading, error: authError, gsiReady } = useGoogleAuth();
  const banner = useBanner();

  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([]);
  const [folderId, setFolderId] = useState('root');
  const [search, setSearch] = useState('');
  const [quota, setQuota] = useState<Quota | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<DriveFile | null>(null);
  const [renaming, setRenaming] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Every Drive call funnels through here so a lapsed consent is handled once. */
  const driveFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const response = await fetch(url, {
        ...init,
        credentials: 'include',
        headers: { ...(init?.headers ?? {}), 'x-silent-banner': '1' },
      });
      if (response.status === 428) {
        // The Google grant lapsed — drop back to the connect screen.
        setConnected(false);
        return null;
      }
      return response;
    },
    [],
  );

  const loadQuota = useCallback(async () => {
    const response = await driveFetch('/api/google-drive/about');
    if (!response?.ok) return;
    setQuota((await response.json()) as Quota);
  }, [driveFetch]);

  const loadFiles = useCallback(
    async (targetFolder: string, query: string) => {
      setBusy(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        else params.set('folderId', targetFolder);

        const response = await driveFetch(`/api/google-drive/files?${params}`);
        if (!response) return;
        const data = (await response.json().catch(() => null)) as
          | { files?: DriveFile[]; breadcrumb?: Crumb[]; error?: string }
          | null;
        if (!response.ok) {
          banner.error('Google Drive', data?.error ?? 'Could not list files.');
          return;
        }
        setFiles(data?.files ?? []);
        setBreadcrumb(data?.breadcrumb ?? []);
      } finally {
        setBusy(false);
      }
    },
    [driveFetch, banner],
  );

  // Is there already a live connection from earlier in this session?
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/google-drive/session', { credentials: 'include' });
        const data = (await response.json().catch(() => null)) as { connected?: boolean } | null;
        setConnected(Boolean(data?.connected));
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  // Hand a freshly-granted browser token to the server.
  useEffect(() => {
    if (!token || connected) return;
    void (async () => {
      const response = await fetch('/api/google-drive/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-silent-banner': '1' },
        body: JSON.stringify({ accessToken: token }),
      });
      if (response.ok) setConnected(true);
    })();
  }, [token, connected]);

  useEffect(() => {
    if (!connected) return;
    void loadFiles(folderId, search);
    void loadQuota();
  }, [connected, folderId, search, loadFiles, loadQuota]);

  const openFolder = (id: string) => {
    setSearch('');
    setSelected(null);
    setFolderId(id);
  };

  const disconnect = async () => {
    await fetch('/api/google-drive/session', { method: 'DELETE', credentials: 'include' });
    setConnected(false);
    setFiles([]);
    setQuota(null);
    setSelected(null);
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (folderId !== 'root') form.append('parentId', folderId);
      const response = await driveFetch('/api/google-drive/upload', { method: 'POST', body: form });
      if (!response) return;
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        banner.error('Upload failed', data?.error ?? 'Please try again.');
        return;
      }
      banner.success('Uploaded to Drive', file.name);
      await loadFiles(folderId, search);
      await loadQuota();
    } finally {
      setBusy(false);
    }
  };

  const createFolder = async () => {
    const name = window.prompt('New folder name');
    if (!name?.trim()) return;
    const response = await driveFetch('/api/google-drive/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), parentId: folderId }),
    });
    if (!response) return;
    if (!response.ok) {
      banner.error('Google Drive', 'Could not create the folder.');
      return;
    }
    banner.success('Folder created', name.trim());
    await loadFiles(folderId, search);
  };

  const rename = async () => {
    if (!selected || !renaming.trim() || renaming.trim() === selected.name) return;
    const response = await driveFetch(`/api/google-drive/files/${encodeURIComponent(selected.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renaming.trim() }),
    });
    if (!response?.ok) {
      banner.error('Google Drive', 'Could not rename that item.');
      return;
    }
    banner.success('Renamed', renaming.trim());
    setSelected({ ...selected, name: renaming.trim() });
    await loadFiles(folderId, search);
  };

  const trash = async (file: DriveFile) => {
    if (!window.confirm(`Move "${file.name}" to the Drive bin? You can restore it from Drive.`)) {
      return;
    }
    const response = await driveFetch(`/api/google-drive/files/${encodeURIComponent(file.id)}`, {
      method: 'DELETE',
    });
    if (!response?.ok) {
      banner.error('Google Drive', 'Could not move that item to the bin.');
      return;
    }
    banner.success('Moved to bin', file.name);
    setSelected(null);
    await loadFiles(folderId, search);
    await loadQuota();
  };

  // --- Not connected -------------------------------------------------------

  if (checking) {
    return (
      <main className="flex min-h-full items-center justify-center bg-gray-50/50 p-8">
        <p className="text-sm text-gray-400">Checking your Google connection…</p>
      </main>
    );
  }

  if (!connected) {
    return (
      <main className="flex min-h-full items-center justify-center bg-gray-50/50 p-8">
        <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
          <h1 className="text-base font-bold text-gray-900">Connect Google Drive</h1>
          <p className="mt-1 text-xs text-gray-500">
            Browse, upload and manage your own Drive from here. Only you can see your files.
          </p>
          <button
            type="button"
            onClick={login}
            disabled={!gsiReady || authLoading}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z" />
              <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
              <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
            </svg>
            {authLoading ? 'Connecting…' : 'Connect Google Drive'}
          </button>
          {authError && <p className="mt-3 text-xs text-rose-600">{authError}</p>}
          <p className="mt-4 text-[11px] text-gray-400">
            Google access lasts about an hour, then you&apos;ll be asked to reconnect.
          </p>
        </div>
      </main>
    );
  }

  // --- Connected -----------------------------------------------------------

  const usedPct =
    quota?.limitBytes && quota.limitBytes > 0
      ? Math.min(100, Math.round((quota.usageBytes / quota.limitBytes) * 100))
      : null;

  return (
    <main className="flex h-screen flex-col bg-gray-50/50">
      <header className="border-b border-gray-100 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-primary sm:text-xl">
              Storage · Google Drive
            </h1>
            <p className="truncate text-xs text-gray-500">
              {quota?.userEmail ?? 'Connected'}
              {usedPct !== null && quota
                ? ` · ${formatBytes(quota.usageBytes)} of ${formatBytes(quota.limitBytes)} used`
                : quota
                  ? ` · ${formatBytes(quota.usageBytes)} used`
                  : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="shrink-0 rounded-xl px-3 py-2 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          >
            Disconnect
          </button>
        </div>
        {usedPct !== null && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${usedPct > 90 ? 'bg-rose-500' : 'bg-primary'}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-4 py-2.5 sm:px-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your Drive…"
          className={`${inputClass} max-w-xs`}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (picked) void upload(picked);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          Upload
        </button>
        <button
          type="button"
          onClick={() => void createFolder()}
          disabled={busy || Boolean(search.trim())}
          title={search.trim() ? 'Clear the search first' : undefined}
          className="rounded-xl bg-gray-50 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-40"
        >
          New folder
        </button>
      </div>

      {!search.trim() && (
        <nav className="flex flex-wrap items-center gap-1 border-b border-gray-100 bg-white px-4 py-2 text-sm sm:px-6">
          <button
            type="button"
            onClick={() => openFolder('root')}
            className={`rounded-lg px-2 py-1 transition hover:bg-gray-100 ${folderId === 'root' ? 'font-semibold text-gray-900' : 'text-gray-500'}`}
          >
            My Drive
          </button>
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <span className="text-gray-300">/</span>
              <button
                type="button"
                onClick={() => openFolder(crumb.id)}
                className={`rounded-lg px-2 py-1 transition hover:bg-gray-100 ${i === breadcrumb.length - 1 ? 'font-semibold text-gray-900' : 'text-gray-500'}`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {busy && files.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">Loading…</p>
          ) : files.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">
              {search.trim() ? 'Nothing matched that search.' : 'This folder is empty.'}
            </p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
              {files.map((file) => (
                <li key={file.id} className="border-b border-gray-50 last:border-0">
                  <button
                    type="button"
                    onDoubleClick={() => file.isFolder && openFolder(file.id)}
                    onClick={() => {
                      if (file.isFolder) openFolder(file.id);
                      else {
                        setSelected(file);
                        setRenaming(file.name);
                      }
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-gray-50 ${selected?.id === file.id ? 'bg-primary/5' : ''}`}
                  >
                    <FileGlyph file={file} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {file.name}
                      </span>
                      <span className="block truncate text-xs text-gray-400">
                        {file.isFolder ? 'Folder' : formatBytes(file.sizeBytes)}
                        {file.modifiedAt ? ` · ${formatDate(file.modifiedAt)}` : ''}
                        {file.shared ? ' · Shared' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected && (
          <aside className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-gray-100 bg-white p-5 lg:flex">
            <div className="flex items-start justify-between gap-2">
              <h2 className="min-w-0 break-words text-sm font-bold text-gray-900">{selected.name}</h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {selected.previewable && selected.mimeType.startsWith('image/') && (
              /* eslint-disable-next-line @next/next/no-img-element -- proxied through
                 an auth-gated route; next/image cannot optimise these. */
              <img
                src={`/api/google-drive/content?fileId=${encodeURIComponent(selected.id)}`}
                alt={selected.name}
                className="mt-4 w-full rounded-xl border border-gray-100 object-contain"
              />
            )}

            <dl className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-400">Size</dt>
                <dd className="text-gray-700">{formatBytes(selected.sizeBytes)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-400">Modified</dt>
                <dd className="text-gray-700">{formatDate(selected.modifiedAt) || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-400">Owner</dt>
                <dd className="truncate text-gray-700">{selected.ownerName ?? '—'}</dd>
              </div>
            </dl>

            <div className="mt-5 space-y-2">
              {selected.previewable && (
                <a
                  href={`/api/google-drive/content?fileId=${encodeURIComponent(selected.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl bg-gray-50 px-3.5 py-2 text-center text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  Open preview
                </a>
              )}
              <a
                href={`/api/google-drive/content?fileId=${encodeURIComponent(selected.id)}&download=1`}
                className="block rounded-xl bg-primary px-3.5 py-2 text-center text-sm font-semibold text-white transition hover:opacity-90"
              >
                {selected.isGoogleDoc ? 'Download as file' : 'Download'}
              </a>
              {!selected.previewable && !selected.isFolder && (
                <p className="px-1 text-center text-[11px] text-gray-400">
                  {selected.isGoogleDoc
                    ? 'Sheets download as .xlsx — open in Drive to view.'
                    : 'This type can\u2019t be shown here. Download it or open it in Drive.'}
                </p>
              )}
              {selected.webViewLink && (
                <a
                  href={selected.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl bg-gray-50 px-3.5 py-2 text-center text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  Open in Drive
                </a>
              )}
            </div>

            <div className="mt-6 border-t border-gray-100 pt-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Rename
              </label>
              <input
                type="text"
                value={renaming}
                onChange={(e) => setRenaming(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void rename()}
                className={`${inputClass} mt-1.5`}
              />
              <button
                type="button"
                onClick={() => void rename()}
                disabled={!renaming.trim() || renaming.trim() === selected.name}
                className="mt-2 w-full rounded-xl bg-gray-50 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-40"
              >
                Save name
              </button>
            </div>

            <button
              type="button"
              onClick={() => void trash(selected)}
              className="mt-4 w-full rounded-xl px-3.5 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
            >
              Move to bin
            </button>
          </aside>
        )}
      </div>
    </main>
  );
}

export default function DriveClient() {
  return (
    <GoogleAuthProvider>
      <DriveManager />
    </GoogleAuthProvider>
  );
}
