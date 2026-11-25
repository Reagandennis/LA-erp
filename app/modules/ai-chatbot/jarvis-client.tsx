'use client';

import { useIsClient } from '@/app/ui/use-client';
import React, {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  AtSymbolIcon,
  CalendarIcon,
  ChatHistoryIcon,
  ChevronDownIcon,
  CloseIcon,
  CogIcon,
  DocumentIcon,
  type IconComponent,
  MicrophoneIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  TruckIcon,
} from '@/app/ui/icons';
import { ContextTokens, Markdown } from './markdown';
import { activeChatKey, chatsKey, INSPECTOR_WIDTH_KEY, removeLegacyChats } from './storage';
import ToolCalls, { type ActionItem, type Outcome, OutcomeLine } from './tool-calls';

const MAX_CHATS = 50;
/** How long the server honours a confirmation; past it the card can only be dismissed. */
const CONFIRM_TTL_MS = 10 * 60 * 1000;

/** A short answer typed while a Confirm card is up is an answer to the card. */
const TYPED_YES = /^(yes|y|yep|yeah|confirm|confirmed|go ahead|do it|proceed|ok|okay|sure)[\s.!]*$/i;
const TYPED_NO = /^(no|n|nope|cancel|stop|don'?t|do not)[\s.!]*$/i;

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// Below this the split-pane collapses to a single column and the inspector
// becomes a full-screen sheet. Shared by the container query and the JS check.
const MOBILE_MAX_WIDTH = 767;
const INSPECTOR_DEFAULT_WIDTH = 460;
const INSPECTOR_MIN_WIDTH = 320;
const INSPECTOR_MAX_WIDTH = 860;

interface PendingConfirmation {
  token: string;
  tool: string;
  label: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  actions?: ActionItem[];
  /** What the reply did, as the server counted it. Absent on chats saved before it was sent. */
  outcome?: Outcome;
  /** The server's account of what the reply ran; sent back with the history so later turns know. */
  record?: string;
  /** On a system line: what the assistant should be told happened (a cancel, a lost reply). */
  note?: string;
  /** The reply is holding an action for Confirm. */
  waiting?: boolean;
  /** Epoch ms. Absent on chats saved before timestamps were added. */
  at?: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  /** The action this chat is waiting on, and when it was asked. */
  pending?: (PendingConfirmation & { at: number }) | null;
}

interface ApiResponse {
  reply?: string;
  actions?: ActionItem[];
  outcome?: Outcome;
  record?: string;
  pendingConfirmation?: PendingConfirmation;
  error?: string;
  retryAfterSeconds?: number;
}

// Capability groups, each backed by the tools Jarvis can actually call.
const CATEGORIES: Array<{
  key: string;
  label: string;
  icon: IconComponent;
}> = [
  { key: 'sales', label: 'Sales', icon: DocumentIcon },
  { key: 'operations', label: 'Operations', icon: TruckIcon },
  { key: 'planning', label: 'Planning', icon: CalendarIcon },
  { key: 'research', label: 'Research', icon: SearchIcon },
];

/** `needs`: the module a suggestion works in; it is only offered to people who hold one of them. */
const CATEGORY_SUGGESTIONS: Record<
  string,
  Array<{ heading: string; body: string; prompt: string; needs?: string[] }>
> = {
  sales: [
    {
      heading: 'Create a client',
      body: 'Add a new account with contact details',
      prompt: 'Create a client called ',
      needs: ['customers', 'quotes', 'invoices-review'],
    },
    {
      heading: 'Draft a quote',
      body: 'Build a quote for a client with line items',
      prompt: 'Draft a quote for ',
      needs: ['quotes'],
    },
    {
      heading: 'Check unpaid invoices',
      body: 'See what is outstanding or overdue',
      prompt: 'Which invoices are unpaid or overdue?',
      needs: ['invoices-review'],
    },
    {
      heading: 'Look up a product or service',
      body: 'Find it in the catalogue with its price',
      prompt: 'Find the product or service called ',
      needs: ['products-services', 'quotes', 'invoices-review'],
    },
  ],
  operations: [
    {
      heading: 'Change a trip itinerary',
      body: 'Add a pickup, move a time, or put a driver on an event',
      prompt: 'On trip ',
      needs: ['trip-planning'],
    },
    {
      heading: 'See what starts next',
      body: 'Upcoming trips, soonest first',
      prompt: 'Which trips start next?',
      needs: ['trip-planning'],
    },
    {
      heading: 'Add a driver',
      body: 'Register a driver against the fleet',
      prompt: 'Add a driver named ',
      needs: ['task-assignment'],
    },
    {
      heading: 'Check vehicle status',
      body: 'See which vehicles are free',
      prompt: 'Which vehicles are available?',
      needs: ['task-assignment', 'vehicles'],
    },
    {
      heading: 'Plan a trip',
      body: 'Create a trip with dates and a client',
      prompt: 'Plan a trip for ',
      needs: ['trip-planning'],
    },
  ],
  planning: [
    {
      heading: 'What is on today?',
      body: 'Pull up calendar entries for the day',
      prompt: 'What is on my calendar today?',
      needs: ['calendar'],
    },
    {
      heading: 'Add a to-do',
      body: 'Capture a task with a due date',
      prompt: 'Add a to-do to ',
      needs: ['todo-personal'],
    },
    {
      heading: 'Schedule a meeting',
      body: 'Create a calendar event with a time and place',
      prompt: 'Schedule a meeting on ',
      needs: ['calendar'],
    },
    {
      heading: 'Show overdue tasks',
      body: 'Find the to-dos that have slipped past their date',
      prompt: 'Which of my tasks are overdue?',
      needs: ['todo-personal'],
    },
  ],
  research: [
    {
      heading: 'Check the weather',
      body: 'Current conditions for any location',
      prompt: 'What is the weather in Nairobi right now?',
    },
    {
      heading: 'Look something up',
      body: 'Search the web for current information',
      prompt: 'Search the web for ',
    },
    {
      heading: 'Summarise a topic',
      body: 'Condense what is known into key points',
      prompt: 'Summarise the key points about ',
    },
    {
      heading: 'Compare options',
      body: 'Weigh alternatives against each other',
      prompt: 'Compare the pros and cons of ',
    },
  ],
};

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

// --- Message presentation helpers ----------------------------------------

function formatTime(at?: number) {
  if (!at) return '';
  return new Date(at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Returns a divider label when a message opens a new calendar day. */
function dayDivider(message: ChatMessage, previous: ChatMessage | null) {
  if (!message.at) return null;

  const day = new Date(message.at);
  day.setHours(0, 0, 0, 0);

  if (previous?.at) {
    const previousDay = new Date(previous.at);
    previousDay.setHours(0, 0, 0, 0);
    if (previousDay.getTime() === day.getTime()) return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deltaDays = Math.round((today.getTime() - day.getTime()) / 86400000);

  if (deltaDays === 0) return 'Today';
  if (deltaDays === 1) return 'Yesterday';
  return day.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

function DayDivider({ label }: Readonly<{ label: string }>) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-gray-200" />
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
        {label}
      </span>
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

/** Peels the `[Context: …]` prefix back off a stored prompt for display. */
function splitContext(text: string): { context: string[]; body: string } {
  const match = /^\[Context: ([^\]]+)\]\n([\s\S]*)$/.exec(text);
  if (!match) return { context: [], body: text };
  return {
    context: match[1].split(',').map((entry) => entry.trim()).filter(Boolean),
    body: match[2],
  };
}

// --- Speech-to-text -------------------------------------------------------

type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const globalScope = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return globalScope.SpeechRecognition ?? globalScope.webkitSpeechRecognition;
}

// Read support through useSyncExternalStore rather than an effect, so the server
// snapshot is a definite `false` and hydration never disagrees with the client.
const subscribeToNothing = () => () => {};
const isDictationSupported = () => Boolean(getRecognitionCtor());
const isDictationSupportedOnServer = () => false;

/** Wraps the Web Speech API; reports unsupported so the button can hide. */
function useDictation(onTranscript: (text: string) => void) {
  const supported = useSyncExternalStore(
    subscribeToNothing,
    isDictationSupported,
    isDictationSupportedOnServer,
  );
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const callbackRef = useRef(onTranscript);

  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    const Recognition = getRecognitionCtor();

    if (!Recognition) {
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'en-GB';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal && result[0]) {
          callbackRef.current(result[0].transcript.trim());
        }
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    };
  }, []);

  const toggle = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (listening) {
      recognition.stop();
      setListening(false);
      return;
    }

    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening]);

  return { supported, listening, toggle };
}

