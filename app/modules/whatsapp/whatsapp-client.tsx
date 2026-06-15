'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Status {
  available: boolean;
  authenticated: boolean;
  connected: boolean;
  linkedJid: string | null;
  lastSyncAt: string | null;
  counts: { messages: number; chats: number; contacts: number; groups: number };
  error?: string;
}

interface Chat {
  jid: string;
  kind: 'dm' | 'group' | 'newsletter' | 'unknown';
  name: string;
  lastMessageTs: string;
  archived: boolean;
  pinned: boolean;
  unread: boolean;
}

interface Message {
  id: string;
  chatJid: string;
  senderJid: string;
  senderName: string;
  fromMe: boolean;
  text: string;
  mediaType: string;
  mediaCaption: string;
  timestamp: string;
  revoked: boolean;
}

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';

function timeOf(at: string) {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function dayOf(at: string) {
  const t = new Date(at).getTime();
  if (!t || t < 0) return '';
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function initials(name: string): string {
  const s = name.trim();
  if (!s) return '#';
  const parts = s.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || s[0].toUpperCase();
}

function previewOf(m: Message): string {
  if (m.revoked) return 'This message was deleted';
  if (m.text) return m.text;
  if (m.mediaCaption) return m.mediaCaption;
  if (m.mediaType) return `[${m.mediaType}]`;
  return '';
}

/** A short, deterministic colour for a sender name (group thread name tags). */
function nameColor(name: string): string {
  const palette = ['#0891b2', '#7c3aed', '#c026d3', '#db2777', '#ea580c', '#16a34a', '#2563eb', '#ca8a04'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function GroupIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.5-1.35M5 9a3 3 0 102.5-1.35" />
    </svg>
  );
}

export default function WhatsAppClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/whatsapp/status', { credentials: 'include' });
      const d = (await r.json().catch(() => null)) as Status | null;
      if (d) setStatus(d);
    } catch {
      /* ignore */
    }
  }, []);

  const loadChats = useCallback(async () => {
    try {
      const r = await fetch('/api/whatsapp/chats?limit=1000', { credentials: 'include' });
      const d = (await r.json().catch(() => null)) as { chats?: Chat[]; error?: string } | null;
      if (d?.chats) setChats(d.chats);
      setChatsError(d?.error ?? null);
    } catch {
      setChatsError('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadChats();
    const t = setInterval(() => {
      void loadStatus();
      void loadChats();
    }, 8000);
    return () => clearInterval(t);
  }, [loadStatus, loadChats]);

  // Chats sorted: pinned first, then most-recent activity.
  const sorted = useMemo(() => {
    return [...chats].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return +new Date(b.lastMessageTs) - +new Date(a.lastMessageTs);
    });
  }, [chats]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => c.name.toLowerCase().includes(q) || c.jid.includes(q));
  }, [sorted, search]);

  const effectiveSelected = selectedJid ?? sorted[0]?.jid ?? null;
  const activeChat = sorted.find((c) => c.jid === effectiveSelected) ?? null;

  const loadThread = useCallback(async (jid: string) => {
    try {
      const r = await fetch(`/api/whatsapp/thread?jid=${encodeURIComponent(jid)}&limit=200`, {
        credentials: 'include',
      });
      const d = (await r.json().catch(() => null)) as { messages?: Message[] } | null;
      if (d?.messages) setThread(d.messages);
    } catch {
      /* ignore */
    }
  }, []);

  // Load + poll the open thread.
  useEffect(() => {
    if (!effectiveSelected) {
      setThread([]);
      return;
    }
    let active = true;
    setThread([]);
    void loadThread(effectiveSelected);
    const t = setInterval(() => active && void loadThread(effectiveSelected), 4000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [effectiveSelected, loadThread]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, effectiveSelected]);

  const sendReply = async () => {
    if (!effectiveSelected || !text.trim()) return;
    setError(null);
    setSending(true);
    try {
      const r = await fetch('/api/whatsapp/reply', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: effectiveSelected, message: text }),
      });
      const d = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) {
        setError(d?.error ?? 'Could not send the message.');
      } else {
        setText('');
        await loadThread(effectiveSelected);
      }
    } catch {
      setError('Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  // Connection banner state.
  const statusPill = (() => {
    if (!status) return { dot: 'bg-gray-300', text: 'text-gray-500', label: 'Checking…' };
    if (!status.available)
      return { dot: 'bg-rose-500', text: 'text-rose-600', label: 'wacli not installed' };
    if (!status.authenticated)
      return { dot: 'bg-amber-400', text: 'text-amber-600', label: 'Not paired' };
    if (status.connected) return { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Live' };
    return { dot: 'bg-blue-400', text: 'text-blue-600', label: 'Synced (offline)' };
  })();

  const isGroupThread = activeChat?.kind === 'group';

  return (
    <div className="flex h-screen flex-col bg-gray-50/50">
      <header className="flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-primary sm:text-xl">WhatsApp</h1>
          <p className="text-xs text-gray-500">
            {status?.linkedJid ? `Linked: +${status.linkedJid.split('@')[0]}` : 'Client & group conversations'}
            {status?.counts ? ` · ${status.counts.chats} chats · ${status.counts.groups} groups` : ''}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium">
          <span className={`h-2.5 w-2.5 rounded-full ${statusPill.dot}`} />
          <span className={statusPill.text}>{statusPill.label}</span>
        </span>
      </header>

      {status && status.available && !status.authenticated && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 sm:px-6">
          WhatsApp isn’t paired on the server. Run <span className="font-mono">wacli auth</span> there once and scan the
          QR with WhatsApp → Linked devices.
        </div>
      )}
      {status && status.available && status.authenticated && !status.connected && (
        <div className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-700 sm:px-6">
          Showing the synced mirror{status.lastSyncAt ? ` (last sync ${dayOf(status.lastSyncAt)} ${timeOf(status.lastSyncAt)})` : ''}.
          For live incoming messages, keep <span className="font-mono">wacli sync --follow</span> running on the server.
        </div>
      )}
      {chatsError && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 sm:px-6">
          {chatsError}
        </div>
      )}
      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 sm:px-6">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Conversation list */}
        <aside
          className={`${selectedJid ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-gray-100 bg-white md:w-80 lg:w-96`}
        >
          <div className="border-b border-gray-100 p-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients & groups…"
              className={inputClass}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-gray-400">
                {status?.authenticated ? 'No conversations found.' : 'Pair WhatsApp on the server to load conversations.'}
              </p>
            ) : (
              filtered.map((c) => {
                const active = c.jid === effectiveSelected;
                const group = c.kind === 'group';
                return (
                  <button
                    key={c.jid}
                    type="button"
                    onClick={() => setSelectedJid(c.jid)}
                    className={`flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3 text-left transition-colors ${active ? 'bg-primary/5' : 'hover:bg-gray-50'}`}
                  >
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${group ? 'bg-amber-100 text-amber-700' : 'bg-primary/10 text-primary'}`}
                    >
                      {group ? <GroupIcon /> : initials(c.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-semibold text-gray-900">{c.name}</span>
                        {c.pinned && (
                          <svg className="h-3 w-3 shrink-0 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M16 9V4h1a1 1 0 000-2H7a1 1 0 000 2h1v5a3 3 0 01-3 3v2h5.97v7l1 1 1-1v-7H19v-2a3 3 0 01-3-3z" />
                          </svg>
                        )}
                        <span className="ml-auto shrink-0 text-[11px] text-gray-400">{dayOf(c.lastMessageTs)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                        {group && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            Group
                          </span>
                        )}
                        {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
                        <span className="truncate">+{c.jid.split('@')[0]}</span>
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Conversation thread */}
        <section className={`${selectedJid ? 'flex' : 'hidden md:flex'} min-h-0 flex-1 flex-col bg-gray-50`}>
          {activeChat ? (
            <>
              <div className="flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSelectedJid(null)}
                  className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 md:hidden"
                  aria-label="Back"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isGroupThread ? 'bg-amber-100 text-amber-700' : 'bg-primary/10 text-primary'}`}
                >
                  {isGroupThread ? <GroupIcon /> : initials(activeChat.name)}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-semibold text-gray-900">
                    {activeChat.name}
                    {isGroupThread && <span className="text-xs font-normal text-amber-700">· group</span>}
                  </p>
                  <p className="truncate text-xs text-gray-500">+{activeChat.jid.split('@')[0]}</p>
                </div>
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-4 sm:px-6">
                {thread.length === 0 ? (
                  <p className="py-12 text-center text-sm text-gray-400">No messages in this conversation yet.</p>
                ) : (
                  thread.map((m) => {
                    const out = m.fromMe;
                    return (
                      <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${out ? 'bg-primary text-white' : 'bg-white text-gray-900'}`}
                        >
                          {isGroupThread && !out && (
                            <p className="text-xs font-semibold" style={{ color: nameColor(m.senderName) }}>
                              {m.senderName}
                            </p>
                          )}
                          <p className={`whitespace-pre-wrap break-words ${m.revoked ? 'italic opacity-70' : ''}`}>
                            {previewOf(m)}
                          </p>
                          <div className={`mt-0.5 text-right text-[10px] ${out ? 'text-white/70' : 'text-gray-400'}`}>
                            {timeOf(m.timestamp)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex items-center gap-2 border-t border-gray-100 bg-white p-3">
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendReply();
                    }
                  }}
                  placeholder={status?.authenticated ? 'Type a message…' : 'Pair WhatsApp to send messages'}
                  disabled={!status?.authenticated}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={sendReply}
                  disabled={!status?.authenticated || sending || !text.trim()}
                  className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {sending ? '…' : 'Send'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <svg className="h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="mt-3 text-sm text-gray-400">Select a conversation to view and reply.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
