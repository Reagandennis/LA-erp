'use client';

import Link from 'next/link';
import { useState } from 'react';

import { moduleIcon } from '@/app/ui/module-icons';
import { useNow } from '@/app/ui/use-client';
import type { OpsSections } from '@/lib/ops-dashboard';
import { PANEL_ICON } from '@/lib/ops-panels';

import { useFlightDelays } from './board-stores';
import { type AttentionTone, buildAttention } from './ops-model';
import { clock } from './ops-ui';

const SHOWN = 6;

const TONE: Record<AttentionTone, { row: string; icon: string }> = {
  danger: { row: 'border-l-rose-500 bg-rose-50/70 hover:bg-rose-50', icon: 'text-rose-600' },
  warn: { row: 'border-l-amber-400 bg-amber-50/70 hover:bg-amber-50', icon: 'text-amber-600' },
  info: { row: 'border-l-sky-400 bg-sky-50/60 hover:bg-sky-50', icon: 'text-sky-600' },
};

/**
 * Everything on the board someone should act on, most urgent first. Built in
 * the browser from the panels on screen, so it costs no extra request.
 */
export default function AttentionBar({ sections }: Readonly<{ sections: Partial<OpsSections> }>) {
  const now = useNow(30_000);
  const delays = useFlightDelays();
  const [showAll, setShowAll] = useState(false);

  // Nothing is judged before the clock is known in the browser.
  if (now === null) return null;
  const items = buildAttention(sections, now, delays, (iso) => clock(iso));
  const shown = showAll ? items : items.slice(0, SHOWN);
  const danger = items.filter((i) => i.tone === 'danger').length;

  if (items.length === 0) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-5 py-3.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-bold text-emerald-800">All clear</p>
          <p className="text-xs text-emerald-700">Nothing late, delayed, escalated, offline or overdue on the panels you’re showing.</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Needs attention" className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900">
          <span className={`h-2.5 w-2.5 rounded-full ${danger > 0 ? 'animate-pulse bg-rose-500' : 'bg-amber-400'}`} aria-hidden="true" />
          Needs attention
          <span className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold tabular-nums ${danger > 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
            {items.length}
          </span>
        </h2>
        {items.length > SHOWN && (
          <button type="button" onClick={() => setShowAll((s) => !s)} className="text-xs font-bold text-primary hover:underline">
            {showAll ? 'Show fewer' : `Show all ${items.length}`}
          </button>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {shown.map((item) => {
          const style = TONE[item.tone];
          const body = (
            <>
              <span className={`mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4 ${style.icon}`}>{moduleIcon(PANEL_ICON[item.panel])}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900">{item.title}</span>
                {item.detail && <span className="block truncate text-xs text-gray-600">{item.detail}</span>}
              </span>
            </>
          );
          const className = `flex items-start gap-2.5 rounded-lg border-l-4 px-3 py-2 transition-colors ${style.row}`;
          return (
            <li key={item.key}>
              {item.href.startsWith('#') ? (
                <a href={item.href} className={className}>
                  {body}
                </a>
              ) : (
                <Link href={item.href} className={className}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
