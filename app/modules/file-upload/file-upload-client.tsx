'use client';

import { useMemo, useRef, useState } from 'react';

// --- Types (mirror lib/files.ts) ---
type ShareTarget = { id: number; name: string };

type StoredFile = {
  id: number;
  name: string;
  description: string | null;
  tags: string[];
  mimeType: string;
  size: number;
  uploadedBy: { id: number; name: string };
  isOwner: boolean;
  sharedWith: ShareTarget[];
  createdAt: string;
};

type Stats = { total: number; totalSize: number; images: number; documents: number; sharedWithMe: number };
type Viewer = { id: number; name: string };
type TypeFilter = 'All' | 'My Files' | 'Shared' | 'Images';

type Props = {
  viewer: Viewer;
  initialItems: StoredFile[];
  initialStats: Stats;
  shareableUsers: ShareTarget[];
};

const FILTER_OPTIONS: TypeFilter[] = ['All', 'My Files', 'Shared', 'Images'];

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fileCategory(mime: string): 'image' | 'document' | 'other' {
  if (mime.startsWith('image/')) return 'image';
  if (
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('spreadsheet') ||
    mime.includes('presentation') ||
    mime.includes('document')
  ) {
    return 'document';
  }
  return 'other';
}

function matchesFilter(file: StoredFile, filter: TypeFilter) {
  if (filter === 'All') return true;
  if (filter === 'My Files') return file.isOwner;
  if (filter === 'Shared') return !file.isOwner;
  return fileCategory(file.mimeType) === 'image';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function FileIcon({ mime, className }: { mime: string; className?: string }) {
  const cat = fileCategory(mime);
  const color = cat === 'image' ? 'text-purple-500' : cat === 'document' ? 'text-blue-500' : 'text-gray-400';
  return (
    <svg className={`${className ?? 'w-8 h-8'} ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {mime === 'application/pdf' ? (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      ) : cat === 'image' ? (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      )}
    </svg>
  );
}

export default function FileUploadClient({ viewer, initialItems, initialStats, shareableUsers }: Props) {
  const [items, setItems] = useState<StoredFile[]>(initialItems);
  const [stats, setStats] = useState<Stats>(initialStats);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<TypeFilter>('All');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Rename
  const [renameDraft, setRenameDraft] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Tags
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');

  // Share modal
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState('');
  const [shareSelection, setShareSelection] = useState<number[]>([]);
  const [sharing, setSharing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => items.find((f) => f.id === selectedId) ?? null, [items, selectedId]);

  // Every tag in use, deduped case-insensitively (first casing wins), sorted.
  const allTags = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const file of items) {
      for (const tag of file.tags) {
        const key = tag.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, tag);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // A tag that no longer exists (last file with it was deleted) simply stops
  // filtering; no state correction needed.
  const currentTag =
    activeTag && allTags.some((t) => t.toLowerCase() === activeTag.toLowerCase())
      ? activeTag
      : null;

  const reload = async () => {
    try {
      const res = await fetch('/api/files', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: StoredFile[]; stats?: Stats };
      if (data.items) setItems(data.items);
      if (data.stats) setStats(data.stats);
    } catch {
      // ignore
    }
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      Array.from(fileList).forEach((f) => fd.append('files', f));
      const res = await fetch('/api/files', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setUploadError(data?.error ?? 'Upload failed.');
        return;
      }
      await reload();
    } catch {
      setUploadError('Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleRename = async () => {
    if (!selected || busy) return;
    const name = renameDraft.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/files/${selected.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await reload();
        setIsRenaming(false);
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || busy) return;
    if (!window.confirm(`Delete "${selected.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/files/${selected.id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setSelectedId(null);
        await reload();
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    if (!selected || sharing || shareSelection.length === 0) return;
    setSharing(true);
    try {
      const res = await fetch(`/api/files/${selected.id}/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: shareSelection }),
      });
      if (res.ok) {
        await reload();
        setIsShareOpen(false);
        setShareSelection([]);
        setShareSearch('');
      }
    } catch {
      // ignore
    } finally {
      setSharing(false);
    }
  };

  const handleUnshare = async (userId: number) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/files/${selected.id}/share`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) await reload();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const toggleShareSelection = (id: number) => {
    setShareSelection((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleUpdateTags = async (next: string[]) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/files/${selected.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: next }),
      });
      if (res.ok) await reload();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const handleAddTags = async () => {
    if (!selected) return;
    const additions = tagDraft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (additions.length === 0) return;
    setTagDraft('');
    await handleUpdateTags([...selected.tags, ...additions]);
  };

  const handleRemoveTag = async (tag: string) => {
    if (!selected) return;
    await handleUpdateTags(selected.tags.filter((t) => t !== tag));
  };

  const search = searchQuery.toLowerCase();
  const filtered = items.filter(
    (f) =>
      (f.name.toLowerCase().includes(search) || f.tags.some((t) => t.toLowerCase().includes(search))) &&
      matchesFilter(f, activeFilter) &&
      (!currentTag || f.tags.some((t) => t.toLowerCase() === currentTag.toLowerCase())),
  );

  const sharedWithIds = new Set(selected?.sharedWith.map((s) => s.id) ?? []);
  const availableToShare = shareableUsers.filter(
    (u) =>
      !sharedWithIds.has(u.id) &&
      u.name.toLowerCase().includes(shareSearch.toLowerCase()),
  );

  const statCards = [
    { label: 'Total Files', value: String(stats.total), color: 'text-gray-900' },
    { label: 'Storage Used', value: formatBytes(stats.totalSize), color: 'text-emerald-600' },
    { label: 'Shared With Me', value: String(stats.sharedWithMe), color: 'text-blue-600' },
    { label: 'Images', value: String(stats.images), color: 'text-purple-600' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">My Files</h1>
            <p className="text-gray-500 mt-1 font-medium">Your private uploads and files shared with you</p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {uploading ? 'Uploading...' : 'Upload Files'}
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {statCards.map((stat, i) => (
            <div key={i} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
              <p className={`text-2xl font-black ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`mb-8 cursor-pointer rounded-[2rem] border-2 border-dashed p-10 text-center transition-all ${
            dragOver ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white hover:border-emerald-300'
          }`}
        >
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-emerald-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <p className="text-sm font-bold text-gray-700">{dragOver ? 'Drop files to upload' : 'Drag & drop files here, or click to browse'}</p>
          <p className="text-xs text-gray-400 mt-1 font-medium">Up to 25 MB per file • Private to you until you share</p>
          {uploadError && <p className="text-xs font-bold text-rose-500 mt-3">{uploadError}</p>}
        </div>

        {/* Toolbar */}
        <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm mb-8 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search files by name or tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  activeFilter === f ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-8 -mt-4">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mr-1">Tags</span>
            {allTags.map((tag) => {
              const active = currentTag?.toLowerCase() === tag.toLowerCase();
              return (
                <button
                  key={tag.toLowerCase()}
                  onClick={() => setActiveTag(active ? null : tag)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                    active
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-emerald-300 hover:text-emerald-700'
                  }`}
                >
                  #{tag}
                </button>
              );
            })}
            {currentTag && (
              <button onClick={() => setActiveTag(null)} className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 ml-1">
                Clear
              </button>
            )}
          </div>
        )}

        {/* File Grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-[3rem] border border-dashed border-gray-200">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">{items.length === 0 ? 'No files yet' : 'No matching files'}</h3>
            <p className="text-gray-500 mt-1">{items.length === 0 ? 'Upload your first file to get started.' : 'Try a different search or filter.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map((file) => (
              <button
                key={file.id}
                onClick={() => setSelectedId(file.id)}
                className="group bg-white rounded-[2rem] border border-gray-100 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/5 transition-all duration-300 text-left overflow-hidden"
              >
                <div className="h-32 bg-gray-50 flex items-center justify-center overflow-hidden border-b border-gray-50 relative">
                  {fileCategory(file.mimeType) === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${file.id}`} alt={file.name} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <FileIcon mime={file.mimeType} className="w-12 h-12" />
                  )}
                  {!file.isOwner ? (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-blue-100 text-blue-700">Shared</span>
                  ) : file.sharedWith.length > 0 ? (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700">
                      Shared · {file.sharedWith.length}
                    </span>
                  ) : null}
                </div>
                <div className="p-4">
                  <p className="text-sm font-bold text-gray-900 truncate group-hover:text-emerald-700 transition-colors" title={file.name}>
                    {file.name}
                  </p>
                  {file.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {file.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-50 text-emerald-700 truncate max-w-24">
                          #{tag}
                        </span>
                      ))}
                      {file.tags.length > 3 && (
                        <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-gray-50 text-gray-400">+{file.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] font-bold text-gray-400">{formatBytes(file.size)}</span>
                    <span className="text-[10px] font-medium text-gray-400">{formatDate(file.createdAt)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail / Preview Drawer */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-[220]" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-[230] overflow-y-auto animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="p-6 flex items-center justify-between border-b border-gray-50">
              <h2 className="text-lg font-black text-gray-900">File Details</h2>
              <button onClick={() => setSelectedId(null)} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 flex-1 space-y-6">
              {/* Preview */}
              <div className="rounded-[2rem] bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center min-h-48">
                {fileCategory(selected.mimeType) === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${selected.id}`} alt={selected.name} className="w-full max-h-72 object-contain" />
                ) : (
                  <div className="py-12 flex flex-col items-center">
                    <FileIcon mime={selected.mimeType} className="w-16 h-16" />
                    <span className="mt-3 text-[10px] font-black uppercase tracking-widest text-gray-400">{selected.mimeType}</span>
                  </div>
                )}
              </div>

              {/* Name / rename */}
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 block">File Name</label>
                {isRenaming ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleRename();
                        }
                      }}
                      className="flex-1 px-3 py-2 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                    />
                    <button onClick={handleRename} disabled={busy} className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase disabled:opacity-60">
                      Save
                    </button>
                    <button onClick={() => setIsRenaming(false)} className="px-2 py-2 text-gray-400 text-xs font-black uppercase">
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900 break-all">{selected.name}</p>
                    {selected.isOwner && (
                      <button
                        onClick={() => {
                          setRenameDraft(selected.name);
                          setIsRenaming(true);
                        }}
                        className="shrink-0 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-emerald-600"
                      >
                        Rename
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Size</label>
                  <p className="text-sm font-bold text-gray-900">{formatBytes(selected.size)}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Uploaded</label>
                  <p className="text-sm font-bold text-gray-900">{formatDate(selected.createdAt)}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 col-span-2">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">
                    {selected.isOwner ? 'Owner' : 'Shared By'}
                  </label>
                  <p className="text-sm font-bold text-gray-900">
                    {selected.uploadedBy.id === viewer.id ? 'You' : selected.uploadedBy.name}
                  </p>
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3 block">Tags</label>
                {selected.tags.length === 0 && !selected.isOwner ? (
                  <p className="text-xs font-medium text-gray-400">No tags.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selected.tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 bg-emerald-50 border border-emerald-100 rounded-full">
                        <span className="text-xs font-bold text-emerald-700">#{tag}</span>
                        {selected.isOwner ? (
                          <button
                            onClick={() => void handleRemoveTag(tag)}
                            disabled={busy}
                            className="w-5 h-5 rounded-full text-emerald-400 hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center disabled:opacity-60"
                            aria-label={`Remove tag ${tag}`}
                          >
                            ✕
                          </button>
                        ) : (
                          <span className="w-1" />
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {selected.isOwner && (
                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="text"
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleAddTags();
                        }
                      }}
                      placeholder="Add tags (comma-separated)…"
                      className="flex-1 px-3 py-2 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    />
                    <button
                      onClick={() => void handleAddTags()}
                      disabled={busy || !tagDraft.trim()}
                      className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase disabled:opacity-60"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              {/* Sharing (owner only) */}
              {selected.isOwner && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Shared With</label>
                    <button
                      onClick={() => {
                        setIsShareOpen(true);
                        setShareSelection([]);
                        setShareSearch('');
                      }}
                      className="text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700"
                    >
                      + Share
                    </button>
                  </div>
                  {selected.sharedWith.length === 0 ? (
                    <p className="text-xs font-medium text-gray-400">Not shared with anyone yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {selected.sharedWith.map((u) => (
                        <span key={u.id} className="inline-flex items-center gap-2 pl-2 pr-1 py-1 bg-gray-50 border border-gray-100 rounded-full">
                          <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[8px] font-black flex items-center justify-center">{initials(u.name)}</span>
                          <span className="text-xs font-bold text-gray-700">{u.name}</span>
                          <button onClick={() => handleUnshare(u.id)} disabled={busy} className="w-5 h-5 rounded-full text-gray-400 hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center disabled:opacity-60">
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-6 pt-4 bg-white border-t border-gray-50 sticky bottom-0 flex flex-col gap-3">
              <div className="flex gap-3">
                <a
                  href={`/api/files/${selected.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-3 bg-gray-900 text-white rounded-2xl font-bold text-sm text-center hover:bg-black transition-all"
                >
                  View
                </a>
                <a
                  href={`/api/files/${selected.id}?download=1`}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm text-center hover:bg-emerald-700 transition-all"
                >
                  Download
                </a>
              </div>
              {selected.isOwner && (
                <button onClick={handleDelete} disabled={busy} className="w-full py-2.5 text-rose-400 font-bold text-sm hover:text-rose-600 transition-all disabled:opacity-60">
                  Delete File
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Share Modal */}
      {isShareOpen && selected && (
        <>
          <button type="button" className="fixed inset-0 z-[300] bg-gray-900/30 backdrop-blur-sm" onClick={() => setIsShareOpen(false)} aria-label="Close" />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[310] w-full max-w-md bg-white rounded-[2rem] shadow-2xl overflow-hidden">
            <div className="p-6 pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-gray-900">Share File</h2>
                <p className="text-xs text-gray-400 font-medium truncate max-w-[18rem]">{selected.name}</p>
              </div>
              <button onClick={() => setIsShareOpen(false)} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 pb-6">
              <input
                type="text"
                autoFocus
                placeholder="Search people..."
                value={shareSearch}
                onChange={(e) => setShareSearch(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium mb-3"
              />
              <div className="max-h-64 overflow-y-auto space-y-1">
                {availableToShare.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No users available.</p>
                ) : (
                  availableToShare.map((u) => {
                    const checked = shareSelection.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        onClick={() => toggleShareSelection(u.id)}
                        className={`w-full flex items-center gap-3 p-2 rounded-xl transition-colors text-left ${checked ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
                      >
                        <span className="w-8 h-8 rounded-full bg-emerald-500 text-white text-[10px] font-black flex items-center justify-center">{initials(u.name)}</span>
                        <span className="flex-1 text-sm font-bold text-gray-900 truncate">{u.name}</span>
                        <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${checked ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                          {checked && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <button
                onClick={handleShare}
                disabled={sharing || shareSelection.length === 0}
                className="w-full mt-4 py-3.5 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-60"
              >
                {sharing ? 'Sharing...' : shareSelection.length > 0 ? `Share with ${shareSelection.length}` : 'Select people to share'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
