'use client';

import React, { useState, useRef, useCallback } from 'react';

type FileItem = {
  id: string;
  name: string;
  type: 'pdf' | 'image' | 'doc' | 'spreadsheet' | 'video' | 'archive' | 'other';
  size: string;
  sizeBytes: number;
  folder: string;
  uploadedBy: string;
  uploadedAt: string;
  tags: string[];
};

const FILE_ICONS: Record<string, { bg: string; text: string; label: string }> = {
  pdf:         { bg: 'bg-red-100',    text: 'text-red-600',    label: 'PDF'  },
  image:       { bg: 'bg-purple-100', text: 'text-purple-600', label: 'IMG'  },
  doc:         { bg: 'bg-blue-100',   text: 'text-blue-600',   label: 'DOC'  },
  spreadsheet: { bg: 'bg-green-100',  text: 'text-green-600',  label: 'XLS'  },
  video:       { bg: 'bg-pink-100',   text: 'text-pink-600',   label: 'VID'  },
  archive:     { bg: 'bg-yellow-100', text: 'text-yellow-600', label: 'ZIP'  },
  other:       { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'FILE' },
};

function detectType(name: string): FileItem['type'] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return 'image';
  if (['doc','docx','txt','rtf'].includes(ext)) return 'doc';
  if (['xls','xlsx','csv'].includes(ext)) return 'spreadsheet';
  if (['mp4','mov','avi','mkv'].includes(ext)) return 'video';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return 'archive';
  return 'other';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const INITIAL_FILES: FileItem[] = [
  { id: 'F-001', name: 'Q1_Financial_Report_2026.pdf',    type: 'pdf',         size: '2.4 MB',  sizeBytes: 2516582,  folder: 'Finance',    uploadedBy: 'Reagan D.',  uploadedAt: 'Apr 20, 2026', tags: ['finance','quarterly'] },
  { id: 'F-002', name: 'Team_Photo_March.jpg',            type: 'image',       size: '5.1 MB',  sizeBytes: 5348864,  folder: 'Media',      uploadedBy: 'Alice M.',   uploadedAt: 'Apr 18, 2026', tags: ['team','photo'] },
  { id: 'F-003', name: 'Employee_Contract_Template.docx', type: 'doc',         size: '340 KB',  sizeBytes: 348160,   folder: 'HR',         uploadedBy: 'James K.',   uploadedAt: 'Apr 17, 2026', tags: ['hr','legal'] },
  { id: 'F-004', name: 'Inventory_Tracker_April.xlsx',    type: 'spreadsheet', size: '1.2 MB',  sizeBytes: 1258291,  folder: 'Operations', uploadedBy: 'Sandra O.',  uploadedAt: 'Apr 16, 2026', tags: ['inventory','ops'] },
  { id: 'F-005', name: 'Product_Demo_Video.mp4',          type: 'video',       size: '48.3 MB', sizeBytes: 50659328, folder: 'Media',      uploadedBy: 'Reagan D.',  uploadedAt: 'Apr 15, 2026', tags: ['demo','product'] },
  { id: 'F-006', name: 'Brand_Assets_Pack.zip',           type: 'archive',     size: '12.7 MB', sizeBytes: 13316915, folder: 'Design',     uploadedBy: 'Lisa T.',    uploadedAt: 'Apr 14, 2026', tags: ['brand','design'] },
  { id: 'F-007', name: 'Safety_Policy_2026.pdf',          type: 'pdf',         size: '890 KB',  sizeBytes: 911360,   folder: 'HR',         uploadedBy: 'James K.',   uploadedAt: 'Apr 13, 2026', tags: ['policy','safety'] },
  { id: 'F-008', name: 'Office_Blueprint.png',            type: 'image',       size: '3.6 MB',  sizeBytes: 3774873,  folder: 'Operations', uploadedBy: 'Sandra O.',  uploadedAt: 'Apr 12, 2026', tags: ['office','layout'] },
  { id: 'F-009', name: 'Sales_Projections_2026.xlsx',     type: 'spreadsheet', size: '760 KB',  sizeBytes: 778240,   folder: 'Finance',    uploadedBy: 'Tom R.',     uploadedAt: 'Apr 11, 2026', tags: ['sales','forecast'] },
  { id: 'F-010', name: 'Meeting_Notes_Apr.docx',          type: 'doc',         size: '120 KB',  sizeBytes: 122880,   folder: 'Operations', uploadedBy: 'Reagan D.',  uploadedAt: 'Apr 10, 2026', tags: ['meeting','notes'] },
  { id: 'F-011', name: 'Logo_Variations.zip',             type: 'archive',     size: '4.2 MB',  sizeBytes: 4404019,  folder: 'Design',     uploadedBy: 'Lisa T.',    uploadedAt: 'Apr 9, 2026',  tags: ['logo','brand'] },
  { id: 'F-012', name: 'Training_Handbook.pdf',           type: 'pdf',         size: '6.8 MB',  sizeBytes: 7130317,  folder: 'HR',         uploadedBy: 'James K.',   uploadedAt: 'Apr 8, 2026',  tags: ['training','hr'] },
];

