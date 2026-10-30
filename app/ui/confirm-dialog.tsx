'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * An in-app "are you sure?". The browser's own confirm() can be switched off
 * by the user ("don't let this page show dialogs again") and then a delete
 * goes through silently; this one always shows. Resolves true when confirmed.
 */
export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red for things that can't be undone; blue for a question. */
  tone?: 'danger' | 'primary';
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A second question before the first is answered cancels the first.
        pendingRef.current?.resolve(false);
        const next = { ...options, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );

  return { confirm, dialog: pending ? <ConfirmDialog {...pending} onAnswer={settle} /> : null };
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onAnswer,
}: ConfirmOptions & { onAnswer: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onAnswer(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAnswer]);

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-end justify-center p-4 sm:items-center" role="presentation">
      <button type="button" aria-label="Cancel" onClick={() => onAnswer(false)} className="absolute inset-0 cursor-default bg-gray-900/40" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-md rounded-2xl border border-gray-100 bg-white p-5 shadow-2xl"
      >
        <h2 id="confirm-dialog-title" className="text-base font-bold text-gray-900">
          {title}
        </h2>
        {message && <div className="mt-2 text-sm leading-relaxed text-gray-600">{message}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onAnswer(true)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${
              tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
