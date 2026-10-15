'use client';

import { APP_LOCALE } from '@/lib/locale';
import { startVisibleInterval } from '@/lib/visible-interval';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import MessageMediaView, { type MessageMedia } from './message-media';
import MessagingLinkPanel from './messaging-link-panel';

/**
 * Generic two-pane messaging console shared by the polling-based integrations
 * (Telegram, Signal). It talks to /api/<service>/{status,chats,thread,reply},
 * which all expose the same normalized JSON contract. WhatsApp keeps its own
 * bespoke client because its data shape (phone JIDs, wacli status) differs.
 */

export interface MessagingConsoleConfig {
  service: 'telegram' | 'signal' | 'whatsapp';
  title: string;
  /** Shown under the title as the resting subtitle. */
  subtitle: string;
  /** Placeholder in the conversation search box. */
  searchPlaceholder: string;
  /** Label describing the account identifier, e.g. "Bot" or "Linked number". */
  connectionNoun: string;
  /** Hint for the "start a new chat" field — the address form this provider takes. */
  newChatPlaceholder: string;
}

export interface MessagingConsoleProps {
  config: MessagingConsoleConfig;
  /**
   * Optional alternative to the QR flow, shown beneath it — Telegram offers
   * phone/code sign-in for accounts with two-step verification, which cannot
   * complete a QR login.
   */
  signIn?: (props: { onSignedIn: () => void }) => React.ReactNode;
}

interface Status {
  available: boolean;
  authenticated: boolean;
  connected: boolean;
  label: string | null;
  counts: { chats: number; messages: number };
  hint?: string;
  error?: string;
}

interface Chat {
  id: string;
  kind: 'dm' | 'group';
  name: string;
  lastMessageTs: string;
  unread: boolean;
}

interface Message {
  id: string;
  chatId: string;
  senderName: string;
  fromMe: boolean;
  text: string;
  timestamp: string;
  media?: MessageMedia | null;
}

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';

function timeOf(at: string) {
  return new Date(at).toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' });
}

function dayOf(at: string) {
  const t = new Date(at).getTime();
  if (!t || t < 0) return '';
  return new Date(at).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric' });
}

function initials(name: string): string {
  const s = name.trim();
  if (!s) return '#';
  const parts = s.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || s[0].toUpperCase();
}

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

