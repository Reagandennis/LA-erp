'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { startVisibleInterval } from '@/lib/visible-interval';

import {
  getAlertSettings,
  getViewingChat,
  type MessagingService,
  setUnread,
  type UnreadByService,
  useMessagingUnread,
} from './messaging-alerts-store';
import { pushToast } from './toast';

/**
 * Tells you a WhatsApp, Telegram or Signal message arrived, wherever you are
 * in the ERP: unread badges in the sidebar and tab title, a toast on the
 * page, and — while the tab is in the background — a system notification
 * and a chime, as set in the messaging console's Alerts menu.
 *
 * Mounted once in the root layout. It listens to the same push stream as the
 * consoles; badges always come from the server's counts, never the events.
 */

const SERVICE_NAMES: Record<MessagingService, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  signal: 'Signal',
};

interface Preview {
  messageId: string;
  chatId: string;
  chatName: string;
  chatKind: 'dm' | 'group';
  senderName: string;
  text: string;
  mediaKind: string | null;
}

interface MessagingEvent {
  accountId?: number;
  live?: boolean;
  preview?: Preview | null;
}

interface UnreadSummary {
  providers: UnreadByService;
  accounts: Array<{ id: number; provider: MessagingService }>;
}

const MEDIA_LABELS: Record<string, string> = {
  image: '📷 Photo',
  video: '🎥 Video',
  audio: '🎤 Voice message',
  sticker: 'Sticker',
  document: '📄 Document',
};

function bodyOf(preview: Preview): string {
  const media = preview.mediaKind ? MEDIA_LABELS[preview.mediaKind] ?? 'Attachment' : '';
  if (preview.text && media) return `${media} · ${preview.text}`;
  return preview.text || media || 'New message';
}

/** A short two-note chime, synthesised so there is no audio file to ship. */
let audio: AudioContext | null = null;
function chime(): void {
  try {
    audio ??= new AudioContext();
    // Browsers keep audio suspended until the page has been interacted with;
    // until then this is silently a no-op.
    void audio.resume();
    const start = audio.currentTime;
    for (const [i, frequency] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const t = start + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  } catch {
    // No audio available.
  }
}

/**
 * Run `alert` in exactly one open tab per message. A visible tab claims it at
 * once (and shows a toast); background tabs wait a beat first, so one only
 * takes over — with a system notification — when no tab is on screen.
 */
function onceAcrossTabs(messageKey: string, alert: () => void): void {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) {
    alert();
    return;
  }
  const visible = document.visibilityState === 'visible';
  setTimeout(
    () => {
      void locks
        .request(`la-erp-message-alert:${messageKey}`, { ifAvailable: true }, async (lock) => {
          if (!lock) return;
          alert();
          // Hold it long enough that slower tabs find it taken.
          await new Promise((resolve) => setTimeout(resolve, 5000));
        })
        .catch(() => {});
    },
    visible ? 0 : 400,
  );
}

export default function MessagingAlerts() {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  useEffect(() => {
    let stopped = false;
    let services = new Map<number, MessagingService>();

    const refresh = async () => {
      try {
        const r = await fetch('/api/messaging/unread', { credentials: 'include', cache: 'no-store' });
        if (!r.ok) return;
        const data = (await r.json()) as UnreadSummary;
        if (stopped) return;
        services = new Map(data.accounts.map((a) => [a.id, a.provider]));
        setUnread(data.providers);
      } catch {
        // The next event or tick tries again.
      }
    };

    // A burst of events (a history page, a busy group) costs one refetch.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      pending ??= setTimeout(() => {
        pending = null;
        void refresh();
      }, 300);
    };

    const alert = (service: MessagingService, accountId: number, preview: Preview) => {
      const viewing = getViewingChat();
      const onScreen =
        document.visibilityState === 'visible' &&
        viewing?.accountId === accountId &&
        viewing.chatId === preview.chatId;
      if (onScreen) return;

      const settings = getAlertSettings();
      const name = SERVICE_NAMES[service];
      const href = `/modules/${service}?account=${accountId}&chat=${encodeURIComponent(preview.chatId)}`;
      const title = settings.preview
        ? preview.chatKind === 'group'
          ? `${preview.senderName} · ${preview.chatName}`
          : preview.chatName
        : `New ${name} message`;
      const body = settings.preview ? bodyOf(preview) : 'Open the chat to read it.';

      onceAcrossTabs(`${accountId}:${preview.messageId}`, () => {
        if (document.visibilityState === 'visible') {
          pushToast({
            // One toast per chat: a second message updates it rather than stacking.
            key: `chat:${accountId}:${preview.chatId}`,
            source: 'message',
            title,
            message: body,
            timestamp: new Date().toISOString(),
            href,
            actionLabel: `Open in ${name}`,
          });
        } else if (settings.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const notification = new Notification(title, {
              body,
              // The same chat replaces its previous notification.
              tag: `la-erp:${accountId}:${preview.chatId}`,
            });
            notification.onclick = () => {
              window.focus();
              routerRef.current.push(href);
              notification.close();
            };
          } catch {
            // Notifications unavailable in this context.
          }
        }
        if (settings.sound) chime();
      });
    };

    const source = new EventSource('/api/messaging/stream', { withCredentials: true });
    // `ready` opens every connection, reconnects included: resync the badges.
    source.addEventListener('ready', () => void refresh());
    source.addEventListener('messaging', (event) => {
      refreshSoon();
      let payload: MessagingEvent;
      try {
        payload = JSON.parse((event as MessageEvent).data) as MessagingEvent;
      } catch {
        return;
      }
      const { accountId, preview } = payload;
      if (!payload.live || !preview || !accountId) return;
      const service = services.get(accountId);
      if (service) {
        alert(service, accountId, preview);
        return;
      }
      // An account linked since the last refresh: learn its service first.
      void refresh().then(() => {
        const known = services.get(accountId);
        if (known) alert(known, accountId, preview);
      });
    });

    // Covers a stream that is down for longer than the browser's retry.
    const stopPolling = startVisibleInterval(() => void refresh(), 60_000);

    return () => {
      stopped = true;
      source.close();
      stopPolling();
      if (pending) clearTimeout(pending);
    };
  }, []);

  useUnreadTitle();
  return null;
}

/** "(3) LA-ERP" while chats are unread, kept on through page navigations. */
function useUnreadTitle(): void {
  const unread = useMessagingUnread();
  const total = unread.whatsapp + unread.telegram + unread.signal;

  useEffect(() => {
    const prefix = /^\(\d+\+?\) /;
    const apply = () => {
      const base = document.title.replace(prefix, '');
      const next = total > 0 ? `(${total > 99 ? '99+' : total}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    // Next.js rewrites <title> on navigation; put the count back each time.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = document.title.replace(prefix, '');
    };
  }, [total]);
}
