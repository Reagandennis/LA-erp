'use client';

import { useState } from 'react';

import { HANDOVER_STATUSES, SHIFT_PERIODS } from '@/app/modules/handover/types';
import { useNow } from '@/app/ui/use-client';
import type { OpsHandover } from '@/lib/ops-dashboard';

import { Empty, HeaderButton, Panel, type PanelFrame, Pill, RowButton, type Tone, fieldClass, formClass, primaryButton, rowClass, send, shortDate } from './ops-ui';

const STATUS_TONE: Record<string, Tone> = { Urgent: 'danger', Attention: 'warn', Normal: 'neutral' };

/** The night shift runs from 18:00 to 06:00, so those are the shift changes. */
const isNight = (hours: number) => hours >= 18 || hours < 6;

type HandoverForm = { shiftPeriod: string; status: string; post: string; summary: string; watchItems: string };

const blankForm = (): HandoverForm => ({
  shiftPeriod: isNight(new Date().getHours()) ? 'Night' : 'Day',
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
  const now = useNow(60_000);
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
  const nextChange = now === null ? null : isNight(new Date(now).getHours()) ? '06:00' : '18:00';

  return (
    <Panel
      id="ops-handover"
      title="Handovers"
      summary={
        <>
          {nextChange && `Shift change ${nextChange} · `}
          {data.awaiting > 0 ? <span className={urgent ? 'text-rose-600' : 'text-amber-600'}>{data.awaiting} to acknowledge</span> : 'All acknowledged'}
        </>
      }
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
          className={`${formClass} space-y-2`}
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
          <button type="submit" disabled={busy === 'new' || !form.summary.trim()} className={`${primaryButton} w-full`}>
            Hand over
          </button>
        </form>
      )}

      {data.items.length === 0 ? (
        <Empty>Every handover from the last week has been acknowledged.</Empty>
      ) : (
        <ul>
          {data.items.map((h) => (
            <li key={h.id} className={`${rowClass} items-start`}>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium text-gray-900">{h.summary}</p>
                <p className="mt-0.5 truncate text-xs text-gray-500" suppressHydrationWarning>
                  {h.shiftPeriod} shift · {shortDate(h.shiftDate)}
                  {h.post && ` · ${h.post}`}
                  {' · '}
                  {h.author ? `From ${h.author}` : 'Author unknown'}
                </p>
                {h.watchItems && (
                  <p className="mt-1 line-clamp-2 text-xs text-amber-800">
                    <span className="font-bold">Watch: </span>
                    {h.watchItems}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Pill tone={STATUS_TONE[h.status] ?? 'neutral'}>{h.status}</Pill>
                {h.mine ? (
                  <span className="text-[11px] text-gray-400" title="The incoming shift acknowledges it">
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
