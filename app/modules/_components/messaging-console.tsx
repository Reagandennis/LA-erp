'use client';

import { APP_LOCALE } from '@/lib/locale';
import { startVisibleInterval } from '@/lib/visible-interval';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { setViewingChat } from '@/app/ui/messaging-alerts-store';

import AlertsMenu from './alerts-menu';
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
  /**
   * The provider lets one user link several accounts (WhatsApp). Adds the
   * account switcher, "Add number" and "Unlink".
   */
  multiAccount?: boolean;
}

export interface MessagingConsoleProps {
  config: MessagingConsoleConfig;
  /**
   * Optional alternative to the QR flow, shown beneath it — Telegram offers
   * phone/code sign-in for accounts with two-step verification, which cannot
   * complete a QR login.
   */
  signIn?: (props: { onSignedIn: () => void }) => React.ReactNode;
  /** Account to open first (from `?account=`); the first linked one otherwise. */
  initialAccountId?: number | null;
  /** Chat to open first (from `?chat=`, which message alerts link to). */
  initialChatId?: string | null;
}

interface AccountSummary {
  id: number;
  label: string | null;
  /** Chats with unread messages. */
  unread: number;
}

interface Status {
  available: boolean;
  authenticated: boolean;
  connected: boolean;
  label: string | null;
  counts: { chats: number; messages: number };
  hint?: string;
  error?: string;
  /** Multi-account providers: the account this status describes, and all of them. */
  accountId?: number | null;
  accounts?: AccountSummary[];
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

export default function MessagingConsole({ config, signIn, initialAccountId, initialChatId }: MessagingConsoleProps) {
  const base = `/api/${config.service}`;
  /** The account picked in the switcher; null means the server's default (the first linked). */
  const [accountId, setAccountId] = useState<number | null>(initialAccountId ?? null);
  const [adding, setAdding] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  /** Bumped to force an immediate status + chats reload. */
  const [reloadKey, reload] = useReducer((n: number) => n + 1, 0);
  const [status, setStatus] = useState<Status | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialChatId ?? null);
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
  /**
   * The picked account, kept current for async callbacks: a response that
   * comes back after the user switched accounts is dropped, never shown
   * under the other number.
   */
  const accountRef = useRef<number | null>(accountId);

  /** Append `account=` when one is picked, so every request names its account. */
  const scoped = useCallback(
    (path: string) => (accountId ? `${path}${path.includes('?') ? '&' : '?'}account=${accountId}` : path),
    [accountId],
  );

  /** Show another account: clear everything that belonged to the previous one. */
  const chooseAccount = useCallback((id: number | null) => {
    accountRef.current = id;
    setAccountId(id);
    setAdding(false);
    setSelectedId(null);
    setChats([]);
    setThread([]);
    setSearch('');
    setNewChatOpen(false);
    setError(null);
    setChatsError(null);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('account', String(id));
    else url.searchParams.delete('account');
    window.history.replaceState(null, '', url);
  }, []);

  const loadStatus = useCallback(async () => {
    const requested = accountId;
    try {
      const r = await fetch(scoped(`${base}/status`), { credentials: 'include' });
      if (accountRef.current !== requested) return;
      // The account was unlinked elsewhere (another tab, an old link).
      if (r.status === 404 && requested) {
        chooseAccount(null);
        return;
      }
      const d = (await r.json().catch(() => null)) as Status | null;
      if (d) setStatus(d);
    } catch {
      /* ignore */
    }
  }, [base, scoped, accountId, chooseAccount]);

