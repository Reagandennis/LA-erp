'use client';

import { useState } from 'react';

import { HANDOVER_STATUSES, SHIFT_PERIODS } from '@/app/modules/handover/types';
import type { OpsHandover } from '@/lib/ops-dashboard';

import { Empty, HeaderButton, Panel, type PanelFrame, Pill, RowButton, type Tone, fieldClass, send, shortDate } from './ops-ui';

const STATUS_TONE: Record<string, Tone> = { Urgent: 'danger', Attention: 'warn', Normal: 'neutral' };

type HandoverForm = { shiftPeriod: string; status: string; post: string; summary: string; watchItems: string };

const blankForm = (): HandoverForm => ({
  shiftPeriod: new Date().getHours() >= 18 || new Date().getHours() < 6 ? 'Night' : 'Day',
  status: 'Normal',
  post: '',
  summary: '',
  watchItems: '',
});

/** Handovers still waiting for the incoming shift: read and acknowledge them, or hand over your own. */
export default function HandoverPanel({
  data,
  frame,
  onChanged,
}: Readonly<{ data: OpsHandover; frame: PanelFrame; onChanged: () => Promise<void> }>) {
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<HandoverForm | null>(null);

  const acknowledge = async (id: number) => {
    setBusy(id);
    try {
      if (await send(`/api/handover/${id}/acknowledge`, 'POST')) await onChanged();
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!form || !form.summary.trim()) return;
    setBusy('new');
    try {
      const ok = await send('/api/handover', 'POST', {
        shiftPeriod: form.shiftPeriod,
        status: form.status,
        post: form.post.trim() || null,
        summary: form.summary.trim(),
        watchItems: form.watchItems.trim() || null,
      });
      if (ok) {
        setForm(null);
        await onChanged();
      }
    } finally {
      setBusy(null);
    }
  };

  const urgent = data.items.some((h) => h.status === 'Urgent' && !h.mine);

  return (
    <Panel
      id="ops-handover"
      icon="handover"
      title="Shift handover"
      count={data.awaiting}
      tone={urgent ? 'danger' : 'warn'}
      href="/modules/handover"
      moduleName="Handover"
      frame={frame}
      actions={
        <HeaderButton active={form !== null} onClick={() => setForm((f) => (f ? null : blankForm()))}>
          {form ? 'Close' : '+ Handover'}
        </HeaderButton>
      }
    >
      {form && (
        <form
          className="mb-2 space-y-2 rounded-xl bg-gray-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-3 gap-2">
            <select value={form.shiftPeriod} onChange={(e) => setForm({ ...form, shiftPeriod: e.target.value })} aria-label="Shift" className={fieldClass}>
              {SHIFT_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {p} shift
                </option>
              ))}
            </select>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} aria-label="Status" className={fieldClass}>
              {HANDOVER_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <input value={form.post} onChange={(e) => setForm({ ...form, post: e.target.value })} placeholder="Post (optional)" aria-label="Post" className={fieldClass} />
          </div>
          <textarea
            autoFocus
            rows={3}
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            placeholder="How the shift went, what is still open"
            aria-label="Summary"
            className={`${fieldClass} resize-none`}
          />
          <input
            value={form.watchItems}
            onChange={(e) => setForm({ ...form, watchItems: e.target.value })}
            placeholder="The next shift must watch… (optional)"
            aria-label="Watch items"
            className={fieldClass}
          />
          <button
            type="submit"
            disabled={busy === 'new' || !form.summary.trim()}
            className="w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Hand over
          </button>
        </form>
      )}

      {data.items.length === 0 ? (
        <Empty>Every handover from the last week has been acknowledged.</Empty>
      ) : (
        <ul className="space-y-1.5">
          {data.items.map((h) => (
            <li key={h.id} className="rounded-xl border border-gray-100 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                    <Pill tone={STATUS_TONE[h.status] ?? 'neutral'}>{h.status}</Pill>
                    <span suppressHydrationWarning>
                      {h.shiftPeriod} shift · {shortDate(h.shiftDate)}
                    </span>
                    {h.post && <span>· {h.post}</span>}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-900">{h.summary}</p>
                  {h.watchItems && (
                    <p className="mt-1 line-clamp-2 text-xs text-amber-800">
                      <span className="font-bold">Watch: </span>
                      {h.watchItems}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-gray-400">{h.author ? `From ${h.author}` : 'Author unknown'}</p>
                </div>
                {h.mine ? (
                  <span className="shrink-0 text-[11px] text-gray-400" title="The incoming shift acknowledges it">
                    Yours
                  </span>
                ) : (
                  <RowButton tone="good" onClick={() => void acknowledge(h.id)} disabled={busy === h.id}>
                    Acknowledge
                  </RowButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
