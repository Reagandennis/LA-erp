'use client';

import React, {
  useState, useRef, useEffect, useCallback, useTransition,
} from 'react';
import { useGoogleAuth } from '@/app/ui/GoogleAuthProvider';

/* ─── Types ─────────────────────────────────────────────────────────────── */

type ConvType = 'DIRECT' | 'GROUP';

interface ConvMember { id: number; name: string }

interface LastMessage {
  body: string;
  senderName: string;
  createdAt: string;
}

interface Conversation {
  id: number;
  type: ConvType;
  name: string | null;
  members: ConvMember[];
  lastMessage: LastMessage | null;
  unreadCount: number;
  updatedAt: string;
}

interface Attachment {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  driveUrl?: string | null;
  driveFileId?: string | null;
}

interface Reaction { id: number; userId: number; emoji: string }

interface Message {
  id: number;
  conversationId: number;
  senderId: number;
  body: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  sender: { id: number; name: string };
  attachments: Attachment[];
  reactions: Reaction[];
}

interface SessionUser { id: number; name: string; email: string }

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  webViewLink: string;
}

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function avatarColor(name: string) {
  const palette = [
    'bg-blue-500', 'bg-emerald-500', 'bg-purple-500',
    'bg-orange-500', 'bg-pink-500', 'bg-indigo-500',
  ];
  let h = 0;
  for (const ch of name) h = (ch.codePointAt(0) ?? 0) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function convDisplayName(conv: Conversation, me: SessionUser): string {
  if (conv.type === 'GROUP') return conv.name ?? 'Group';
  const other = conv.members.find((m) => m.id !== me.id);
  return other?.name ?? 'Unknown';
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ─── Sub-components ────────────────────────────────────────────────────── */

function Avatar({ name, size = 10 }: Readonly<{ name: string; size?: number }>) {
  return (
    <div
      className={`w-${size} h-${size} rounded-full flex items-center justify-center text-white font-bold shrink-0 ${avatarColor(name)}`}
      style={{ fontSize: size <= 8 ? 10 : 14 }}
    >
      {initials(name)}
    </div>
  );
}

function AttachmentChip({ att }: Readonly<{ att: Attachment }>) {
  const href = att.driveUrl ?? `/api/chat/attachments/${att.id}`;
  const isPdf = att.mimeType === 'application/pdf' || att.filename.endsWith('.pdf');
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="mt-2 flex items-center gap-3 p-2 rounded-lg bg-black/10 hover:bg-black/20 transition-colors">
      <div className={`w-9 h-9 rounded flex items-center justify-center shrink-0 ${isPdf ? 'bg-red-500' : 'bg-blue-500'}`}>
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{att.filename}</p>
        <p className="text-[10px] opacity-60">{fmtSize(att.size)}{att.driveUrl ? ' · Google Drive' : ''}</p>
      </div>
    </a>
  );
}
/* ─── Shared utilities ─────────────────────────────────────────────────────── */

function makeToggler<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>) {
  return (id: T) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    return next;
  });
}
/* ─── Drive picker ───────────────────────────────────────────────────────── */