  const loadChats = useCallback(async () => {
    const requested = accountId;
    try {
      const r = await fetch(scoped(`${base}/chats`), { credentials: 'include' });
      const d = (await r.json().catch(() => null)) as { chats?: Chat[]; error?: string } | null;
      if (accountRef.current !== requested) return;
      if (d?.chats) setChats(d.chats);
      setChatsError(d?.error ?? null);
    } catch {
      setChatsError('Could not reach the server.');
    }
  }, [base, scoped, accountId]);

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
    // reloadKey is a dependency only so bumping it restarts with an immediate load.
    [loadStatus, loadChats, reloadKey],
  );

  const accounts = useMemo(() => status?.accounts ?? [], [status]);
  /** The account on screen: the one picked, else the one the server defaulted to. */
  const shownAccountId = accountId ?? status?.accountId ?? null;
  const shownAccount = accounts.find((a) => a.id === shownAccountId) ?? null;

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
      const requested = accountId;
      try {
        // A background tab only refreshes: the message stays unread (here and
        // on the phone) until someone actually looks at it.
        const hidden = document.visibilityState === 'hidden';
        const r = await fetch(scoped(`${base}/thread?id=${encodeURIComponent(id)}&limit=200${hidden ? '&read=0' : ''}`), {
          credentials: 'include',
        });
        const d = (await r.json().catch(() => null)) as { messages?: Message[] } | null;
        if (accountRef.current !== requested) return;
        if (d?.messages) setThread(d.messages);
      } catch {
        /* ignore */
      }
    },
    [base, scoped, accountId],
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

  /** What the SSE handler needs, kept current without re-opening the stream. */
  const liveRef = useRef({ loadStatus, loadChats, loadThread, shownAccountId, accountIds: [] as number[] });
  useEffect(() => {
    liveRef.current = { loadStatus, loadChats, loadThread, shownAccountId, accountIds: accounts.map((a) => a.id) };
  });

  /**
   * Live updates. The server pushes only the affected chat ids, so we refetch
   * from the mirror rather than trusting the event payload — a dropped or
   * duplicated event can then never corrupt what's on screen.
   */
  useEffect(() => {
    const source = new EventSource('/api/messaging/stream', { withCredentials: true });
    // `ready` opens every connection, including the browser's automatic
    // reconnects. Whatever was pushed while the stream was down (laptop
    // asleep, network change, server restart) is gone, so resync from the
    // mirror rather than wait for the next slow tick. The first one coincides
    // with the initial load and is skipped.
    let connectedBefore = false;
    source.addEventListener('ready', () => {
      if (!connectedBefore) {
        connectedBefore = true;
        return;
      }
      const live = liveRef.current;
      void live.loadStatus();
      void live.loadChats();
      if (selectedRef.current) void live.loadThread(selectedRef.current);
    });
    source.addEventListener('messaging', (event) => {
      let payload: { chatIds?: string[]; accountId?: number };
      try {
        payload = JSON.parse((event as MessageEvent).data) as typeof payload;
      } catch {
        return;
      }
      const live = liveRef.current;
      if (payload.accountId && live.shownAccountId && payload.accountId !== live.shownAccountId) {
        // Another of this user's numbers: only the switcher's unread badges change.
        if (live.accountIds.includes(payload.accountId)) void live.loadStatus();
        return;
      }
      void live.loadChats();
      if (selectedRef.current && payload.chatIds?.includes(selectedRef.current)) {
        void live.loadThread(selectedRef.current);
      }
    });
    return () => source.close();
  }, []);

  useEffect(() => {
    selectedRef.current = effectiveSelected;
  }, [effectiveSelected]);

  // Tell the app-wide alerts which chat is on screen, so a message arriving
  // in it doesn't also pop a toast.
  useEffect(() => {
    setViewingChat(shownAccountId && effectiveSelected ? { accountId: shownAccountId, chatId: effectiveSelected } : null);
  }, [shownAccountId, effectiveSelected]);
  useEffect(() => () => setViewingChat(null), []);

  // Coming back to the tab is when the open chat actually gets read.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && selectedRef.current) {
        void liveRef.current.loadThread(selectedRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Following an alert's link while already on this page: open that chat.
  const [linkedChat, setLinkedChat] = useState(initialChatId ?? null);
  if (initialChatId && initialChatId !== linkedChat) {
    setLinkedChat(initialChatId);
    setSelectedId(initialChatId);
  }
  useEffect(() => {
    if (initialChatId && initialAccountId && initialAccountId !== accountRef.current) {
      chooseAccount(initialAccountId);
      setSelectedId(initialChatId);
    }
  }, [initialAccountId, initialChatId, chooseAccount]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, effectiveSelected]);

  const sendReply = async () => {
    if (!effectiveSelected || !text.trim()) return;
    setError(null);
    setSending(true);
    try {
      const r = await fetch(scoped(`${base}/reply`), {
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
      const r = await fetch(scoped('/api/messaging/new-chat'), {
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
      const r = await fetch(scoped(`${base}/send-media`), {
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

  /** Unlink the account on screen, after the user confirms. */
  const unlinkAccount = async () => {
    if (!shownAccount || unlinking) return;
    const name = shownAccount.label ?? `this ${config.title} account`;
    const confirmed = window.confirm(
      `Unlink ${name}?\n\nIts conversations are removed from LA-ERP and LA-ERP is signed out of that ${config.title}. Your phone keeps all its chats.`,
    );
    if (!confirmed) return;
    setUnlinking(true);
    setError(null);
    try {
      const r = await fetch(`/api/messaging/link?provider=${config.service}&account=${shownAccount.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? `Could not unlink ${name}.`);
        return;
      }
      chooseAccount(null);
      setStatus(null);
      reload();
    } catch {
      setError(`Could not unlink ${name}.`);
    } finally {
      setUnlinking(false);
    }
  };

  const onLinked = (linkedId: number | null) => {
    setAdding(false);
    if (config.multiAccount && linkedId) chooseAccount(linkedId);
    reload();
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
        <div className="flex items-center gap-2">
          <AlertsMenu />
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium">
            <span className={`h-2.5 w-2.5 rounded-full ${statusPill.dot}`} />
            <span className={statusPill.text}>{statusPill.label}</span>
          </span>
        </div>
      </header>

      {config.multiAccount && accounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-4 py-2 sm:px-6">
          <div role="group" aria-label={`${config.title} accounts`} className="flex flex-wrap items-center gap-2">
            {accounts.map((a) => {
              const active = !adding && a.id === shownAccountId;
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => (a.id === shownAccountId ? setAdding(false) : chooseAccount(a.id))}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium tabular-nums transition ${active ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  {a.label ?? config.title}
                  {a.unread > 0 && !active && (
                    <span className="min-w-5 rounded-full bg-emerald-500 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">
                      {a.unread}
                      <span className="sr-only"> unread chats</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-pressed={adding}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-sm font-medium transition ${adding ? 'border-primary/50 bg-primary/5 text-primary' : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'}`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add number
          </button>
          {shownAccount && !adding && (
            <button
              type="button"
              onClick={() => void unlinkAccount()}
              disabled={unlinking}
              className="ml-auto shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            >
              {unlinking ? 'Unlinking…' : 'Unlink number'}
            </button>
          )}
        </div>
      )}

      {status && !status.authenticated && !adding && (status.hint || status.error) && (
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

      {adding || (status?.available && !status.authenticated) ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
          <MessagingLinkPanel
            // A fresh panel per purpose, so a QR for one never shows under another.
            key={adding ? 'add' : `link-${shownAccountId ?? 'first'}`}
            provider={config.service}
            title={config.title}
            onLinked={onLinked}
            {...(adding
              ? {
                  heading: `Add another ${config.title} number`,
                  description:
                    'Scan with the phone whose number you want to add. Each number keeps its own conversations, and only you can see them.',
                  onCancel: () => setAdding(false),
                }
              : shownAccount
                ? {
                    accountId: shownAccount.id,
                    heading: `Link ${shownAccount.label ?? config.title} again`,
                    description: `${config.title} signed this number out. Scan with the same phone to pick up where it left off.`,
                  }
                : {})}
          >
            {signIn?.({ onSignedIn: reload })}
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
                                accountId={shownAccountId}
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