const FOLDER_DEFS = [
  { id: 'All',        name: 'All Files'       },
  { id: 'Finance',    name: 'Finance'         },
  { id: 'HR',         name: 'Human Resources' },
  { id: 'Operations', name: 'Operations'      },
  { id: 'Design',     name: 'Design'          },
  { id: 'Media',      name: 'Media'           },
];

export default function FileUploadPage() {
  const [files, setFiles]                   = useState<FileItem[]>(INITIAL_FILES);
  const [selectedFolder, setSelectedFolder] = useState('All');
  const [searchQuery, setSearchQuery]       = useState('');
  const [viewMode, setViewMode]             = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy]                 = useState<'name' | 'date' | 'size'>('date');
  const [selectedFile, setSelectedFile]     = useState<FileItem | null>(null);
  const [isDragging, setIsDragging]         = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredFiles = files
    .filter(f => selectedFolder === 'All' || f.folder === selectedFolder)
    .filter(f => {
      const q = searchQuery.toLowerCase();
      return !q || f.name.toLowerCase().includes(q) || f.tags.some(t => t.includes(q)) || f.uploadedBy.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
      return b.uploadedAt.localeCompare(a.uploadedAt);
    });

  const totalSize = files.reduce((acc, f) => acc + f.sizeBytes, 0);

  const simulateUpload = useCallback((id: string) => {
    let pct = 0;
    const iv = setInterval(() => {
      pct += Math.random() * 25;
      if (pct >= 100) {
        pct = 100;
        clearInterval(iv);
        setTimeout(() => setUploadProgress(p => { const n = { ...p }; delete n[id]; return n; }), 800);
      }
      setUploadProgress(p => ({ ...p, [id]: Math.min(Math.round(pct), 100) }));
    }, 200);
  }, []);

  const handleFiles = useCallback((list: FileList) => {
    Array.from(list).forEach(file => {
      const id = `F-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setFiles(prev => [{
        id, name: file.name, type: detectType(file.name),
        size: formatBytes(file.size), sizeBytes: file.size,
        folder: selectedFolder === 'All' ? 'Operations' : selectedFolder,
        uploadedBy: 'You',
        uploadedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        tags: [],
      }, ...prev]);
      simulateUpload(id);
    });
  }, [selectedFolder, simulateUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const deleteSelected = () => {
    setFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
    if (selectedFile && selectedIds.has(selectedFile.id)) setSelectedFile(null);
    setSelectedIds(new Set());
  };

  const ic = (f: FileItem) => FILE_ICONS[f.type];

  return (
    <div className="min-h-screen bg-gray-50 flex">

      {/* ── Folder sidebar ── */}
      <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col py-6 px-3 gap-1">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">Folders</p>
        {FOLDER_DEFS.map(fd => {
          const count = fd.id === 'All' ? files.length : files.filter(f => f.folder === fd.id).length;
          const active = selectedFolder === fd.id;
          return (
            <button key={fd.id} onClick={() => setSelectedFolder(fd.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left ${
                active ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              <span className="flex-1 truncate">{fd.name}</span>
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
            </button>
          );
        })}
        <div className="mt-auto pt-6 px-3 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-1">Storage used</p>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mb-1">
            <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min((totalSize / (250 * 1048576)) * 100, 100).toFixed(0)}%` }} />
          </div>
          <p className="text-xs text-gray-500">{formatBytes(totalSize)} <span className="text-gray-400">/ 250 MB</span></p>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Toolbar */}
        <div className="sticky top-0 bg-white border-b border-gray-200 z-20 px-6 py-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">File Upload</h1>
              <p className="text-sm text-gray-500">
                {filteredFiles.length} file{filteredFiles.length !== 1 ? 's' : ''}{selectedFolder !== 'All' ? ` in ${selectedFolder}` : ''}
              </p>
            </div>
            <div className="flex-1 min-w-0">
              <div className="relative max-w-sm">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input type="text" placeholder="Search files, tags, people…"
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select value={sortBy} onChange={e => setSortBy(e.target.value as 'name'|'date'|'size')}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/40">
                <option value="date">Sort: Date</option>
                <option value="name">Sort: Name</option>
                <option value="size">Sort: Size</option>
              </select>
              <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                <button onClick={() => setViewMode('grid')} className={`p-2 ${viewMode==='grid'?'bg-primary text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h7v7H3V3zm0 11h7v7H3v-7zm11-11h7v7h-7V3zm0 11h7v7h-7v-7z"/></svg>
                </button>
                <button onClick={() => setViewMode('list')} className={`p-2 ${viewMode==='list'?'bg-primary text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
                </button>
              </div>
              {selectedIds.size > 0 && (
                <button onClick={deleteSelected} className="flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  Delete ({selectedIds.size})
                </button>
              )}
              <button onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                Upload
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
            </div>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all ${
                isDragging ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-gray-300 bg-white hover:border-primary/50 hover:bg-gray-50'
              }`}
            >
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${ isDragging ? 'bg-primary text-white' : 'bg-gray-100 text-gray-400' }`}>
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-700">{isDragging ? 'Release to upload' : 'Drag & drop files here'}</p>
                <p className="text-sm text-gray-400 mt-0.5">or <span className="text-primary underline underline-offset-2">browse files</span> from your computer</p>
              </div>
              <div className="flex gap-2 flex-wrap justify-center">
                {['PDF','DOC','XLS','PNG','JPG','ZIP','MP4'].map(ext => (
                  <span key={ext} className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded font-mono">.{ext.toLowerCase()}</span>
                ))}
              </div>
            </div>

            {/* Upload progress */}
            {Object.keys(uploadProgress).length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-700">Uploading…</p>
                {Object.entries(uploadProgress).map(([id, pct]) => {
                  const f = files.find(fi => fi.id === id);
                  if (!f) return null;
                  return (
                    <div key={id} className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${ic(f).bg} ${ic(f).text}`}>{ic(f).label}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 truncate">{f.name}</p>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                          <div className="bg-primary h-1.5 rounded-full transition-all duration-200" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Empty state */}
            {filteredFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <svg className="w-16 h-16 text-gray-200 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                </svg>
                <p className="text-gray-400 font-medium">No files found</p>
                <p className="text-gray-300 text-sm mt-1">Try a different folder or search term</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredFiles.map(f => (
                  <div key={f.id} onClick={() => setSelectedFile(f)}
                    className={`relative bg-white border rounded-xl p-4 cursor-pointer hover:shadow-md transition-all group ${
                      selectedFile?.id === f.id ? 'border-primary ring-2 ring-primary/20' : 'border-gray-200 hover:border-primary/40'
                    } ${selectedIds.has(f.id) ? 'ring-2 ring-secondary' : ''}`}>
                    <div onClick={e => { e.stopPropagation(); toggleSelect(f.id); }}
                      className={`absolute top-2 left-2 w-4 h-4 rounded border flex items-center justify-center cursor-pointer z-10 transition-opacity ${
                        selectedIds.has(f.id) ? 'opacity-100 bg-secondary border-secondary' : 'opacity-0 group-hover:opacity-100 bg-white border-gray-300'
                      }`}>
                      {selectedIds.has(f.id) && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                    </div>
                    {uploadProgress[f.id] !== undefined && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    )}
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold mx-auto mb-3 ${ic(f).bg} ${ic(f).text}`}>
                      {ic(f).label}
                    </div>
                    <p className="text-xs font-medium text-gray-800 truncate text-center">{f.name}</p>
                    <p className="text-xs text-gray-400 text-center mt-0.5">{f.size}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wider">
                      <th className="w-8 px-4 py-3">
                        <input type="checkbox" className="rounded"
                          onChange={e => setSelectedIds(e.target.checked ? new Set(filteredFiles.map(f => f.id)) : new Set())} />
                      </th>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Folder</th>
                      <th className="px-4 py-3 text-left">Uploaded by</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-right">Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredFiles.map(f => (
                      <tr key={f.id} onClick={() => setSelectedFile(f)}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${selectedFile?.id === f.id ? 'bg-primary/5' : ''}`}>
                        <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggleSelect(f.id); }}>
                          <input type="checkbox" checked={selectedIds.has(f.id)} onChange={() => toggleSelect(f.id)} className="rounded" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${ic(f).bg} ${ic(f).text}`}>{ic(f).label}</div>
                            <span className="font-medium text-gray-800 truncate max-w-48">{f.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{f.folder}</td>
                        <td className="px-4 py-3 text-gray-500">{f.uploadedBy}</td>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{f.uploadedAt}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{f.size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Detail panel ── */}
          {selectedFile && (
            <aside className="w-72 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-y-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <p className="font-semibold text-gray-800 text-sm">File Details</p>
                <button onClick={() => setSelectedFile(null)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
              <div className="p-5 border-b border-gray-100">
                <div className={`w-full h-32 rounded-xl flex items-center justify-center text-3xl font-bold ${ic(selectedFile).bg} ${ic(selectedFile).text}`}>
                  {ic(selectedFile).label}
                </div>
              </div>
              <div className="p-5 space-y-4 flex-1">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">File name</p>
                  <p className="text-sm font-medium text-gray-800 break-all">{selectedFile.name}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Size</p><p className="text-sm text-gray-700">{selectedFile.size}</p></div>
                  <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Type</p><p className="text-sm text-gray-700 capitalize">{selectedFile.type}</p></div>
                  <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Folder</p><p className="text-sm text-gray-700">{selectedFile.folder}</p></div>
                  <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Uploaded</p><p className="text-sm text-gray-700">{selectedFile.uploadedAt}</p></div>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Uploaded by</p>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold">{selectedFile.uploadedBy.charAt(0)}</div>
                    <p className="text-sm text-gray-700">{selectedFile.uploadedBy}</p>
                  </div>
                </div>
                {selectedFile.tags.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Tags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedFile.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="p-5 border-t border-gray-100 space-y-2">
                <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Download
                </button>
                <button
                  onClick={() => { setFiles(prev => prev.filter(f => f.id !== selectedFile.id)); setSelectedFile(null); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  Delete
                </button>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