// --- Dropdown -------------------------------------------------------------

function Dropdown({
  label,
  icon: LeadingIcon,
  children,
  align = 'left',
  width = 220,
  iconOnly = false,
  title,
}: Readonly<{
  label: string;
  icon: IconComponent;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  width?: number;
  iconOnly?: boolean;
  title?: string;
}>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={iconOnly ? label : undefined}
        title={title ?? label}
        className={`flex items-center gap-1.5 rounded-xl text-xs font-bold text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary ${
          iconOnly ? 'p-2' : 'px-2.5 py-2'
        }`}
      >
        <LeadingIcon className="h-4 w-4 shrink-0" />
        {!iconOnly && (
          <>
            {label}
            <ChevronDownIcon className="h-3 w-3 opacity-60" />
          </>
        )}
      </button>

      {open && (
        <div
          style={{ width }}
          className={`absolute bottom-full z-30 mb-2 overflow-hidden rounded-2xl border border-gray-200 bg-white py-1.5 shadow-2xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function DropdownItem({
  label,
  description,
  icon: LeadingIcon,
  active = false,
  onClick,
}: Readonly<{
  label: string;
  description?: string;
  icon?: IconComponent;
  active?: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-50 ${
        active ? 'text-primary' : 'text-gray-700'
      }`}
    >
      {LeadingIcon && <LeadingIcon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />}
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{label}</span>
        {description && (
          <span className="block truncate text-xs text-gray-400">{description}</span>
        )}
      </span>
    </button>
  );
}

// The split-pane collapses on a narrow *container*, not a narrow viewport, so it
// behaves correctly when the app sidebar is expanded. Plain <style> — no build step.
const JARVIS_CSS = `
.jarvis-root { container-type: inline-size; container-name: jarvis; }
.jarvis-inspector-panel {
  width: var(--jarvis-panel-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
@container jarvis (max-width: ${MOBILE_MAX_WIDTH}px) {
  .jarvis-resize-handle { display: none; }
  .jarvis-inspector-panel { display: none; }
}
`;

function InspectorHeader({
  label,
  action,
  onClose,
}: Readonly<{ label: string; action: ActionItem; onClose: () => void }>) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(action.result, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <DocumentIcon className="h-4 w-4 shrink-0 text-gray-400" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-primary">{label}</p>
          <p className="truncate text-[11px] text-gray-400">Tool result</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={copy}
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function InspectorBody({ action }: Readonly<{ action: ActionItem }>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <pre className="overflow-x-auto rounded-2xl bg-gray-50 p-3">
        <code className="font-mono text-xs leading-relaxed text-gray-800">
          {JSON.stringify(action.result, null, 2)}
        </code>
      </pre>
    </div>
  );
}

// --- Main -----------------------------------------------------------------

export default function JarvisClient({
  userId,
  userName,
  moduleNames,
  moduleSlugs,
  isAdmin,
}: {
  userId: number;
  userName: string;
  moduleNames: string[];
  moduleSlugs: string[];
  isAdmin: boolean;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // An error belongs to the chat it happened in, not to whichever is on screen.
  const [failure, setFailure] = useState<{ chatId: string; text: string } | null>(null);
  // Set when the server says to wait (rate limit, daily allowance).
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [references, setReferences] = useState<string[]>([]);
  const [inspected, setInspected] = useState<{
    action: ActionItem;
    label: string;
    mode: 'panel' | 'sheet';
  } | null>(null);
  const [panelWidth, setPanelWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelWidthRef = useRef(panelWidth);
  const columnRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);


  // Match the container-query breakpoint by measuring the root, not the viewport,
  // so an expanded app sidebar is accounted for.
  const openInspector = useCallback((action: ActionItem, label: string) => {
    const width = rootRef.current?.offsetWidth ?? Number.POSITIVE_INFINITY;
    setInspected({ action, label, mode: width <= MOBILE_MAX_WIDTH ? 'sheet' : 'panel' });
  }, []);

  // The panel is right-anchored, so dragging left widens it.
  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        INSPECTOR_MAX_WIDTH,
        Math.max(INSPECTOR_MIN_WIDTH, startWidth + (startX - moveEvent.clientX)),
      );
      setPanelWidth(next);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      document.body.style.userSelect = '';
      try {
        localStorage.setItem(INSPECTOR_WIDTH_KEY, String(panelWidthRef.current));
      } catch {
        /* quota — ignore */
      }
    };

    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const appendDictation = useCallback((text: string) => {
    setInput((current) => (current ? `${current.trimEnd()} ${text}` : text));
    inputRef.current?.focus();
  }, []);
  const dictation = useDictation(appendDictation);

  // Restore persisted chats and the inspector width during the first client
  // render (the server never sees localStorage, so `loaded` gates persistence).
  const isClient = useIsClient();
  if (isClient && !loaded) {
    setLoaded(true);
    removeLegacyChats();

    // Storage can be blocked outright (private mode, policy): the page still works, it just starts empty.
    let chats: Conversation[] = [];
    let savedActive: string | null = null;
    try {
      const savedWidth = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY));
      if (Number.isFinite(savedWidth) && savedWidth >= INSPECTOR_MIN_WIDTH) {
        setPanelWidth(Math.min(savedWidth, INSPECTOR_MAX_WIDTH));
      }
      const raw = localStorage.getItem(chatsKey(userId));
      if (raw) chats = JSON.parse(raw) as Conversation[];
      savedActive = localStorage.getItem(activeChatKey(userId));
    } catch {
      chats = [];
    }
    chats = Array.isArray(chats) ? chats.filter((c) => c && Array.isArray(c.messages)) : [];
    if (chats.length === 0) {
      const first = newConversation();
      chats = [first];
      setActiveId(first.id);
    } else {
      setActiveId(savedActive && chats.some((c) => c.id === savedActive) ? savedActive : chats[0].id);
    }
    setConversations(chats);
  }

  // Persist on change.
  useEffect(() => {
    if (!loaded) return;
    try {
      // The chats most recently used are the ones kept.
      const kept = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
      localStorage.setItem(chatsKey(userId), JSON.stringify(kept));
      if (activeId) localStorage.setItem(activeChatKey(userId), activeId);
    } catch {
      /* quota — ignore */
    }
  }, [conversations, activeId, loaded, userId]);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = useMemo(() => active?.messages ?? [], [active]);
  const pending = active?.pending ?? null;
  const error = failure && failure.chatId === activeId ? failure.text : null;
  const cooling = cooldownUntil > 0;

  // The column is what scrolls (the list inside it never overflows), so that
  // is what follows new replies and brings the Confirm card into view.
  useEffect(() => {
    columnRef.current?.scrollTo({ top: columnRef.current.scrollHeight, behavior: 'smooth' });
  }, [activeId, messages.length, busy, pending]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setTimeout(() => setCooldownUntil(0), Math.max(0, cooldownUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [cooldownUntil]);

  // Keep the composer sized to its content.
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }, [input]);

  const patchChat = (chatId: string, updater: (c: Conversation) => Conversation) => {
    setConversations((cur) => cur.map((c) => (c.id === chatId ? updater(c) : c)));
  };

  /**
   * What the server is sent of the conversation. A reply goes with the
   * server's own record of what it ran; a system line goes as a note when it
   * marks something the assistant has to know (a cancel, a lost reply).
   */
  const historyFrom = (msgs: ChatMessage[]) =>
    msgs
      .flatMap((m) => {
        if (m.role === 'system') return m.note ? [{ role: 'note', text: m.note }] : [];
        if (m.role === 'assistant') return [{ role: 'assistant', text: m.text, record: m.record }];
        return [{ role: 'user', text: m.text }];
      })
      .slice(-16);

  /**
   * Sends one request for a chat and files the reply in that chat, wherever
   * the user has moved to since. `onFail` hears whether the server may have
   * acted before the reply was lost (`uncertain`), or refused outright.
   */
  const post = async (
    chatId: string,
    payload: Record<string, unknown>,
    priorMessages: ChatMessage[],
    onFail: (text: string, uncertain: boolean) => void,
  ) => {
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch('/api/ai-chatbot', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, history: historyFrom(priorMessages), timeZone: browserTimeZone() }),
      });
      const data = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !data) {
        if (data?.retryAfterSeconds) setCooldownUntil(Date.now() + data.retryAfterSeconds * 1000);
        // A refusal the server put into words did nothing; a bare failure may have got part-way.
        const refused = Boolean(data?.error) && res.status < 500;
        const text = data?.error ?? 'The assistant could not respond. If you asked for a change, check the record before sending again.';
        setFailure({ chatId, text });
        onFail(text, !refused);
        return;
      }
      patchChat(chatId, (c) => ({
        ...c,
        pending: data.pendingConfirmation ? { ...data.pendingConfirmation, at: Date.now() } : null,
        messages: [
          ...c.messages,
          {
            role: 'assistant',
            text: data.reply || 'No reply.',
            actions: data.actions,
            outcome: data.outcome,
            record: data.record,
            waiting: Boolean(data.pendingConfirmation),
            at: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      }));
    } catch {
      const text = 'No reply came back (network error). If you asked for a change, check the record before sending again.';
      setFailure({ chatId, text });
      onFail(text, true);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!pending || busy || !active) return;
    const chatId = active.id;
    const held = pending;
    if (Date.now() - held.at > CONFIRM_TTL_MS) {
      patchChat(chatId, (c) => ({
        ...c,
        pending: null,
        messages: [
          ...c.messages,
          {
            role: 'system',
            text: 'That confirmation expired. Nothing was changed.',
            note: `The confirmation for "${held.label}" expired before the user pressed it. It was NOT run.`,
            at: Date.now(),
          },
        ],
      }));
      return;
    }
    patchChat(chatId, (c) => ({ ...c, pending: null }));
    void post(chatId, { confirmToken: held.token }, active.messages, (text, uncertain) => {
      patchChat(chatId, (c) => ({
        ...c,
        messages: [
          ...c.messages,
          {
            role: 'system',
            text: uncertain ? 'No reply after confirming. Check the record before trying again.' : 'Not run.',
            note: uncertain
              ? `The user confirmed "${held.label}" but no reply came back. It may or may not have run: check before doing it again.`
              : `"${held.label}" was NOT run (${text}).`,
            at: Date.now(),
          },
        ],
      }));
    });
  };

  const cancel = () => {
    if (!pending || !active) return;
    const held = pending;
    patchChat(active.id, (c) => ({
      ...c,
      pending: null,
      messages: [
        ...c.messages,
        {
          role: 'system',
          text: 'Action cancelled.',
          note: `The user cancelled "${held.label}". It was NOT run.`,
          at: Date.now(),
        },
      ],
    }));
  };

  const send = (text: string) => {
    const typed = text.trim();
    if (!typed || busy || !active || cooling) return;

    // "yes" or "no" typed under a Confirm card answers the card.
    if (pending && TYPED_YES.test(typed)) {
      setInput('');
      confirm();
      return;
    }
    if (pending && TYPED_NO.test(typed)) {
      setInput('');
      cancel();
      return;
    }

    // Referenced modules ride along as a context line the model can read.
    const prompt = references.length
      ? `[Context: ${references.join(', ')}]\n${typed}`
      : typed;

    const chatId = active.id;
    // Anything else typed while an action waits leaves it unconfirmed: say so, to the user and the assistant.
    const dropped: ChatMessage[] = pending
      ? [
          {
            role: 'system',
            text: 'Action not confirmed.',
            note: `The user did not confirm "${pending.label}" and moved on. It was NOT run.`,
            at: Date.now(),
          },
        ]
      : [];
    const prior = [...active.messages, ...dropped];
    const isFirst = active.messages.length === 0;
    const sent: ChatMessage = { role: 'user', text: prompt, at: Date.now() };
    const sentReferences = references;
    patchChat(chatId, (c) => ({
      ...c,
      title: isFirst ? typed.slice(0, 40) : c.title,
      pending: null,
      messages: [...c.messages, ...dropped, sent],
      updatedAt: Date.now(),
    }));
    setInput('');
    setReferences([]);
    void post(chatId, { prompt }, prior, (_text, uncertain) => {
      // Nothing came back: take the message out of the conversation and put
      // the words back in the box, so sending again is one press.
      patchChat(chatId, (c) => ({
        ...c,
        messages: [
          ...c.messages.filter((m) => m !== sent),
          ...(uncertain
            ? [
                {
                  role: 'system' as const,
                  text: 'No reply came back. Your message is in the box again.',
                  note: 'A message from the user got no reply (the request failed). Whatever it asked for may not have been done.',
                  at: Date.now(),
                },
              ]
            : []),
        ],
      }));
      setInput((current) => current || typed);
      setReferences(sentReferences);
    });
  };

  const startNewChat = () => {
    const convo = newConversation();
    setConversations((cur) => [convo, ...cur]);
    setActiveId(convo.id);
    setInput('');
    setReferences([]);
    setCategory(null);
    setShowHistory(false);
  };

  const switchTo = (id: string) => {
    setActiveId(id);
    setInput('');
    setReferences([]);
    setInspected(null);
    setShowHistory(false);
  };

  const deleteChat = (id: string) => {
    const next = conversations.filter((c) => c.id !== id);
    if (next.length === 0) {
      const fresh = newConversation();
      setConversations([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setConversations(next);
    if (id === activeId) setActiveId([...next].sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
  };

  const applySuggestion = (prompt: string) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  const addReference = (name: string) => {
    setReferences((cur) => (cur.includes(name) ? cur : [...cur, name]));
    inputRef.current?.focus();
  };

  const ordered = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const empty = messages.length === 0;
  // Only what this person can actually ask for: a card for an area they lack would lead nowhere.
  const suggestions = category
    ? CATEGORY_SUGGESTIONS[category].filter(
        (s) => isAdmin || !s.needs || s.needs.some((slug) => moduleSlugs.includes(slug)),
      )
    : null;
  const activeCategory = CATEGORIES.find((c) => c.key === category);
  const firstName = userName.split(' ')[0];

  const composer = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send(input);
      }}
      className="w-full rounded-3xl border border-gray-200 bg-white shadow-xl shadow-gray-200/50 transition-colors focus-within:border-primary/40"
    >
      {/* Header actions */}
      <div className="flex items-center gap-1 px-3 pt-2">
        <Dropdown label="Reference a module" icon={AtSymbolIcon} width={260} iconOnly>
          {(close) =>
            moduleNames.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">No modules assigned.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {moduleNames.map((name) => (
                  <DropdownItem
                    key={name}
                    label={name}
                    onClick={() => {
                      addReference(name);
                      close();
                    }}
                  />
                ))}
              </div>
            )
          }
        </Dropdown>
        <span className="text-[11px] font-semibold text-gray-300">
          Reference a module for context
        </span>
      </div>

      <textarea
        ref={inputRef}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send(input);
          }
        }}
        rows={1}
        placeholder="Ask anything"
        className="min-h-[84px] w-full resize-none bg-transparent px-5 py-3 text-[15px] leading-relaxed text-gray-900 placeholder:text-gray-300 focus:outline-none"
      />

      {/* Reference drawer */}
      {references.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-4 py-2.5">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">
            {references.length} ref{references.length === 1 ? '' : 's'}
          </span>
          {references.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2.5 pr-1 text-xs font-bold text-primary"
            >
              {name}
              <button
                type="button"
                onClick={() => setReferences((cur) => cur.filter((n) => n !== name))}
                aria-label={`Remove ${name}`}
                className="rounded-full p-0.5 hover:bg-primary/20"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-1 border-t border-gray-100 px-3 py-2">
        <Dropdown
          label={activeCategory?.label ?? 'Auto'}
          icon={activeCategory?.icon ?? SparklesIcon}
          width={200}
        >
          {(close) => (
            <>
              <DropdownItem
                label="Auto"
                icon={SparklesIcon}
                active={category === null}
                onClick={() => {
                  setCategory(null);
                  close();
                }}
              />
              {CATEGORIES.map((option) => (
                <DropdownItem
                  key={option.key}
                  label={option.label}
                  icon={option.icon}
                  active={category === option.key}
                  onClick={() => {
                    setCategory(option.key);
                    close();
                  }}
                />
              ))}
            </>
          )}
        </Dropdown>

        <Dropdown label="Settings" icon={CogIcon} width={230}>
          {(close) => (
            <>
              <DropdownItem
                label="New chat"
                description="Start a fresh conversation"
                icon={PlusIcon}
                onClick={() => {
                  startNewChat();
                  close();
                }}
              />
              <DropdownItem
                label="Chat history"
                description={`${conversations.length} saved on this device`}
                icon={ChatHistoryIcon}
                onClick={() => {
                  setShowHistory(true);
                  close();
                }}
              />
              <DropdownItem
                label="Clear references"
                description="Drop the module context chips"
                icon={CloseIcon}
                onClick={() => {
                  setReferences([]);
                  close();
                }}
              />
            </>
          )}
        </Dropdown>

        <div className="ml-auto flex items-center gap-1.5">
          {dictation.supported && (
            <button
              type="button"
              onClick={dictation.toggle}
              aria-label={dictation.listening ? 'Stop dictation' : 'Start dictation'}
              aria-pressed={dictation.listening}
              className={`rounded-xl p-2 transition-colors ${
                dictation.listening
                  ? 'bg-rose-50 text-rose-500'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-primary'
              }`}
            >
              <MicrophoneIcon className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            disabled={busy || cooling || !input.trim()}
            aria-label="Send"
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <SendIcon className="h-4 w-4" />
            Send
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <div ref={rootRef} className="jarvis-root h-[calc(100dvh-3rem)] bg-gray-50/50">
      <style>{JARVIS_CSS}</style>

      <div className="flex h-full">
        <div ref={columnRef} className="jarvis-chat-column relative min-w-0 flex-1 overflow-y-auto">
          {/* History control — sticky so it survives scrolling inside the column. */}
          <div className="pointer-events-none sticky top-0 z-20 flex justify-end px-6 pt-4">
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className="pointer-events-auto rounded-full border border-gray-200 bg-white/90 px-4 py-1.5 text-xs font-bold text-gray-500 shadow-sm backdrop-blur transition-colors hover:text-primary"
            >
              <span className="flex items-center gap-1.5">
                <ChatHistoryIcon className="h-3.5 w-3.5" />
                {active?.title || 'New chat'}
              </span>
            </button>
          </div>

          <div className="mx-auto flex min-h-[calc(100%-3.5rem)] w-full max-w-[720px] flex-col gap-8 px-6 pb-14 pt-4">
        {empty ? (
          <div className="flex flex-1 flex-col justify-center gap-8">
            {/* Greeting */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <SparklesIcon className="h-5 w-5 text-secondary" />
                <h2 className="text-lg font-medium text-gray-500">Hi, {firstName}</h2>
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-primary lg:text-5xl">
                Where should we start?
              </h1>
            </div>

            {composer}
            {error && <p className="text-xs text-rose-500">{error}</p>}

            {/* Category filters + suggestion cards */}
            <div className="flex flex-col gap-6 px-1">
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((option) => {
                  const selected = category === option.key;
                  const Icon = option.icon;

                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setCategory(selected ? null : option.key)}
                      aria-pressed={selected}
                      className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-bold transition-colors ${
                        selected
                          ? 'border-primary bg-primary text-white'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-primary/40 hover:text-primary'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {option.label}
                    </button>
                  );
                })}
              </div>

              {suggestions && suggestions.length === 0 && (
                <p className="text-sm text-gray-500">
                  You don&apos;t have access to these areas yet. Ask IT for permission.
                </p>
              )}
              {suggestions && suggestions.length > 0 && (
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.heading}
                      type="button"
                      onClick={() => applySuggestion(suggestion.prompt)}
                      className="rounded-2xl border border-gray-100 bg-white p-4 text-left transition-all hover:border-primary/40 hover:shadow-lg"
                    >
                      <h4 className="text-sm font-bold text-primary">{suggestion.heading}</h4>
                      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                        {suggestion.body}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-5">
              {messages.map((message, index) => {
                const previous = index > 0 ? messages[index - 1] : null;
                const divider = dayDivider(message, previous);

                if (message.role === 'system') {
                  return (
                    <div key={index}>
                      {divider && <DayDivider label={divider} />}
                      <p className="py-1 text-center text-[11px] font-bold uppercase tracking-[0.15em] text-gray-400">
                        {message.text}
                      </p>
                    </div>
                  );
                }

                if (message.role === 'user') {
                  const { context, body } = splitContext(message.text);
                  // Group with the message above when it is also from the user.
                  const grouped = previous?.role === 'user' && !divider;

                  return (
                    <div key={index} className={grouped ? '-mt-3' : undefined}>
                      {divider && <DayDivider label={divider} />}
                      <div className="flex flex-col items-end">
                        <ContextTokens names={context} />
                        <div className="max-w-[85%] rounded-3xl bg-primary px-5 py-3 text-[15px] leading-relaxed text-white">
                          <p className="whitespace-pre-wrap break-words">{body}</p>
                        </div>
                        <span className="mt-1 text-[10px] font-bold text-gray-400">
                          {formatTime(message.at)}
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={index}>
                    {divider && <DayDivider label={divider} />}
                    <div className="flex gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                        JV
                      </span>
                      <div className="min-w-0 flex-1">
                        <Markdown compact>{message.text}</Markdown>
                        {message.outcome && (
                          <OutcomeLine
                            outcome={message.outcome}
                            actions={message.actions ?? []}
                            waiting={message.waiting}
                          />
                        )}
                        {message.actions && message.actions.length > 0 && (
                          <ToolCalls
                            actions={message.actions}
                            onInspect={openInspector}
                          />
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-[10px] font-bold text-gray-400">Jarvis</span>
                          <span className="text-[10px] text-gray-300">
                            {formatTime(message.at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {busy && (
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                    JV
                  </span>
                  <div className="flex items-center gap-2.5 pt-1.5">
                    <div className="flex items-end gap-1">
                      {[0, 160, 320].map((delay) => (
                        <span
                          key={delay}
                          className="h-2 w-2 animate-bounce rounded-full bg-primary"
                          style={{ animationDelay: `${delay}ms`, animationDuration: '1s' }}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-gray-400">Jarvis is thinking…</span>
                  </div>
                </div>
              )}

              {pending && !busy && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-700">
                    Waiting for you
                  </p>
                  <p className="mt-1 text-sm font-bold text-amber-900">{pending.label}</p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    Nothing has changed yet. Press Confirm (or type yes) to go ahead, Cancel (or no) to leave it.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={confirm}
                      className="rounded-xl bg-primary px-4 py-1.5 text-xs font-bold text-white"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={cancel}
                      className="rounded-xl px-4 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-rose-500">{error}</p>}
            <div className="sticky bottom-0 pb-2">{composer}</div>
          </>
        )}
          </div>
        </div>

        {/* Desktop split-pane: resize handle + inspector panel */}
        {inspected?.mode === 'panel' && (
          <>
            <div
              role="separator"
              aria-label="Resize inspector panel"
              aria-orientation="vertical"
              onPointerDown={startResize}
              className="jarvis-resize-handle group w-1.5 shrink-0 cursor-col-resize bg-gray-200 transition-colors hover:bg-primary/40"
            />
            <aside
              style={{ '--jarvis-panel-width': `${panelWidth}px` } as CSSProperties}
              className="jarvis-inspector-panel border-l border-gray-200 bg-white"
            >
              <InspectorHeader
                label={inspected.label}
                action={inspected.action}
                onClose={() => setInspected(null)}
              />
              <InspectorBody action={inspected.action} />
            </aside>
          </>
        )}
      </div>

      {/* Mobile inspector — full-screen sheet */}
      {inspected?.mode === 'sheet' && (
        <div className="fixed inset-0 z-[230] flex flex-col bg-white">
          <InspectorHeader
            label={inspected.label}
            action={inspected.action}
            onClose={() => setInspected(null)}
          />
          <InspectorBody action={inspected.action} />
        </div>
      )}

      {/* Chat history drawer */}
      {showHistory && (
        <div className="fixed inset-0 z-[230]">
          <button
            aria-label="Close history"
            className="absolute inset-0 bg-gray-900/30"
            onClick={() => setShowHistory(false)}
          />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-xs flex-col bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold text-primary">Chat history</h3>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={startNewChat}
              className="mb-3 flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-white"
            >
              <PlusIcon className="h-4 w-4" />
              New chat
            </button>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {ordered.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1 rounded-xl px-3 py-2.5 text-sm ${
                    c.id === activeId
                      ? 'bg-primary/10 text-primary'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => switchTo(c.id)}
                    className="min-w-0 flex-1 truncate text-left font-bold"
                  >
                    {c.title || 'New chat'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteChat(c.id)}
                    aria-label="Delete chat"
                    className="shrink-0 text-gray-300 transition-opacity hover:text-rose-500 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
