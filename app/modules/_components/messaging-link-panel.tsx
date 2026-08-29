'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * QR linking panel shared by the WhatsApp, Telegram and Signal modules.
 *
 * Shows a QR the user scans with the phone app, polls until the handshake
 * completes, then tells the console to reload. The account is always the
 * signed-in user's own — the server takes the user id from the session cookie,
 * never from anything this component sends.
 */

type LinkStatus = 'idle' | 'pending' | 'linked' | 'error' | 'expired';

interface LinkView {
  status: LinkStatus;
  qr: string | null;
  error: string | null;
  label: string | null;
}

const POLL_MS = 2000;

const INSTRUCTIONS: Record<string, string[]> = {
  whatsapp: ['Open WhatsApp on your phone', 'Settings → Linked devices → Link a device', 'Scan this code'],
  signal: ['Open Signal on your phone', 'Settings → Linked devices → +', 'Scan this code'],
  telegram: ['Open Telegram on your phone', 'Settings → Devices → Link Desktop Device', 'Scan this code'],
};

export default function MessagingLinkPanel({
  provider,
  title,
  onLinked,
  children,
}: {
  provider: 'whatsapp' | 'telegram' | 'signal';
  title: string;
  onLinked: () => void;
  /** Optional alternative sign-in (Telegram's phone flow) shown under the QR. */
  children?: React.ReactNode;
}) {
  const [view, setView] = useState<LinkView>({ status: 'idle', qr: null, error: null, label: null });
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/messaging/link?provider=${provider}`, { credentials: 'include' });
      const d = (await r.json().catch(() => null)) as LinkView | null;
      if (!d) return;
      setView(d);
      if (d.status === 'linked') {
        stopPolling();
        onLinked();
      } else if (d.status === 'error' || d.status === 'expired') {
        stopPolling();
      }
    } catch {
      // A dropped poll is not fatal; the next tick retries.
    }
  }, [provider, onLinked, stopPolling]);

  const start = useCallback(async () => {
    setBusy(true);
    stopPolling();
    try {
      const r = await fetch('/api/messaging/link', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const d = (await r.json().catch(() => null)) as (LinkView & { error?: string }) | null;
      setView(
        d ?? { status: 'error', qr: null, error: 'Could not start linking.', label: null },
      );
      if (d?.status === 'pending') {
        pollRef.current = setInterval(() => void poll(), POLL_MS);
      }
    } catch {
      setView({ status: 'error', qr: null, error: 'Could not reach the server.', label: null });
    } finally {
      setBusy(false);
    }
  }, [provider, poll, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const steps = INSTRUCTIONS[provider] ?? [];

  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="text-base font-bold text-gray-900">Link your {title}</h2>
      <p className="mt-1 text-xs text-gray-500">
        Connects your own account. Only you can see these conversations.
      </p>

      {view.status === 'pending' && view.qr ? (
        <div className="mt-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a server-generated
              data: URL, nothing for next/image to optimise. */}
          <img
            src={view.qr}
            alt={`QR code to link ${title}`}
            className="mx-auto h-56 w-56 rounded-xl border border-gray-100"
          />
          <ol className="mt-4 space-y-1.5 text-xs text-gray-600">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-center text-[11px] text-gray-400">Waiting for you to scan…</p>
        </div>
      ) : (
        <div className="mt-4">
          {(view.error || view.status === 'expired') && (
            <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {view.error ?? 'The code expired.'}
            </p>
          )}
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Preparing…' : view.status === 'idle' ? 'Show QR code' : 'Try again'}
          </button>
        </div>
      )}

      {children && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <p className="mb-3 text-center text-[11px] uppercase tracking-wide text-gray-400">
            or
          </p>
          {children}
        </div>
      )}
    </div>
  );
}