function DrivePicker({ onSelect, onClose }: Readonly<{
  onSelect: (files: DriveFile[]) => void;
  onClose: () => void;
}>) {
  const { token: savedToken, login: handleGoogleLogin, loading: authLoading } = useGoogleAuth();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!savedToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(
      'https://www.googleapis.com/drive/v3/files?pageSize=30&fields=files(id,name,mimeType,size,webViewLink)&orderBy=modifiedTime desc',
      { headers: { Authorization: `Bearer ${savedToken}` } },
    )
      .then((r) => r.json())
      .then((data: { files: DriveFile[]; error?: { message: string } }) => {
        if (data.error) throw new Error(data.error.message);
        setFiles(data.files ?? []);
        setError('');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [savedToken]);

  const toggle = makeToggler(setSelected);

  const confirm = () => { onSelect(files.filter((f) => selected.has(f.id))); onClose(); };

  return (
    <div className="absolute bottom-16 left-0 right-0 mx-4 rounded-2xl bg-white shadow-2xl border border-gray-200 z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-900">📁 Google Drive — Recent files</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
      </div>
      <div className="max-h-60 overflow-y-auto custom-scrollbar">
        {!savedToken ? (
          <div className="p-6 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-gray-500 text-center">Sign in to Google to attach files from your Drive.</p>
            <button
              onClick={handleGoogleLogin}
              disabled={authLoading}
              className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {authLoading ? 'Connecting…' : 'Sign in to Google'}
            </button>
          </div>
        ) : (
          <>
            {loading && <p className="p-4 text-sm text-gray-500 text-center">Loading…</p>}
            {error && <p className="p-4 text-sm text-red-500 text-center">{error}</p>}
            {!loading && !error && files.map((f) => (
              <label key={f.id} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)}
                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                <span className="flex-1 text-sm text-gray-800 truncate">{f.name}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{fmtSize(Number(f.size ?? 0))}</span>
              </label>
            ))}
            {!loading && !error && files.length === 0 && (
              <p className="p-4 text-sm text-gray-500 text-center">No files found.</p>
            )}
          </>
        )}
      </div>
      {selected.size > 0 && (
        <div className="p-3 border-t border-gray-100">
          <button onClick={confirm}
            className="w-full py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
            Attach {selected.size} file{selected.size === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── New conversation modal ─────────────────────────────────────────────── */

function NewConvModal({ users, me, onClose, onCreate }: Readonly<{
  users: ConvMember[];
  me: SessionUser;
  onClose: () => void;
  onCreate: (convId: number) => void;
}>) {
  const [type, setType] = useState<ConvType>('DIRECT');
  const [groupName, setGroupName] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [, startT] = useTransition();

  const others = users.filter((u) => u.id !== me.id);

  const toggle = makeToggler(setSelected);

  const submit = () => {
    if (selected.size === 0) return;
    startT(async () => {
      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name: type === 'GROUP' ? groupName : undefined, memberIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('Failed to create conversation:', res.status, err);
        return;
      }
      const data = (await res.json()) as { id: number };
      onCreate(data.id);
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">New Conversation</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex gap-2">
            {(['DIRECT', 'GROUP'] as ConvType[]).map((t) => (
              <button key={t} onClick={() => setType(t)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${type === t ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {t === 'DIRECT' ? 'Direct Message' : 'Group Chat'}
              </button>
            ))}
          </div>
          {type === 'GROUP' && (
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name…"
              className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
          )}
          <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar">
            {others.map((u) => (
              <label key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)}
                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                <Avatar name={u.name} size={8} />
                <span className="text-sm font-medium text-gray-800">{u.name}</span>
              </label>
            ))}
          </div>
          <button onClick={submit} disabled={selected.size === 0}
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${selected.size > 0 ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
            Start Conversation
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function CommunicationPage() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [allUsers, setAllUsers] = useState<ConvMember[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingDriveFiles, setPendingDriveFiles] = useState<DriveFile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'DIRECT' | 'GROUP'>('all');
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [showNewConv, setShowNewConv] = useState(false);
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Load session + users ──────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d: { user?: SessionUser }) => { if (d.user) setMe(d.user); });
    fetch('/api/users/mentions')
      .then((r) => r.json())
      .then((d: { users?: ConvMember[] }) => setAllUsers(d.users ?? []));
  }, []);

  // ── Load conversations ────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    const res = await fetch('/api/chat/conversations', { credentials: 'include' });
    if (!res.ok) return;
    const data = (await res.json()) as Conversation[];
    setConversations(data);
    if (data.length > 0) setActiveConvId((prev) => prev ?? data[0].id);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (me) void loadConversations(); }, [me, loadConversations]);

  // ── Load messages ─────────────────────────────────────────────────────────
  const clearUnreadForConv = useCallback((id: number) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
  }, []);

  const loadMessages = useCallback(async (convId: number, cursor?: number) => {
    const url = cursor
      ? `/api/chat/conversations/${convId}/messages?cursor=${cursor}`
      : `/api/chat/conversations/${convId}/messages`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return { messages: [], nextCursor: null };
    return (await res.json()) as { messages: Message[]; nextCursor: number | null };
  }, []);

  useEffect(() => {
    if (!activeConvId) return;
    void loadMessages(activeConvId).then(({ messages: msgs, nextCursor: nc }) => {
      setMessages(msgs);
      setNextCursor(nc);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 50);
    });
    void fetch(`/api/chat/conversations/${activeConvId}/read`, { method: 'POST' });
    queueMicrotask(() => clearUnreadForConv(activeConvId));
  }, [activeConvId, loadMessages, clearUnreadForConv]);

  // ── Infinite scroll upward ────────────────────────────────────────────────
  const handleScroll = useCallback(async () => {
    const el = scrollContainerRef.current;
    if (!el || !nextCursor || loadingMore || !activeConvId) return;
    if (el.scrollTop > 80) return;
    setLoadingMore(true);
    const prevH = el.scrollHeight;
    const { messages: older, nextCursor: nc } = await loadMessages(activeConvId, nextCursor);
    setMessages((prev) => [...older, ...prev]);
    setNextCursor(nc);
    setLoadingMore(false);
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prevH; });
  }, [nextCursor, loadingMore, activeConvId, loadMessages]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // ── SSE real-time events ──────────────────────────────────────────────────
  const handleSseMessage = useCallback((e: MessageEvent) => {
    const { conversationId, message } = JSON.parse(e.data as string) as {
      conversationId: number; message: Message;
    };
    setActiveConvId((curId) => {
      if (conversationId === curId) {
        setMessages((prev) => [...prev, message]);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
      return curId;
    });
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== conversationId) return c;
        return {
          ...c,
          lastMessage: { body: message.body, senderName: message.sender.name, createdAt: message.createdAt },
          unreadCount: c.id === conversationId ? 0 : c.unreadCount + 1,
          updatedAt: message.createdAt,
        };
      }),
    );
  }, []);

  const handleSseUpdated = useCallback((e: MessageEvent) => {
    const { message } = JSON.parse(e.data as string) as { message: Message };
    setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
  }, []);

  const handleSseDeleted = useCallback((e: MessageEvent) => {
    const { messageId } = JSON.parse(e.data as string) as { messageId: number };
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, deletedAt: new Date().toISOString() } : m)),
    );
  }, []);

  useEffect(() => {
    if (!me) return;
    let es: EventSource;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      es = new EventSource('/api/chat/stream');
      es.addEventListener('message', handleSseMessage);
      es.addEventListener('message_updated', handleSseUpdated);
      es.addEventListener('message_deleted', handleSseDeleted);
      es.onerror = () => { es.close(); retry = setTimeout(connect, 3000); };
    };

    connect();
    return () => { es.close(); clearTimeout(retry); };
  }, [me, handleSseMessage, handleSseUpdated, handleSseDeleted]);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!activeConvId || sending) return;
    if (!messageInput.trim() && pendingFiles.length === 0 && pendingDriveFiles.length === 0) return;
    setSending(true);
    const form = new FormData();
    form.append('body', messageInput);
    for (const f of pendingFiles) form.append('files', f);
    if (pendingDriveFiles.length > 0) {
      form.append('driveFiles', JSON.stringify(
        pendingDriveFiles.map((f) => ({
          name: f.name, mimeType: f.mimeType, size: f.size, url: f.webViewLink, fileId: f.id,
        })),
      ));
    }
    await fetch(`/api/chat/conversations/${activeConvId}/messages`, { method: 'POST', body: form });
    setMessageInput('');
    setPendingFiles([]);
    setPendingDriveFiles([]);
    setSending(false);
  };

  const removePendingFile = useCallback((f: File) => {
    setPendingFiles((p) => p.filter((pf) => pf !== f));
  }, []);

  const removePendingDriveFile = useCallback((id: string) => {
    setPendingDriveFiles((p) => p.filter((d) => d.id !== id));
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
  const filtered = conversations.filter((c) => {
    const name = me ? convDisplayName(c, me) : (c.name ?? '');
    return (
      name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      (filter === 'all' || c.type === filter)
    );
  });

  if (!me) {
    return <div className="flex h-screen items-center justify-center text-gray-500">Loading…</div>;
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {showNewConv && (
        <NewConvModal users={allUsers} me={me}
          onClose={() => setShowNewConv(false)}
          onCreate={(id) => { loadConversations(); setActiveConvId(id); }} />
      )}

      {/* ── Left pane ─────────────────────────────────────────────────── */}
      <div className="w-80 lg:w-96 flex flex-col border-r border-gray-200 bg-white">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900">Messages</h1>
            <button onClick={() => setShowNewConv(true)} title="New conversation"
              className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
          <div className="relative mb-4">
            <span className="absolute inset-y-0 left-3 flex items-center text-gray-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input type="text" placeholder="Search…" value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 border-none" />
          </div>
          <div className="flex p-1 bg-gray-100 rounded-lg">
            {(['all', 'DIRECT', 'GROUP'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${filter === f ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {f === 'all' ? 'All' : f === 'DIRECT' ? 'Direct' : 'Groups'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filtered.map((conv) => {
            const name = convDisplayName(conv, me);
            return (
              <button key={conv.id} onClick={() => setActiveConvId(conv.id)}
                className={`w-full p-4 flex items-center gap-3 border-b border-gray-50 hover:bg-gray-50 transition-colors text-left ${activeConvId === conv.id ? 'bg-emerald-50 border-l-4 border-l-emerald-600' : ''}`}>
                <Avatar name={name} size={12} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <h3 className="text-sm font-semibold truncate text-gray-900">{name}</h3>
                    {conv.lastMessage && (
                      <span className="text-[10px] text-gray-400 shrink-0">{fmtTime(conv.lastMessage.createdAt)}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500 truncate">
                      {conv.lastMessage
                        ? `${conv.lastMessage.senderName}: ${conv.lastMessage.body}`
                        : 'No messages yet'}
                    </p>
                    {conv.unreadCount > 0 && (
                      <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-4.5 text-center shrink-0 ml-2">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="p-6 text-sm text-center text-gray-400">No conversations yet.</p>
          )}
        </div>
      </div>

      {/* ── Center pane ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-white relative">
        {activeConv ? (
          <>
            <div className="h-17 px-5 border-b border-gray-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Avatar name={convDisplayName(activeConv, me)} size={10} />
                <div>
                  <h2 className="text-base font-bold text-gray-900 leading-tight">
                    {convDisplayName(activeConv, me)}
                  </h2>
                  <p className="text-xs text-emerald-600 font-medium">
                    {activeConv.type === 'GROUP' ? `${activeConv.members.length} members` : 'Direct Message'}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsDetailsOpen((v) => !v)}
                className={`p-2 rounded-full transition-colors ${isDetailsOpen ? 'bg-emerald-50 text-emerald-600' : 'hover:bg-gray-100 text-gray-400'}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>

            <div ref={scrollContainerRef}
              className="flex-1 overflow-y-auto p-5 space-y-4 bg-gray-50/50 custom-scrollbar">
              {loadingMore && (
                <p className="text-center text-xs text-gray-400 py-2">Loading older messages…</p>
              )}
              {nextCursor && !loadingMore && (
                <button onClick={async () => {
                  if (!activeConvId) return;
                  setLoadingMore(true);
                  const el = scrollContainerRef.current;
                  const prevH = el?.scrollHeight ?? 0;
                  const { messages: older, nextCursor: nc } = await loadMessages(activeConvId, nextCursor);
                  setMessages((prev) => [...older, ...prev]);
                  setNextCursor(nc);
                  setLoadingMore(false);
                  if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prevH; });
                }} className="w-full text-xs text-emerald-600 font-semibold py-1 hover:underline">
                  Load older messages ↑
                </button>
              )}

              {messages.map((msg) => {
                const isMe = msg.senderId === me.id;
                const isGroup = activeConv.type === 'GROUP';
                const deleted = !!msg.deletedAt;
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex items-end gap-2 max-w-[80%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                      {!isMe && <Avatar name={msg.sender.name} size={8} />}
                      <div className="flex flex-col">
                        {isGroup && !isMe && (
                          <span className="text-[10px] font-semibold text-gray-500 mb-1 ml-1">{msg.sender.name}</span>
                        )}
                        <div className={`px-4 py-2.5 rounded-2xl text-sm shadow-sm ${isMe ? 'bg-emerald-600 text-white rounded-br-none' : 'bg-white text-gray-900 border border-gray-100 rounded-bl-none'}`}>
                          {deleted ? (
                            <p className="italic opacity-50">Message deleted</p>
                          ) : (
                            <>
                              <p className="whitespace-pre-wrap wrap-break-word">{msg.body}</p>
                              {msg.attachments.map((a) => <AttachmentChip key={a.id} att={a} />)}
                            </>
                          )}
                        </div>
                        <div className={`flex items-center gap-1 mt-0.5 ${isMe ? 'justify-end mr-1' : 'ml-1'}`}>
                          <span className="text-[10px] text-gray-400">{fmtTime(msg.createdAt)}</span>
                          {msg.editedAt && <span className="text-[10px] text-gray-400">(edited)</span>}
                          {(msg.reactions ?? []).length > 0 && (
                            <span className="text-[11px]">{(msg.reactions ?? []).map((r) => r.emoji).join('')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Pending attachments preview */}
            {(pendingFiles.length > 0 || pendingDriveFiles.length > 0) && (
              <div className="px-4 py-2 border-t border-gray-100 bg-white flex flex-wrap gap-2">
                {pendingFiles.map((f) => (
                  <div key={`${f.name}-${f.size}`} className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-2 py-1 text-xs">
                    <span className="truncate max-w-30">{f.name}</span>
                    <button onClick={() => removePendingFile(f)}
                      className="text-gray-400 hover:text-red-500">✕</button>
                  </div>
                ))}
                {pendingDriveFiles.map((f) => (
                  <div key={f.id} className="flex items-center gap-1.5 bg-blue-50 rounded-lg px-2 py-1 text-xs text-blue-700">
                    <span>📁</span>
                    <span className="truncate max-w-30">{f.name}</span>
                    <button onClick={() => removePendingDriveFile(f.id)}
                      className="text-blue-400 hover:text-red-500">✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="p-4 bg-white border-t border-gray-200 relative">
              {showDrivePicker && (
                <DrivePicker
                  onSelect={(files) => setPendingDriveFiles((p) => [...p, ...files])}
                  onClose={() => setShowDrivePicker(false)}
                />
              )}
              <input type="file" multiple ref={fileInputRef} className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setPendingFiles((p) => [...p, ...files]);
                  e.target.value = '';
                }} />
              <form onSubmit={handleSend} className="flex items-end gap-2">
                <div className="flex-1 relative flex items-center bg-gray-100 rounded-2xl border border-transparent focus-within:border-emerald-500 focus-within:bg-white transition-all">
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    title="Attach file" className="p-3 text-gray-400 hover:text-emerald-600 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                  <button type="button" onClick={() => setShowDrivePicker((v) => !v)}
                    title="Attach from Google Drive"
                    className={`p-3 transition-colors ${showDrivePicker ? 'text-emerald-600' : 'text-gray-400 hover:text-emerald-600'}`}>
                    <svg className="w-5 h-5" viewBox="0 0 87.3 78" fill="currentColor">
                      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L28 55H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
                      <path d="M43.65 25L29.35 0c-1.35.8-2.5 1.9-3.3 3.3l-25.8 44.7A9.06 9.06 0 0 0 0 52.5h28l15.65-27.5z" fill="#00AC47"/>
                      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L82.1 57c.8-1.4 1.2-2.95 1.2-4.5H55.3l5.9 16.85 12.35 7.45z" fill="#EA4335"/>
                      <path d="M43.65 25L57.95 0H29.35L43.65 25z" fill="#00832D"/>
                      <path d="M55.3 52.5H28L13.7 76.8h59.9L57.95 52.5H55.3z" fill="#2684FC"/>
                      <path d="M73.4 26.05l-12.9-22.75A9.22 9.22 0 0 0 57.2 0H43.65L55.3 52.5h27.8z" fill="#FFBA00"/>
                    </svg>
                  </button>
                  <textarea rows={1} value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend(e).catch(() => undefined);
                      }
                    }}
                    placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                    className="flex-1 py-3 bg-transparent border-none focus:ring-0 text-sm resize-none scrollbar-hide" />
                </div>
                <button type="submit"
                  disabled={sending || (!messageInput.trim() && pendingFiles.length === 0 && pendingDriveFiles.length === 0)}
                  className={`p-3 rounded-2xl transition-all shadow-sm ${!sending && (messageInput.trim() || pendingFiles.length > 0 || pendingDriveFiles.length > 0) ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                  <svg className="w-6 h-6 rotate-90" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-12 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Select a conversation</h3>
            <p className="max-w-xs text-sm">Choose a contact from the left, or start a new one.</p>
            <button onClick={() => setShowNewConv(true)}
              className="mt-4 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700">
              New Conversation
            </button>
          </div>
        )}
      </div>

      {/* ── Right pane / details ─────────────────────────────────────────── */}
      {isDetailsOpen && activeConv && (
        <div className="w-72 lg:w-80 border-l border-gray-200 bg-white flex flex-col">
          <div className="h-17 px-5 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">Details</h2>
            <button onClick={() => setIsDetailsOpen(false)}
              className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar space-y-6">
            <div className="flex flex-col items-center text-center">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold mb-3 ${avatarColor(convDisplayName(activeConv, me))}`}>
                {initials(convDisplayName(activeConv, me))}
              </div>
              <h3 className="font-bold text-gray-900">{convDisplayName(activeConv, me)}</h3>
              <p className="text-xs text-gray-500">{activeConv.type === 'GROUP' ? 'Group Chat' : 'Direct Message'}</p>
            </div>
            {activeConv.type === 'GROUP' && (
              <div>
                <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3">
                  Members ({activeConv.members.length})
                </h4>
                <div className="space-y-2">
                  {activeConv.members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <Avatar name={m.name} size={8} />
                      <span className="text-sm font-medium text-gray-800">{m.name}</span>
                      {m.id === me.id && <span className="text-[10px] text-gray-400">(you)</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3">Shared Files</h4>
              {messages.flatMap((m) => m.attachments).slice(-6).reverse().map((a) => (
                <a key={a.id}
                  href={a.driveUrl ?? `/api/chat/attachments/${a.id}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors mb-2">
                  <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{a.filename}</p>
                    <p className="text-[10px] text-gray-400">{fmtSize(a.size)}</p>
                  </div>
                </a>
              ))}
              {messages.flatMap((m) => m.attachments).length === 0 && (
                <p className="text-xs text-gray-400">No shared files yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
