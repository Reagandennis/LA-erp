'use client';

import React, { useEffect, useRef, useState } from 'react';

const BRAND = '#03458f';
const STORAGE_CHATS = 'la-erp.jarvis.chats';
const STORAGE_ACTIVE = 'la-erp.jarvis.active';
const MAX_CHATS = 50;

interface ActionItem {
  tool: string;
  result: unknown;
}

interface PendingConfirmation {
  token: string;
  tool: string;
  label: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  actions?: ActionItem[];
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

interface ApiResponse {
  reply?: string;
  actions?: ActionItem[];
  pendingConfirmation?: PendingConfirmation;
  error?: string;
}

const SUGGESTIONS = [
  'List my trips',
  'Add a driver named John Mwangi',
  'Create a customer called Acme Ltd',
  'What is the weather in Nairobi right now?',
];

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newConversation(): Conversation {
  return { id: genId(), title: 'New chat', messages: [], updatedAt: Date.now() };
}

function actionLabel(a: ActionItem): { text: string; ok: boolean } {
  const r = (a.result ?? {}) as Record<string, unknown>;
  const verb = a.tool.replace(/_/g, ' ');
  if (typeof r.error === 'string') return { text: `${verb}: ${r.error}`, ok: false };
  const id = r.reference ?? r.number ?? r.id;
  return { text: id ? `${verb} → ${id}` : verb, ok: true };
}

export default function JarvisClient({ userName, moduleNames }: { userName: string; moduleNames: string[] }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false); // mobile drawer
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load persisted chats (client-only — avoids hydration mismatch).
  useEffect(() => {
    let chats: Conversation[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_CHATS);
      if (raw) chats = JSON.parse(raw) as Conversation[];
    } catch {
      chats = [];
    }
    if (!Array.isArray(chats) || chats.length === 0) {
      const first = newConversation();
      chats = [first];
      setActiveId(first.id);
    } else {
      const savedActive = localStorage.getItem(STORAGE_ACTIVE);
      setActiveId(savedActive && chats.some((c) => c.id === savedActive) ? savedActive : chats[0].id);
    }
    setConversations(chats);
    setLoaded(true);
  }, []);

  // Persist on change.
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_CHATS, JSON.stringify(conversations.slice(0, MAX_CHATS)));
      if (activeId) localStorage.setItem(STORAGE_ACTIVE, activeId);
    } catch {
      /* quota — ignore */
    }
  }, [conversations, activeId, loaded]);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activeId, messages.length, busy, pending]);

  const patchActive = (updater: (c: Conversation) => Conversation) => {
    setConversations((cur) => cur.map((c) => (c.id === activeId ? updater(c) : c)));
  };

  const historyFrom = (msgs: ChatMessage[]) =>
    msgs.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, text: m.text }));

  const post = async (payload: Record<string, unknown>, priorMessages: ChatMessage[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai-chatbot', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, history: historyFrom(priorMessages) }),
      });
      const data = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !data) {
        setError(data?.error ?? 'The assistant could not respond.');
        return;
      }
      patchActive((c) => ({
        ...c,
        messages: [...c.messages, { role: 'assistant', text: data.reply ?? 'Done.', actions: data.actions }],
        updatedAt: Date.now(),
      }));
      setPending(data.pendingConfirmation ?? null);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const send = (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy || !active) return;
    const prior = active.messages;
    const isFirst = prior.length === 0;
    patchActive((c) => ({
      ...c,
      title: isFirst ? prompt.slice(0, 40) : c.title,
      messages: [...c.messages, { role: 'user', text: prompt }],
      updatedAt: Date.now(),
    }));
    setInput('');
    setPending(null);
    void post({ prompt }, prior);
  };

  const confirm = () => {
    if (!pending || busy || !active) return;
    const prior = active.messages;
    const token = pending.token;
    setPending(null);
    void post({ confirmToken: token }, prior);
  };

  const cancel = () => {
    if (!pending) return;
    setPending(null);
    patchActive((c) => ({ ...c, messages: [...c.messages, { role: 'system', text: 'Action cancelled.' }] }));
  };

  const startNewChat = () => {
    const convo = newConversation();
    setConversations((cur) => [convo, ...cur].slice(0, MAX_CHATS));
    setActiveId(convo.id);
    setPending(null);
    setInput('');
    setShowList(false);
  };

  const switchTo = (id: string) => {
    setActiveId(id);
    setPending(null);
    setInput('');
    setShowList(false);
  };

  const deleteChat = (id: string) => {
    setConversations((cur) => {
      const next = cur.filter((c) => c.id !== id);
      if (next.length === 0) {
        const fresh = newConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  };

  const ordered = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const empty = messages.length === 0;

  const ChatList = (
    <div className="flex h-full flex-col">
      <button
        onClick={startNewChat}
        className="mb-2 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-white"
        style={{ backgroundColor: BRAND }}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New chat
      </button>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {ordered.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm ${
              c.id === activeId ? 'bg-[#03458f]/10 text-[#03458f]' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <button onClick={() => switchTo(c.id)} className="min-w-0 flex-1 truncate text-left font-medium">
              {c.title || 'New chat'}
            </button>
            <button
              onClick={() => deleteChat(c.id)}
              className="shrink-0 text-gray-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
              title="Delete chat"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="h-[calc(100dvh-2.25rem)] bg-gray-50">
      <div className="mx-auto flex h-full w-full max-w-5xl gap-3 p-3">
        {/* Chat list (desktop) */}
        <aside className="hidden w-56 shrink-0 rounded-2xl border border-gray-100 bg-white p-2 md:flex md:flex-col">
          {ChatList}
        </aside>

        {/* Mobile chat-list drawer */}
        {showList && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button aria-label="Close" className="absolute inset-0 bg-gray-900/30" onClick={() => setShowList(false)} />
            <div className="absolute left-0 top-0 h-full w-64 bg-white p-3 shadow-xl">{ChatList}</div>
          </div>
        )}

        {/* Conversation */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Compact header */}
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={() => setShowList(true)}
              className="rounded-lg border border-gray-200 p-2 text-gray-500 md:hidden"
              aria-label="Chats"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ backgroundColor: BRAND }}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h1 className="text-sm font-semibold text-gray-900">Jarvis</h1>
            <span className="truncate text-xs text-gray-400">· {active?.title || 'New chat'}</span>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-gray-100 bg-white p-4">
            {empty && (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                <p className="text-sm font-medium text-gray-700">Hi {userName.split(' ')[0]} — how can I help?</p>
                <p className="mt-1 max-w-sm text-xs text-gray-400">
                  I can act across your modules: {moduleNames.slice(0, 6).join(', ')}
                  {moduleNames.length > 6 ? '…' : ''}.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#03458f]/40 hover:text-[#03458f]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              if (m.role === 'system') {
                return (
                  <p key={i} className="text-center text-xs text-gray-400">
                    {m.text}
                  </p>
                );
              }
              const isUser = m.role === 'user';
              return (
                <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${isUser ? '' : 'w-full'}`}>
                    <div
                      className={`rounded-2xl px-4 py-2.5 text-sm ${isUser ? 'text-white' : 'bg-gray-50 text-gray-900'}`}
                      style={isUser ? { backgroundColor: BRAND } : undefined}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    </div>
                    {m.actions && m.actions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.actions.map((a, j) => {
                          const { text, ok } = actionLabel(a);
                          return (
                            <span
                              key={j}
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                ok ? 'bg-[#03458f]/10 text-[#03458f]' : 'bg-rose-50 text-rose-600'
                              }`}
                            >
                              {ok ? '✓' : '!'} {text}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {busy && (
              <div className="flex items-center gap-2.5">
                <div className="flex items-end gap-1">
                  {[0, 160, 320].map((delay) => (
                    <span
                      key={delay}
                      className="h-2 w-2 animate-bounce rounded-full"
                      style={{ backgroundColor: BRAND, animationDelay: `${delay}ms`, animationDuration: '1s' }}
                    />
                  ))}
                </div>
                <span className="text-xs text-gray-400">Jarvis is thinking…</span>
              </div>
            )}

            {pending && !busy && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">Confirm: {pending.label}?</p>
                <p className="mt-0.5 text-xs text-amber-700">This action changes or removes data and needs your confirmation.</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={confirm} className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: BRAND }}>
                    Confirm
                  </button>
                  <button onClick={cancel} className="rounded-lg px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mt-2 flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Ask Jarvis to do something…"
              className="max-h-32 flex-1 resize-none rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-2xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
