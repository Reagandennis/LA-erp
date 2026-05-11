/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useGoogleAuth } from '@/app/ui/GoogleAuthProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  createdTime: string;
  owners?: { displayName: string; photoLink?: string }[];
  webViewLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  parents?: string[];
  starred?: boolean;
};

type BreadcrumbItem = { id: string; name: string };

type StorageQuota = { limit: string; usage: string; usageInDrive: string };

type UploadItem = { id: string; name: string; progress: number; status: 'uploading' | 'done' | 'error' };

// ─── Google Identity Services types (minimal) removed (using centralized auth) ──

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ESCAPED_APOSTROPHE = String.raw`\'`;

function formatSize(bytes?: string): string {
  if (!bytes) return '—';
  const n = Number.parseInt(bytes, 10);
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function mimeColor(mime: string): { bg: string; text: string; label: string } {
  if (mime === FOLDER_MIME)                                     return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '📁' };
  if (mime.startsWith('image/'))                               return { bg: 'bg-purple-100', text: 'text-purple-700', label: '🖼' };
  if (mime.includes('pdf'))                                    return { bg: 'bg-red-100',    text: 'text-red-700',    label: 'PDF' };
  if (mime.includes('spreadsheet') || mime.includes('excel')) return { bg: 'bg-green-100',  text: 'text-green-700',  label: 'XLS' };
  if (mime.includes('presentation') || mime.includes('powerpoint')) return { bg: 'bg-orange-100', text: 'text-orange-700', label: 'PPT' };
  if (mime.includes('document') || mime.includes('word'))     return { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'DOC' };
  if (mime.startsWith('video/'))                               return { bg: 'bg-pink-100',   text: 'text-pink-700',   label: '🎬' };
  if (mime.startsWith('audio/'))                               return { bg: 'bg-indigo-100', text: 'text-indigo-700', label: '🎵' };
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar')) return { bg: 'bg-gray-100', text: 'text-gray-700', label: 'ZIP' };
  return { bg: 'bg-gray-100', text: 'text-gray-600', label: '📄' };
}

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Drive API helpers ─────────────────────────────────────────────────────────

async function driveGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

async function driveDelete(fileId: string, token: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function driveCreateFolder(name: string, parentId: string, token: string): Promise<DriveFile> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return res.json() as Promise<DriveFile>;
}

async function driveRename(fileId: string, newName: string, token: string): Promise<DriveFile> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });
  return res.json() as Promise<DriveFile>;
}