export default function MessagingConsole({ config, signIn }: MessagingConsoleProps) {
  const base = `/api/${config.service}`;
  const [status, setStatus] = useState<Status | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatTarget, setNewChatTarget] = useState('');
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Mirrors the open chat so the SSE handler doesn't need to re-subscribe. */
  const selectedRef = useRef<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`${base}/status`, { credentials: 'include' });
      const d = (await r.json().catch(() => null)) as Status | null;
      if (d) setStatus(d);
    } catch {
      /* ignore */
    }
  }, [base]);

  const loadChats = useCallback(async () => {
    try {
      const r = await fetch(`${base}/chats`, { credentials: 'include' });
      const d = (await r.json().catch(() => null)) as { chats?: Chat[]; error?: string } | null;
      if (d?.chats) setChats(d.chats);
      setChatsError(d?.error ?? null);
    } catch {
      setChatsError('Could not reach the server.');
    }
  }, [base]);

  // Updates arrive over SSE; this slow tick only covers a dropped stream or a
  // status change (link/unlink) that produces no message event. It pauses
  // while the tab is hidden.
  useEffect(
    () =>
      startVisibleInterval(
        () => {
          void loadStatus();
          void loadChats();
        },
        60_000,
        { immediate: true },
      ),
    [loadStatus, loadChats],
  );

  const sorted = useMemo(() => {
    return [...chats].sort((a, b) => +new Date(b.lastMessageTs) - +new Date(a.lastMessageTs));
  }, [chats]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }, [sorted, search]);

  const effectiveSelected = selectedId ?? sorted[0]?.id ?? null;
  const activeChat = sorted.find((c) => c.id === effectiveSelected) ?? null;

  const loadThread = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`${base}/thread?id=${encodeURIComponent(id)}&limit=200`, {
          credentials: 'include',
        });
        const d = (await r.json().catch(() => null)) as { messages?: Message[] } | null;
        if (d?.messages) setThread(d.messages);
      } catch {
        /* ignore */
      }
    },
    [base],
  );

  // Clear the pane the moment the selection changes (adjusted during render),
  // then fetch the new thread.
  const [threadChatId, setThreadChatId] = useState<string | null>(effectiveSelected);
  if (threadChatId !== effectiveSelected) {
    setThreadChatId(effectiveSelected);
    setThread([]);
  }
  useEffect(() => {
    if (!effectiveSelected) return;
    const id = effectiveSelected;
    void (async () => {
      await loadThread(id);
    })();
  }, [effectiveSelected, loadThread]);

  /**
   * Live updates. The server pushes only the affected chat ids, so we refetch
   * from the mirror rather than trusting the event payload — a dropped or
   * duplicated event can then never corrupt what's on screen.
   */
  useEffect(() => {
    const source = new EventSource('/api/messaging/stream', { withCredentials: true });
    source.addEventListener('messaging', (event) => {
      let chatIds: string[] = [];
      try {
        chatIds = (JSON.parse((event as MessageEvent).data) as { chatIds?: string[] }).chatIds ?? [];
      } catch {
        return;
      }
      void loadChats();
      if (selectedRef.current && chatIds.includes(selectedRef.current)) {
        void loadThread(selectedRef.current);
      }
    });
    return () => source.close();
  }, [loadChats, loadThread]);

  useEffect(() => {
    selectedRef.current = effectiveSelected;
  }, [effectiveSelected]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, effectiveSelected]);

  const sendReply = async () => {
    if (!effectiveSelected || !text.trim()) return;
    setError(null);
    setSending(true);
    try {
      const r = await fetch(`${base}/reply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: effectiveSelected, message: text }),
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

  /**
   * Open a conversation with someone not yet in the list. Nothing is sent —
   * this just creates the local chat so the composer has somewhere to go.
   */
  const startNewChat = async () => {
    const target = newChatTarget.trim();
    if (!target || creatingChat) return;
    setCreatingChat(true);
    setNewChatError(null);
    try {
      const r = await fetch('/api/messaging/new-chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: config.service, target }),
      });
      const d = (await r.json().catch(() => null)) as { chatId?: string; error?: string } | null;
      if (!r.ok || !d?.chatId) {
        setNewChatError(d?.error ?? 'Could not start that chat.');
        return;
      }
      await loadChats();
      setSelectedId(d.chatId);
      setNewChatTarget('');
      setNewChatOpen(false);
    } catch {
      setNewChatError('Could not reach the server.');
    } finally {
      setCreatingChat(false);
    }
  };

  /** Upload one attachment; the caption is whatever is already in the box. */
  const sendFile = async (file: File) => {
    if (!effectiveSelected) return;
    setError(null);
    setSending(true);
    try {
      const form = new FormData();
      form.append('chatId', effectiveSelected);
      form.append('caption', text.trim());
      form.append('file', file);
      const r = await fetch(`${base}/send-media`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const d = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) {
        setError(d?.error ?? 'Could not send the attachment.');
      } else {
        setText('');
        await loadThread(effectiveSelected);
      }
    } catch {
      setError('Could not send the attachment.');
    } finally {
      setSending(false);
    }
  };

  const statusPill = (() => {
    if (!status) return { dot: 'bg-gray-300', text: 'text-gray-500', label: 'Checking…' };
    if (!status.available)
      return { dot: 'bg-rose-500', text: 'text-rose-600', label: 'Not configured' };
    if (!status.authenticated)
      return { dot: 'bg-amber-400', text: 'text-amber-600', label: 'Not linked' };
    if (status.connected) return { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Live' };
    return { dot: 'bg-blue-400', text: 'text-blue-600', label: 'Connected' };
  })();

  const isGroupThread = activeChat?.kind === 'group';
  const canSend = Boolean(status?.authenticated);

  return (
    <div className="screen-fit flex flex-col bg-gray-50/50">
      <header className="flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-primary sm:text-xl">{config.title}</h1>
          <p className="text-xs text-gray-500">
            {status?.label ? `${config.connectionNoun}: ${status.label}` : config.subtitle}
            {status?.counts ? ` · ${status.counts.chats} chats · ${status.counts.messages} messages` : ''}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium">
          <span className={`h-2.5 w-2.5 rounded-full ${statusPill.dot}`} />
          <span className={statusPill.text}>{statusPill.label}</span>
        </span>
      </header>

      {status && !status.authenticated && (status.hint || status.error) && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 sm:px-6">
          {status.hint ?? status.error}
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

      {status?.available && !status.authenticated ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
          <MessagingLinkPanel
            provider={config.service}
            title={config.title}
            onLinked={() => void loadStatus().then(() => loadChats())}
          >
            {signIn?.({ onSignedIn: () => void loadStatus().then(() => loadChats()) })}
          </MessagingLinkPanel>
        </div>
      ) : (
      <div className="flex min-h-0 flex-1">
        <aside
          className={`${selectedId ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-gray-100 bg-white md:w-80 lg:w-96`}
        >
          <div className="border-b border-gray-100 p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={config.searchPlaceholder}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => {
                  setNewChatOpen((v) => !v);
                  setNewChatError(null);
                }}
                disabled={!status?.authenticated}
                title="Start a new chat"
                aria-label="Start a new chat"
                className="shrink-0 rounded-xl bg-gray-50 p-2.5 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </div>

            {newChatOpen && (
              <div className="mt-2">
                <input
                  type="text"
                  autoFocus
                  value={newChatTarget}
                  placeholder={config.newChatPlaceholder}
                  onChange={(e) => setNewChatTarget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void startNewChat();
                    if (e.key === 'Escape') setNewChatOpen(false);
                  }}
                  className={inputClass}
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void startNewChat()}
                    disabled={!newChatTarget.trim() || creatingChat}
                    className="rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    {creatingChat ? 'Opening…' : 'Start chat'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewChatOpen(false)}
                    className="text-xs text-gray-500 transition hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
                {newChatError && <p className="mt-2 text-xs text-rose-600">{newChatError}</p>}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-gray-400">
                {status?.authenticated
                  ? 'No conversations yet. Messages appear here as they arrive.'
                  : `Configure ${config.title} on the server to load conversations.`}
              </p>
            ) : (
              filtered.map((c) => {
                const active = c.id === effectiveSelected;
                const group = c.kind === 'group';
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
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
                        <span className="ml-auto shrink-0 text-[11px] text-gray-400">{dayOf(c.lastMessageTs)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                        {group && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            Group
                          </span>
                        )}
                        {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
                        <span className="truncate">{c.id}</span>
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className={`${selectedId ? 'flex' : 'hidden md:flex'} min-h-0 flex-1 flex-col bg-gray-50`}>
          {activeChat ? (
            <>
              <div className="flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
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
                  <p className="truncate text-xs text-gray-500">{activeChat.id}</p>
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
                          {m.media && (
                            <div className={m.text ? 'mb-1.5' : ''}>
                              <MessageMediaView
                                service={config.service}
                                chatId={m.chatId}
                                media={m.media}
                                out={out}
                              />
                            </div>
                          )}
                          {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
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
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    // Reset immediately so re-picking the same file still fires.
                    e.target.value = '';
                    if (picked) void sendFile(picked);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!canSend || sending}
                  title="Attach a file"
                  aria-label="Attach a file"
                  className="shrink-0 rounded-xl p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                  </svg>
                </button>
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
                  placeholder={canSend ? 'Type a message…' : `Configure ${config.title} to send messages`}
                  disabled={!canSend}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={sendReply}
                  disabled={!canSend || sending || !text.trim()}
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
      )}
    </div>
  );
}
