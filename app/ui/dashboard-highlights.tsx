'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import type {
  HighlightDefinition,
  HighlightTone,
  HighlightValue,
} from '@/lib/dashboard-highlights';

const TONE_STYLES: Record<HighlightTone, { value: string; dot: string }> = {
  neutral: { value: 'text-white', dot: 'bg-white/40' },
  good: { value: 'text-emerald-300', dot: 'bg-emerald-300' },
  warn: { value: 'text-secondary', dot: 'bg-secondary' },
  danger: { value: 'text-rose-300', dot: 'bg-rose-300' },
};

export function DashboardHighlights({
  initialHighlights,
  available,
  initialSelected,
  slots,
}: Readonly<{
  initialHighlights: HighlightValue[];
  available: HighlightDefinition[];
  initialSelected: string[];
  slots: number;
}>) {
  const [highlights, setHighlights] = useState(initialHighlights);
  const [selected, setSelected] = useState(initialSelected);
  const [draft, setDraft] = useState(initialSelected);
  const [isPicking, setIsPicking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const draftSet = useMemo(() => new Set(draft), [draft]);

  const openPicker = useCallback(() => {
    setDraft(selected);
    setError('');
    setIsPicking(true);
  }, [selected]);

  const toggle = useCallback(
    (key: string) => {
      setError('');
      setDraft((current) => {
        if (current.includes(key)) {
          return current.filter((entry) => entry !== key);
        }

        if (current.length >= slots) {
          setError(`You can show ${slots} highlights at a time — remove one first.`);
          return current;
        }

        return [...current, key];
      });
    },
    [slots],
  );

  const save = useCallback(async () => {
    setIsSaving(true);
    setError('');

    try {
      const response = await fetch('/api/dashboard/highlights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ keys: draft }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Could not save your highlights');
        return;
      }

      setHighlights(data.highlights);
      setSelected(data.selected);
      setIsPicking(false);
    } catch (caughtError) {
      console.error(caughtError);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [draft]);

  return (
    <div className="relative z-10 w-full lg:w-auto lg:min-w-[420px]">
      <div className="flex items-center justify-between mb-4 px-1">
        <h3 className="text-white/60 text-xs uppercase font-bold tracking-[0.2em]">
          Your highlights
        </h3>
        <button
          type="button"
          onClick={isPicking ? () => setIsPicking(false) : openPicker}
          className="text-white/60 hover:text-secondary transition-colors text-xs font-bold flex items-center gap-1.5"
        >
          {isPicking ? 'Cancel' : 'Customize'}
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {isPicking ? (
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-5">
          <p className="text-white/60 text-xs mb-4">
            Choose up to {slots}. {draft.length}/{slots} selected.
          </p>

          <div className="max-h-72 overflow-y-auto pr-1 space-y-2">
            {available.map((option) => {
              const checked = draftSet.has(option.key);

              return (
                <label
                  key={option.key}
                  className={`flex items-start gap-3 p-3 rounded-2xl cursor-pointer border transition-colors ${
                    checked
                      ? 'bg-secondary/20 border-secondary/50'
                      : 'bg-white/5 border-transparent hover:bg-white/10'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(option.key)}
                    className="mt-1 accent-secondary w-4 h-4 shrink-0"
                  />
                  <span>
                    <span className="block text-white font-bold text-sm">{option.label}</span>
                    <span className="block text-white/50 text-xs leading-relaxed">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          {error && <p className="text-rose-300 text-xs mt-3">{error}</p>}

          <button
            type="button"
            onClick={save}
            disabled={isSaving}
            className="mt-4 w-full py-3 bg-secondary text-primary rounded-2xl font-bold text-sm hover:bg-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving…' : 'Save highlights'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {highlights.map((highlight) => {
            const tone = TONE_STYLES[highlight.tone] ?? TONE_STYLES.neutral;

            return (
              <Link
                key={highlight.key}
                href={highlight.href}
                className="group bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-5 hover:bg-white/20 hover:border-white/40 transition-all"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                  <span className="text-white/60 text-[10px] uppercase font-bold tracking-[0.15em] truncate">
                    {highlight.label}
                  </span>
                </div>
                <div className={`text-4xl font-bold leading-none mb-2 ${tone.value}`}>
                  {highlight.value}
                </div>
                <div className="text-white/50 text-xs leading-snug">{highlight.caption}</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