function uploadFileXHR(
  file: File,
  parentId: string,
  token: string,
  onProgress: (pct: number) => void,
): Promise<DriveFile> {
  return new Promise((resolve, reject) => {
    const metadata = { name: file.name, parents: [parentId] };
    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    body.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,createdTime,owners,webViewLink');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as DriveFile);
      else reject(new Error(xhr.responseText));
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(body);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

type SetUploads = React.Dispatch<React.SetStateAction<UploadItem[]>>;
type SetFiles   = React.Dispatch<React.SetStateAction<DriveFile[]>>;

async function runUpload(
  file: File,
  uid: string,
  parentId: string,
  token: string,
  setUploads: SetUploads,
  setFiles: SetFiles,
): Promise<void> {
  try {
    const created = await uploadFileXHR(file, parentId, token, pct =>
      setUploads(prev => prev.map(u => u.id === uid ? { ...u, progress: pct } : u)),
    );
    setUploads(prev => prev.map(u => u.id === uid ? { ...u, progress: 100, status: 'done' } : u));
    setFiles(prev => [created, ...prev]);
    setTimeout(() => setUploads(prev => prev.filter(u => u.id !== uid)), 2000);
  } catch {
    setUploads(prev => prev.map(u => u.id === uid ? { ...u, status: 'error' } : u));
  }
}

// ─── Sign-in screen ───────────────────────────────────────────────────────────

function SignInScreen({ gsiReady, handleLogin, authError, authLoading }: Readonly<{
  gsiReady: boolean;
  handleLogin: () => void;
  authError: string | null;
  authLoading: boolean;
}>) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl p-12 max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <svg viewBox="0 0 87.3 78" className="w-20 h-20">
            <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
            <path d="M43.65 25L29.9 1.55C28.55.75 27 .35 25.45.35c-1.55 0-3.1.4-4.45 1.2L13.75 7.8l-13 22.55h27.25z" fill="#00ac47"/>
            <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H60.1L73.55 76.8z" fill="#ea4335"/>
            <path d="M43.65 25L57.4 1.55C56.05.75 54.5.35 52.95.35H34.35c-1.55 0-3.1.4-4.45 1.2z" fill="#00832d"/>
            <path d="M60.1 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.45 1.2h48.9c1.55 0 3.1-.4 4.45-1.2z" fill="#2684fc"/>
            <path d="M73.4 26.35l-13-22.55C59.6 2.2 58.45 1.1 57.1.3L43.65 25 60.1 53h27.2c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Google Drive</h1>
          <p className="text-gray-500 mt-2 text-sm leading-relaxed">
            Connect your Google Drive to browse, upload, download, and manage your files directly from the ERP.
          </p>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2 text-sm text-gray-600">
          {['Browse all your Drive files & folders', 'Upload files with real-time progress', 'Create folders, rename & delete files', 'Open files directly in Google Drive'].map(f => (
            <div key={f} className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
              {f}
            </div>
          ))}
        </div>
        {authError && <p className="text-red-500 text-sm bg-red-50 px-4 py-2 rounded-lg">{authError}</p>}
        <button
          type="button"
          disabled={!gsiReady || authLoading}
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white border-2 border-gray-300 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {authLoading ? 'Signing in…' : (gsiReady ? 'Sign in with Google' : 'Loading…')}
        </button>
        <p className="text-xs text-gray-400">Your files stay in your Google Drive. This app requests access only for this session.</p>
      </div>
    </div>
  );
}

export default function GoogleDriveStoragePage() {
  const { token: accessToken, login: handleGoogleLogin, logout: handleGoogleLogout, loading: authLoading, error: authError, gsiReady } = useGoogleAuth();

  const [files, setFiles]                 = useState<DriveFile[]>([]);
  const [loading, setLoading]             = useState(false);
  const [breadcrumb, setBreadcrumb]       = useState<BreadcrumbItem[]>([{ id: 'root', name: 'My Drive' }]);
  const [quota, setQuota]                 = useState<StorageQuota | null>(null);

  const [searchQuery, setSearchQuery]     = useState('');
  const [viewMode, setViewMode]           = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy]               = useState<'name' | 'modifiedTime' | 'size'>('modifiedTime');
  const [selectedFile, setSelectedFile]   = useState<DriveFile | null>(null);

  const [uploads, setUploads]             = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging]       = useState(false);

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId]       = useState<string | null>(null);
  const [renameValue, setRenameValue]     = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<DriveFile | null>(null);

  const fileInputRef  = useRef<HTMLInputElement>(null);
  const currentFolder = breadcrumb.at(-1)!;

  // ── Init token client removed (using centralized auth) ──────────────────

  // ── Fetch files when token or folder changes ───────────────────────────────
  const fetchFiles = useCallback(async (folderId: string, token: string, query = '') => {
    setLoading(true);
    try {
      let q = `'${folderId}' in parents and trashed = false`;
      const escapedQuery = query.replaceAll("'", ESCAPED_APOSTROPHE);
      if (query) q = `name contains '${escapedQuery}' and trashed = false`;

      const params = new URLSearchParams({
        q,
        fields: 'files(id,name,mimeType,size,modifiedTime,createdTime,owners,webViewLink,starred)',
        orderBy: sortBy === 'name' ? 'name' : sortBy === 'size' ? 'quotaBytesUsed desc' : 'modifiedTime desc',
        pageSize: '100',
      });
      const data = await driveGet<{ files: DriveFile[] }>(`files?${params}`, token);
      setFiles(data.files ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === '401') { handleGoogleLogout(); handleGoogleLogin(); }
    } finally {
      setLoading(false);
    }
  }, [sortBy, handleGoogleLogout, handleGoogleLogin]);

  useEffect(() => {
    if (!accessToken) return;
    void fetchFiles(currentFolder.id, accessToken, searchQuery);
  }, [accessToken, currentFolder.id, searchQuery, fetchFiles]);

  // ── Fetch quota ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return;
    void driveGet<{ storageQuota: StorageQuota }>('about?fields=storageQuota', accessToken)
      .then(d => setQuota(d.storageQuota))
      .catch(() => null);
  }, [accessToken]);

  // ── Navigate into folder ───────────────────────────────────────────────────
  const openFolder = (f: DriveFile) => {
    setBreadcrumb(prev => [...prev, { id: f.id, name: f.name }]);
    setSelectedFile(null);
    setSearchQuery('');
  };

  const navigateTo = (idx: number) => {
    setBreadcrumb(prev => prev.slice(0, idx + 1));
    setSelectedFile(null);
  };

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (fileList: FileList) => {
    if (!accessToken) return;
    for (const file of Array.from(fileList)) {
      const uid = `up-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      setUploads(prev => [...prev, { id: uid, name: file.name, progress: 0, status: 'uploading' }]);
      await runUpload(file, uid, currentFolder.id, accessToken, setUploads, setFiles);
    }
  }, [accessToken, currentFolder.id]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files.length) void handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteConfirm || !accessToken) return;
    await driveDelete(deleteConfirm.id, accessToken);
    setFiles(prev => prev.filter(f => f.id !== deleteConfirm.id));
    if (selectedFile?.id === deleteConfirm.id) setSelectedFile(null);
    setDeleteConfirm(null);
  };

  // ── Rename ─────────────────────────────────────────────────────────────────
  const submitRename = async () => {
    if (!renamingId || !accessToken || !renameValue.trim()) return;
    const updated = await driveRename(renamingId, renameValue.trim(), accessToken);
    setFiles(prev => prev.map(f => f.id === renamingId ? { ...f, name: updated.name } : f));
    if (selectedFile?.id === renamingId) setSelectedFile(prev => prev ? { ...prev, name: updated.name } : null);
    setRenamingId(null);
  };

  // ── Create folder ──────────────────────────────────────────────────────────
  const submitNewFolder = async () => {
    if (!accessToken || !newFolderName.trim()) return;
    const folder = await driveCreateFolder(newFolderName.trim(), currentFolder.id, accessToken);
    setFiles(prev => [folder, ...prev]);
    setNewFolderName('');
    setShowNewFolder(false);
  };

  const ic = (f: DriveFile) => mimeColor(f.mimeType);

  const usedPct = quota
    ? Math.min(100, Math.round((Number.parseInt(quota.usageInDrive) / Number.parseInt(quota.limit)) * 100))
    : 0;

  if (!accessToken) {
    return (
      <SignInScreen gsiReady={gsiReady} handleLogin={handleGoogleLogin} authError={authError} authLoading={authLoading} />
    );
  }

  // ── Main Drive UI ──────────────────────────────────────────────────────────
  return (
    <>

      <div className="min-h-screen bg-gray-50 flex flex-col">

        {/* ── Header ── */}
        <div className="sticky top-0 bg-white border-b border-gray-200 z-20 px-6 py-4">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Logo + title */}
            <div className="flex items-center gap-2 shrink-0">
              <svg viewBox="0 0 87.3 78" className="w-7 h-7">
                <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                <path d="M43.65 25L29.9 1.55C28.55.75 27 .35 25.45.35c-1.55 0-3.1.4-4.45 1.2L13.75 7.8l-13 22.55h27.25z" fill="#00ac47"/>
                <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H60.1L73.55 76.8z" fill="#ea4335"/>
                <path d="M43.65 25L57.4 1.55C56.05.75 54.5.35 52.95.35H34.35c-1.55 0-3.1.4-4.45 1.2z" fill="#00832d"/>
                <path d="M60.1 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.45 1.2h48.9c1.55 0 3.1-.4 4.45-1.2z" fill="#2684fc"/>
                <path d="M73.4 26.35l-13-22.55C59.6 2.2 58.45 1.1 57.1.3L43.65 25 60.1 53h27.2c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
              </svg>
              <h1 className="text-xl font-bold text-gray-900">My Drive</h1>
            </div>

            {/* Search */}
            <div className="flex-1 min-w-0 max-w-md">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <input
                  type="text" placeholder="Search in Drive…"
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Sort */}
              <select value={sortBy} onChange={e => setSortBy(e.target.value as 'name'|'modifiedTime'|'size')}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none">
                <option value="modifiedTime">Modified</option>
                <option value="name">Name</option>
                <option value="size">Size</option>
              </select>

              {/* View */}
              <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                <button onClick={() => setViewMode('grid')} className={`p-2 ${viewMode==='grid'?'bg-primary text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h7v7H3V3zm0 11h7v7H3v-7zm11-11h7v7h-7V3zm0 11h7v7h-7v-7z"/></svg>
                </button>
                <button onClick={() => setViewMode('list')} className={`p-2 ${viewMode==='list'?'bg-primary text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
                </button>
              </div>

              {/* New folder */}
              <button onClick={() => setShowNewFolder(true)}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                New folder
              </button>

              {/* Upload */}
              <button onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                Upload
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden"
                onChange={e => e.target.files && void handleUpload(e.target.files)} />

              {/* Sign out */}
              <button onClick={() => { handleGoogleLogout(); setFiles([]); setQuota(null); }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-red-500 border border-gray-200 rounded-lg hover:border-red-200 hover:bg-red-50 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                Sign out
              </button>
            </div>
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1 mt-3 text-sm">
            {breadcrumb.map((crumb, idx) => (
              <React.Fragment key={crumb.id}>
                {idx > 0 && <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>}
                <button
                  onClick={() => navigateTo(idx)}
                  className={`px-2 py-0.5 rounded transition-colors ${idx === breadcrumb.length - 1 ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* ── Left sidebar ── */}
          <aside className="w-52 shrink-0 bg-white border-r border-gray-200 flex flex-col py-5 px-3 gap-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">Drive</p>
            {[
              { label: 'My Drive', icon: '🗂' },
              { label: 'Shared', icon: '👥' },
              { label: 'Recent', icon: '🕐' },
              { label: 'Starred', icon: '⭐' },
              { label: 'Trash', icon: '🗑' },
            ].map(item => (
              <button key={item.label}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 w-full text-left transition-colors">
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}

            {quota && (
              <div className="mt-auto pt-5 px-3 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Storage</p>
                <div className="w-full bg-gray-200 rounded-full h-1.5 mb-1 overflow-hidden">
                  <div className={`h-1.5 rounded-full ${usedPct > 80 ? 'bg-red-500' : usedPct > 60 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                    style={{ width: `${usedPct}%` }} />
                </div>
                <p className="text-xs text-gray-500">
                  {formatSize(quota.usageInDrive)} <span className="text-gray-400">/ {formatSize(quota.limit)}</span>
                </p>
              </div>
            )}
          </aside>

          {/* ── Content ── */}
          <div className="flex-1 flex min-h-0">
            <section
              aria-label="File drop zone"
              className="flex-1 overflow-y-auto p-6 space-y-5"
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              {/* Drop overlay */}
              {isDragging && (
                <div className="fixed inset-0 bg-primary/10 border-4 border-dashed border-primary z-50 flex items-center justify-center pointer-events-none">
                  <div className="bg-white rounded-2xl px-10 py-8 text-center shadow-xl">
                    <p className="text-2xl mb-2">📤</p>
                    <p className="text-lg font-semibold text-primary">Drop to upload to Drive</p>
                    <p className="text-gray-400 text-sm mt-1">Files will be added to <strong>{currentFolder.name}</strong></p>
                  </div>
                </div>
              )}

              {/* Active uploads */}
              {uploads.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-gray-700">Uploading to Drive…</p>
                  {uploads.map(u => (
                    <div key={u.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                        {u.status === 'error' ? '✗' : u.status === 'done' ? '✓' : '↑'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 truncate">{u.name}</p>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                          <div className={`h-1.5 rounded-full transition-all duration-200 ${u.status === 'error' ? 'bg-red-500' : u.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`}
                            style={{ width: `${u.progress}%` }} />
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">{u.progress}%</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Loading */}
              {loading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-3">
                  <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-gray-400 text-sm">Loading files…</p>
                </div>
              ) : files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center text-3xl mb-4">📂</div>
                  <p className="text-gray-500 font-medium">This folder is empty</p>
                  <p className="text-gray-300 text-sm mt-1">Drop files here or click Upload to add files</p>
                </div>
              ) : viewMode === 'grid' ? (
                /* Grid */
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                  {files.map(f => (
                    <div key={f.id}
                      onClick={() => f.mimeType === FOLDER_MIME ? openFolder(f) : setSelectedFile(f)}
                      onContextMenu={e => { e.preventDefault(); setSelectedFile(f); }}
                      className={`relative bg-white border rounded-xl p-4 cursor-pointer hover:shadow-md transition-all group w-full text-left ${
                        selectedFile?.id === f.id ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      {f.starred && <span className="absolute top-2 right-2 text-yellow-400 text-xs">⭐</span>}
                      {f.thumbnailLink
                        ? <img src={f.thumbnailLink} alt={f.name} className="w-12 h-12 rounded-lg object-cover mx-auto mb-3" />
                        : (
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl mx-auto mb-3 ${ic(f).bg}`}>
                            {ic(f).label}
                          </div>
                        )}
                      {renamingId === f.id ? (
                        <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                          onBlur={submitRename}
                          onKeyDown={e => { if (e.key === 'Enter') { void submitRename(); } else if (e.key === 'Escape') { setRenamingId(null); } }}
                          onClick={e => e.stopPropagation()}
                          className="w-full text-xs border border-blue-400 rounded px-1 py-0.5 focus:outline-none text-center"
                        />
                      ) : (
                        <p className="text-xs font-medium text-gray-800 truncate text-center">{f.name}</p>
                      )}
                      <p className="text-xs text-gray-400 text-center mt-0r.5">{ago(f.modifiedTime)}</p>
                      <div className="absolute inset-x-2 bottom-2 flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={e => { e.stopPropagation(); setRenamingId(f.id); setRenameValue(f.name); }}
                          className="p-1 bg-white rounded shadow text-gray-500 hover:text-blue-600" title="Rename">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.415.586H9v-2.414a2 2 0 01.586-1.414z"/></svg>
                        </button>
                        {f.webViewLink && (
                          <a href={f.webViewLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                            className="p-1 bg-white rounded shadow text-gray-500 hover:text-blue-600" title="Open in Drive">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                          </a>
                        )}
                        <button onClick={e => { e.stopPropagation(); setDeleteConfirm(f); }}
                          className="p-1 bg-white rounded shadow text-gray-500 hover:text-red-600" title="Delete">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* List */
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wider">
                        <th className="px-4 py-3 text-left">Name</th>
                        <th className="px-4 py-3 text-left">Owner</th>
                        <th className="px-4 py-3 text-left">Modified</th>
                        <th className="px-4 py-3 text-right">Size</th>
                        <th className="px-4 py-3 w-24"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {files.map(f => (
                        <tr key={f.id}
                          onClick={() => f.mimeType === FOLDER_MIME ? openFolder(f) : setSelectedFile(f)}
                          className={`hover:bg-gray-50 cursor-pointer transition-colors ${selectedFile?.id === f.id ? 'bg-blue-50' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0 ${ic(f).bg}`}>
                                {ic(f).label}
                              </div>
                              {renamingId === f.id ? (
                                <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                                  onBlur={submitRename}
                                  onKeyDown={e => { if (e.key === 'Enter') { void submitRename(); } else if (e.key === 'Escape') { setRenamingId(null); } }}
                                  onClick={e => e.stopPropagation()}
                                  className="border border-blue-400 rounded px-2 py-0.5 focus:outline-none text-sm"
                                />
                              ) : (
                                <span className="font-medium text-gray-800 truncate max-w-xs">{f.name}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{f.owners?.[0]?.displayName ?? 'Me'}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{ago(f.modifiedTime)}</td>
                          <td className="px-4 py-3 text-right text-gray-500 text-xs">{formatSize(f.size)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={e => { e.stopPropagation(); setRenamingId(f.id); setRenameValue(f.name); }}
                                className="p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-blue-600" title="Rename">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.415.586H9v-2.414a2 2 0 01.586-1.414z"/></svg>
                              </button>
                              {f.webViewLink && (
                                <a href={f.webViewLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                                  className="p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-blue-600" title="Open">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                </a>
                              )}
                              <button onClick={e => { e.stopPropagation(); setDeleteConfirm(f); }}
                                className="p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-red-600" title="Delete">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── Detail panel ── */}
            {selectedFile && selectedFile.mimeType !== FOLDER_MIME && (
              <aside className="w-72 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-y-auto">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <p className="font-semibold text-gray-800 text-sm">File info</p>
                  <button onClick={() => setSelectedFile(null)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>

                {/* Preview */}
                <div className="p-5 border-b border-gray-100">
                  {selectedFile.thumbnailLink
                    ? <img src={selectedFile.thumbnailLink} alt={selectedFile.name} className="w-full h-36 object-cover rounded-xl" />
                    : (
                      <div className={`w-full h-36 rounded-xl flex items-center justify-center text-5xl ${ic(selectedFile).bg}`}>
                        {ic(selectedFile).label}
                      </div>
                    )}
                </div>

                {/* Meta */}
                <div className="p-5 space-y-4 flex-1">
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Name</p>
                    <p className="text-sm font-medium text-gray-800 break-all">{selectedFile.name}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Size</p><p className="text-sm text-gray-700">{formatSize(selectedFile.size)}</p></div>
                    <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Modified</p><p className="text-sm text-gray-700">{ago(selectedFile.modifiedTime)}</p></div>
                    <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Created</p><p className="text-sm text-gray-700">{ago(selectedFile.createdTime)}</p></div>
                    <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Owner</p><p className="text-sm text-gray-700">{selectedFile.owners?.[0]?.displayName ?? 'Me'}</p></div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Type</p>
                    <p className="text-sm text-gray-700 break-all">{selectedFile.mimeType}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-5 border-t border-gray-100 space-y-2">
                  {selectedFile.webViewLink && (
                    <a href={selectedFile.webViewLink} target="_blank" rel="noreferrer"
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                      Open in Drive
                    </a>
                  )}
                  {!selectedFile.mimeType.startsWith('application/vnd.google-apps') && (
                    <a href={`https://www.googleapis.com/drive/v3/files/${selectedFile.id}?alt=media&access_token=${accessToken}`}
                      target="_blank" rel="noreferrer" download={selectedFile.name}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                      Download
                    </a>
                  )}
                  <button onClick={() => setDeleteConfirm(selectedFile)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    Move to Trash
                  </button>
                </div>
              </aside>
            )}
          </div>
        </div>
      </div>

      {/* ── New Folder modal ── */}
      {showNewFolder && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-lg font-bold text-gray-900">New folder</h2>
            <input autoFocus type="text" placeholder="Folder name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { void submitNewFolder(); } else if (e.key === 'Escape') { setShowNewFolder(false); } }}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40"
            />
            <div className="flex gap-3">
              <button onClick={() => setShowNewFolder(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => void submitNewFolder()} className="flex-1 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm modal ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Move to Trash?</h2>
                <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{deleteConfirm.name}</p>
              </div>
            </div>
            <p className="text-sm text-gray-500">This will move the item to your Google Drive Trash. You can restore it from there.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => void confirmDelete()} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">Move to Trash</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
