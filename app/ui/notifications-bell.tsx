'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type NotificationSource = 'todo' | 'quote' | 'trip';

type RawTodoNotification = {
  id: number;
  todoId: number;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

type RawQuoteNotification = {
  id: number;
  quoteId: number;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

type RawTripNotification = {
  id: number;
  itemId: number;
  tripId: number;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

type NotificationItem = {
  source: NotificationSource;
  id: number;
  entityId: number;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  href: string;
  toastTitle: string;
};

const SOURCE_ENDPOINTS: Record<NotificationSource, string> = {
  todo: '/api/planning/notifications',
  quote: '/api/quotes/notifications',
  trip: '/api/planning/trip-notifications',
};

function compositeKey(item: { source: NotificationSource; id: number }): string {
  return `${item.source}-${item.id}`;
}

function buildToastTitle(source: NotificationSource, type: string): string {
  if (source === 'quote') {
    if (type === 'quote.submitted') return 'Quote awaiting your approval';
    if (type === 'quote.approved') return 'Quote approved';
    if (type === 'quote.declined') return 'Quote declined';
    return 'Quote update';
  }
  if (source === 'trip') {
    return 'Trip reminder';
  }
  return 'Shared with you';
}

function buildHref(item: { source: NotificationSource; entityId: number }): string {
  if (item.source === 'quote') {
    return '/modules/quotes';
  }
  if (item.source === 'trip') {
    return `/modules/trip-planning/${item.entityId}`;
  }
  return '/modules/todo-personal';
}

export default function NotificationsBell() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [visibleToastKeys, setVisibleToastKeys] = useState<string[]>([]);

  const dismissToast = (key: string) => {
    setVisibleToastKeys((current) => current.filter((value) => value !== key));
  };

  useEffect(() => {
    let isActive = true;

    const loadNotifications = async () => {
      try {
        const [todoResponse, quoteResponse, tripResponse] = await Promise.all([
          fetch(SOURCE_ENDPOINTS.todo, { credentials: 'include' }).catch(() => null),
          fetch(SOURCE_ENDPOINTS.quote, { credentials: 'include' }).catch(() => null),
          fetch(SOURCE_ENDPOINTS.trip, { credentials: 'include' }).catch(() => null),
        ]);

        const merged: NotificationItem[] = [];

        if (todoResponse && todoResponse.ok) {
          const data = (await todoResponse.json().catch(() => null)) as
            | { notifications?: RawTodoNotification[] }
            | null;
          for (const item of data?.notifications ?? []) {
            merged.push({
              source: 'todo',
              id: item.id,
              entityId: item.todoId,
              type: item.type,
              message: item.message,
              createdAt: item.createdAt,
              readAt: item.readAt,
              href: buildHref({ source: 'todo', entityId: item.todoId }),
              toastTitle: buildToastTitle('todo', item.type),
            });
          }
        }

        if (quoteResponse && quoteResponse.ok) {
          const data = (await quoteResponse.json().catch(() => null)) as
            | { notifications?: RawQuoteNotification[] }
            | null;
          for (const item of data?.notifications ?? []) {
            merged.push({
              source: 'quote',
              id: item.id,
              entityId: item.quoteId,
              type: item.type,
              message: item.message,
              createdAt: item.createdAt,
              readAt: item.readAt,
              href: buildHref({ source: 'quote', entityId: item.quoteId }),
              toastTitle: buildToastTitle('quote', item.type),
            });
          }
        }

        if (tripResponse && tripResponse.ok) {
          const data = (await tripResponse.json().catch(() => null)) as
            | { notifications?: RawTripNotification[] }
            | null;
          for (const item of data?.notifications ?? []) {
            merged.push({
              source: 'trip',
              id: item.id,
              entityId: item.tripId,
              type: item.type,
              message: item.message,
              createdAt: item.createdAt,
              readAt: item.readAt,
              href: buildHref({ source: 'trip', entityId: item.tripId }),
              toastTitle: buildToastTitle('trip', item.type),
            });
          }
        }

        merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const trimmed = merged.slice(0, 25);

        if (!isActive) return;

        setNotifications(trimmed);
        const unreadKeys = trimmed.filter((item) => !item.readAt).map(compositeKey);
        setVisibleToastKeys((current) =>
          Array.from(new Set([...current, ...unreadKeys])),
        );
      } catch {
        // ignore
      }
    };

    void loadNotifications();
    const interval = setInterval(() => {
      void loadNotifications();
    }, 10000);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (visibleToastKeys.length === 0) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      setVisibleToastKeys((current) => current.slice(1));
    }, 3000);
    return () => clearTimeout(timeout);
  }, [visibleToastKeys]);

  const unreadCount = notifications.filter((item) => !item.readAt).length;
  const visibleToasts = notifications.filter((item) =>
    visibleToastKeys.includes(compositeKey(item)),
  );

  const markNotificationRead = async (item: NotificationItem) => {
    try {
      const response = await fetch(SOURCE_ENDPOINTS[item.source], {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [item.id] }),
      });
      if (!response.ok) {
        return;
      }
      setNotifications((current) =>
        current.map((entry) =>
          entry.source === item.source && entry.id === item.id
            ? { ...entry, readAt: new Date().toISOString() }
            : entry,
        ),
      );
    } catch {
      // ignore
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed top-6 right-6 z-120 flex items-center justify-center w-11 h-11 rounded-full bg-white shadow-lg border border-gray-200 text-gray-700 hover:text-emerald-600"
        aria-label="Open notifications"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V4a2 2 0 10-4 0v1.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 01-6 0"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {unreadCount}
          </span>
        )}
      </button>

      {visibleToasts.length > 0 && (
        <aside className="fixed left-0 top-20 w-full max-w-sm z-110 animate-in slide-in-from-left duration-300 ease-out">
          <div className="space-y-3 px-4">
            {visibleToasts.map((notification) => (
              <div
                key={compositeKey(notification)}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{notification.toastTitle}</p>
                    <p className="text-sm text-emerald-900">{notification.message}</p>
                    <p className="text-xs text-emerald-700 mt-1">
                      {new Date(notification.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissToast(compositeKey(notification))}
                    className="p-1 text-emerald-700 hover:text-emerald-900"
                    aria-label="Dismiss notification"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {isOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-110 bg-black/20"
            onClick={() => setIsOpen(false)}
            aria-label="Close notifications"
          />
          <aside className="fixed left-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-120 animate-in slide-in-from-left duration-300 ease-out">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Notifications</p>
                <p className="text-xs text-gray-500">Tasks, quotes, and trip reminders</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600"
                aria-label="Close notifications"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto h-[calc(100%-72px)]">
              {notifications.length === 0 ? (
                <p className="text-sm text-gray-500">No notifications yet.</p>
              ) : (
                notifications.map((notification) => (
                  <Link
                    key={compositeKey(notification)}
                    href={notification.href}
                    onClick={() => {
                      void markNotificationRead(notification);
                      setIsOpen(false);
                    }}
                    className={`block w-full text-left rounded-xl border p-3 transition-colors ${
                      notification.readAt
                        ? 'border-gray-200 bg-gray-50'
                        : notification.source === 'quote'
                          ? 'border-blue-200 bg-blue-50'
                          : notification.source === 'trip'
                            ? 'border-amber-200 bg-amber-50'
                            : 'border-emerald-200 bg-emerald-50'
                    }`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      {notification.toastTitle}
                    </p>
                    <p className="text-sm text-gray-900 mt-1">{notification.message}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(notification.createdAt).toLocaleString()}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
