'use client';

import { useState } from 'react';

import { adminFetch, errorMessage } from '@/app/admin/_components/admin-api';
import { Card, inputClass, primaryButton, StatTile } from '@/app/admin/_components/admin-ui';
import { useBanner } from '@/app/ui/banner';
import type { AiUsageOverview } from '@/lib/ai-budget';

type Settings = AiUsageOverview['settings'];

const FEATURES: Record<string, string> = {
  chatbot: 'Assistant',
  web_search: 'Web search (assistant)',
  intel: 'Intel reports',
  radio: 'Radio transcription',
};

const usd = (value: number) => (value > 0 && value < 0.01 ? '< $0.01' : `$${value.toFixed(2)}`);

function Meter({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 1;
  const colour = ratio >= 1 ? 'bg-rose-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-[#03458f]';
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className={`h-full rounded-full ${colour}`} style={{ width: `${Math.max(ratio * 100, value > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

function Toggle({ checked, onChange, label, detail }: { checked: boolean; onChange: (v: boolean) => void; label: string; detail: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 text-left transition hover:bg-gray-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="mt-0.5 block text-xs text-gray-500">{detail}</span>
      </span>
      <span aria-hidden="true" className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${checked ? 'bg-[#03458f]' : 'bg-gray-300'}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  step = 1,
  prefix,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  prefix?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <span className="relative mt-1 block">
        {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{prefix}</span>}
        <input
          type="number"
          min={0}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className={`${inputClass} tabular-nums ${prefix ? 'pl-7' : ''}`}
        />
      </span>
      <span className="mt-1 block text-[11px] text-gray-400">{hint}</span>
    </label>
  );
}

export default function AiUsageClient({ initial, emailConfigured }: { initial: AiUsageOverview; emailConfigured: boolean }) {
  const banner = useBanner();
  const [overview, setOverview] = useState(initial);
  const [draft, setDraft] = useState<Settings>(initial.settings);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(overview.settings);
  const s = overview.settings;
  const peak = Math.max(...overview.days.map((d) => d.costUsd), s.dailyBudgetUsd * 0.25, 0.01);

  const save = async () => {
    setSaving(true);
    try {
      const next = await adminFetch<AiUsageOverview>('/api/admin/ai-usage', { method: 'PUT', body: JSON.stringify(draft) });
      setOverview(next);
      setDraft(next.settings);
      banner.success('AI limits saved', 'They apply to the next request.');
    } catch (error) {
      banner.error(errorMessage(error, 'Could not save the limits.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {!s.enabled && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="font-semibold">AI features are switched off.</span> The assistant, Intel reports and radio transcription won’t call Gemini until they’re switched back on below.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Today (UTC)" value={usd(overview.todayUsd)} hint={<>of {usd(s.dailyBudgetUsd)} a day<Meter value={overview.todayUsd} max={s.dailyBudgetUsd} /></>} />
        <StatTile label="This month" value={usd(overview.monthUsd)} hint={<>of {usd(s.monthlyBudgetUsd)} a month<Meter value={overview.monthUsd} max={s.monthlyBudgetUsd} /></>} />
        <StatTile
          label="Web searches this month"
          value={overview.groundedThisMonth.toLocaleString('en-US')}
          hint={<>of {overview.freeGroundedPerMonth.toLocaleString('en-US')} free, then $14 per 1,000<Meter value={overview.groundedThisMonth} max={overview.freeGroundedPerMonth} /></>}
        />
        <StatTile label="Gemini calls this month" value={overview.byFeature.reduce((n, f) => n + f.calls, 0).toLocaleString('en-US')} hint="Every call is recorded with its tokens" />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="Last 30 days" description="Estimated from Google’s published prices; Google’s own bill is the final word." className="lg:col-span-3">
          <div className="flex h-36 items-end gap-1" aria-label="Daily AI spend, last 30 days">
            {overview.days.map((d) => (
              <div key={d.day} className="group relative flex h-full flex-1 items-end">
                <div
                  className={`w-full rounded-t ${d.costUsd >= s.dailyBudgetUsd ? 'bg-rose-400' : 'bg-[#03458f]/70 group-hover:bg-[#03458f]'}`}
                  style={{ height: `${d.costUsd > 0 ? Math.max(3, (d.costUsd / peak) * 100) : 0}%` }}
                />
                <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-white group-hover:block">
                  {d.day.slice(5)}: {usd(d.costUsd)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-gray-400">
            <span>{overview.days[0]?.day.slice(5)}</span>
            <span>today</span>
          </div>
        </Card>

        <Card title="This month by feature" className="lg:col-span-2">
          {overview.byFeature.length === 0 ? (
            <p className="text-sm text-gray-500">No AI use yet this month.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {[...overview.byFeature].sort((a, b) => b.costUsd - a.costUsd).map((f) => (
                  <tr key={f.feature}>
                    <td className="py-2 text-gray-700">{FEATURES[f.feature] ?? f.feature}</td>
                    <td className="py-2 text-right tabular-nums text-gray-500">{f.calls.toLocaleString('en-US')} calls</td>
                    <td className="py-2 text-right font-medium tabular-nums text-gray-900">{usd(f.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {overview.byUser.length > 0 && (
            <>
              <h4 className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Top people</h4>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {overview.byUser.map((u) => (
                    <tr key={u.userId ?? 'system'}>
                      <td className="truncate py-1.5 text-gray-700">{u.name}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums text-gray-900">{usd(u.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
      </div>

      <Card title="Limits" description="When a budget is used up, AI features pause until the next day or month (UTC). Allowances reset at midnight UTC.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Toggle checked={draft.enabled} onChange={(v) => set('enabled', v)} label="AI features" detail="Master switch for the assistant, Intel reports and radio transcription." />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Daily budget" hint="Pause AI for the rest of the day" prefix="$" step={0.5} value={draft.dailyBudgetUsd} onChange={(v) => set('dailyBudgetUsd', v)} />
              <NumberField label="Monthly budget" hint="Pause AI for the rest of the month" prefix="$" step={5} value={draft.monthlyBudgetUsd} onChange={(v) => set('monthlyBudgetUsd', v)} />
            </div>
            <Toggle checked={draft.radioTranscription} onChange={(v) => set('radioTranscription', v)} label="Radio transcription" detail="Transcribe and translate each radio transmission (once, however many consoles are open)." />
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Assistant" hint="messages per person a day" value={draft.chatMessagesPerUserPerDay} onChange={(v) => set('chatMessagesPerUserPerDay', Math.round(v))} />
              <NumberField label="Web searches" hint="a day, for everyone" value={draft.webSearchesPerDay} onChange={(v) => set('webSearchesPerDay', Math.round(v))} />
              <NumberField label="Intel reports" hint="per person a day" value={draft.intelReportsPerUserPerDay} onChange={(v) => set('intelReportsPerUserPerDay', Math.round(v))} />
            </div>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Email at 80% and 100% of the monthly budget</span>
              <input value={draft.alertEmails} onChange={(e) => set('alertEmails', e.target.value)} placeholder="it@company.com, owner@company.com" className={`${inputClass} mt-1`} />
              {!emailConfigured && <span className="mt-1 block text-xs text-amber-700">Email isn’t configured on this server, so alerts can’t be sent yet (Admin → Settings → Email).</span>}
            </label>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => void save()} disabled={!dirty || saving} className={primaryButton}>
            {saving ? 'Saving…' : 'Save limits'}
          </button>
        </div>
      </Card>

      <Card title="The hard stop is at Google" description="These limits are the platform’s own brake. A leaked key used elsewhere bypasses them, so also cap spending on Google’s side.">
        <ol className="list-decimal space-y-1.5 pl-5 text-xs text-gray-600">
          <li>
            Prepay a small balance in{' '}
            <a className="font-medium text-[#03458f] hover:underline" href="https://aistudio.google.com/billing" target="_blank" rel="noreferrer">AI Studio → Billing</a>{' '}
            and leave auto-reload off. At $0 every key stops — the only guaranteed cap.
          </li>
          <li>
            Set a monthly cap in{' '}
            <a className="font-medium text-[#03458f] hover:underline" href="https://aistudio.google.com/spend" target="_blank" rel="noreferrer">AI Studio → Spend</a>{' '}
            as a second line (Google marks it experimental).
          </li>
          <li>Restrict the API key to the Generative Language API in Google Cloud Console → Credentials.</li>
        </ol>
      </Card>
    </div>
  );
}
