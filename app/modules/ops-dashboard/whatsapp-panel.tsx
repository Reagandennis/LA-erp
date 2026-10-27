'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { SILENT_BANNER_HEADER } from '@/app/ui/banner';
import { useNow } from '@/app/ui/use-client';
import type { StoredMessage } from '@/lib/messaging-store';
import type { OpsChat, OpsWhatsapp } from '@/lib/ops-dashboard';

import { Empty, Panel, type PanelFrame, ago, clock, fieldClass } from './ops-ui';

const THREAD_LIMIT = 25;

const MEDIA_LABEL: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice note',
  document: 'Document',
  sticker: 'Sticker',
};

function chatHref(chat: Pick<OpsChat, 'accountId' | 'chatId'>) {
  return `/modules/whatsapp?account=${chat.accountId}&chat=${encodeURIComponent(chat.chatId)}`;
}

/** The chat's latest messages, oldest first; null when they couldn't be loaded. */
async function fetchThread(chat: Pick<OpsChat, 'accountId' | 'chatId'>): Promise<StoredMessage[] | null> {
  const params = new URLSearchParams({ id: chat.chatId, limit: String(THREAD_LIMIT), account: String(chat.accountId) });
  if (document.visibilityState === 'hidden') params.set('read', '0');
  try {
    const response = await fetch(`/api/whatsapp/thread?${params}`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return null;
    return ((await response.json()) as { messages?: StoredMessage[] }).messages ?? [];
  } catch {
    return null;
  }
}

/**
 * The last messages of one chat, with a reply box. Opening it marks the chat
 * read, as the WhatsApp module does; a reload while the tab is hidden doesn't.
 */
function Thread({
  chat,
  version,
  onBack,
  onSent,
}: Readonly<{ chat: OpsChat; version: number; onBack: () => void; onSent: () => Promise<void> }>) {
  const [messages, setMessages] = useState<StoredMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const show = (loaded: StoredMessage[] | null) => {
    if (loaded) setMessages(loaded);
    setError(loaded ? null : 'Could not load this chat.');
  };

  // Again whenever a message arrives for this user (`version`).
  const { accountId, chatId } = chat;
  useEffect(() => {
    let live = true;
    void fetchThread({ accountId, chatId }).then((loaded) => live && show(loaded));
    return () => {
      live = false;
    };
  }, [accountId, chatId, version]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const reply = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/whatsapp/reply?account=${chat.accountId}`, {
        method: 'POST',
        credentials: 'include',
        // The panel shows its own outcome.
        headers: { 'Content-Type': 'application/json', [SILENT_BANNER_HEADER]: '1' },
        body: JSON.stringify({ id: chat.chatId, message }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? 'Could not send the message.');
        return;
      }
      setText('');
      const [loaded] = await Promise.all([fetchThread(chat), onSent()]);
      show(loaded);
    } catch {
      setError('Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[26rem] max-h-full flex-col [[data-sized]_&]:h-full">
      <div className="flex items-center gap-2 border-b border-gray-100 px-2 pb-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to chats"
          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{chat.name}</p>
        <Link href={chatHref(chat)} className="shrink-0 text-xs font-bold text-primary hover:underline">
          Open in WhatsApp
        </Link>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
        {messages === null && !error && <p className="py-6 text-center text-xs text-gray-400">Loading…</p>}
        {messages?.length === 0 && <p className="py-6 text-center text-xs text-gray-400">No messages yet.</p>}
        {messages?.map((m) => (
          <div key={m.id} className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${
                m.fromMe ? 'rounded-br-md bg-emerald-100 text-gray-900' : 'rounded-bl-md bg-gray-100 text-gray-900'
              }`}
            >
              {chat.kind === 'group' && !m.fromMe && <p className="text-[11px] font-bold text-emerald-700">{m.senderName}</p>}
              {m.media && <p className="text-xs italic text-gray-500">{MEDIA_LABEL[m.media.kind] ?? 'Attachment'}</p>}
              {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
              <p className="mt-0.5 text-right text-[10px] text-gray-400">{clock(m.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="px-2 pb-1 text-xs text-rose-600">{error}</p>}
      <form
        className="flex items-end gap-2 border-t border-gray-100 px-2 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void reply();
        }}
      >
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void reply();
            }
          }}
          placeholder="Reply…"
          aria-label={`Reply to ${chat.name}`}
          className={`${fieldClass} max-h-28 resize-none`}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

/** The viewer's latest WhatsApp chats; open one to read and reply without leaving the board. */
export default function WhatsappPanel({
  data,
  version,
  frame,
  onChanged,
}: Readonly<{ data: OpsWhatsapp; version: number; frame: PanelFrame; onChanged: () => Promise<void> }>) {
  const now = useNow(60_000);
  // Kept apart from the list, so a refresh that pushes it out of the latest few doesn't close it.
  const [open, setOpen] = useState<OpsChat | null>(null);
  const keyOf = (c: OpsChat) => `${c.accountId}:${c.chatId}`;

  return (
    <Panel id="ops-whatsapp" icon="whatsapp" title="WhatsApp" count={data.unreadChats} tone="good" href="/modules/whatsapp" moduleName="WhatsApp" frame={frame}>
      {!data.linked ? (
        <Empty>
          Link your WhatsApp in the{' '}
          <Link href="/modules/whatsapp" className="font-bold text-primary hover:underline">
            WhatsApp module
          </Link>{' '}
          to see your chats here.
        </Empty>
      ) : open ? (
        <Thread
          chat={open}
          version={version}
          onBack={() => setOpen(null)}
          onSent={onChanged}
        />
      ) : data.chats.length === 0 ? (
        <Empty>No chats yet.</Empty>
      ) : (
        <ul className="space-y-0.5">
          {data.chats.map((chat) => (
            <li key={keyOf(chat)}>
              <button
                type="button"
                onClick={() => setOpen(chat)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                  {chat.name.trim().charAt(0).toUpperCase() || '#'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${chat.unread > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>
                      {chat.name}
                    </span>
                    <span className={`shrink-0 text-[11px] tabular-nums ${chat.unread > 0 ? 'font-bold text-emerald-600' : 'text-gray-400'}`}>
                      {ago(chat.lastMessageAt, now)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-gray-500">
                      {chat.preview
                        ? `${chat.preview.fromMe ? 'You: ' : chat.kind === 'group' ? `${chat.preview.senderName}: ` : ''}${
                            chat.preview.text || MEDIA_LABEL[chat.preview.mediaKind ?? ''] || 'Attachment'
                          }`
                        : ''}
                    </span>
                    {chat.unread > 0 && (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-black text-white">
                        {chat.unread > 99 ? '99+' : chat.unread}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
