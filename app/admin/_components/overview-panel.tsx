'use client';

import { ColumnChart, viz } from '@/app/modules/reports/charts';
import { APP_LOCALE } from '@/lib/locale';

import type { AdminOverview, AdminRole, AdminTab, AttentionItem, AuditLogEntry } from './admin-types';
import { Card, StatTile, describeAction, relativeTime } from './admin-ui';

const TONE_STYLES: Record<AttentionItem['tone'], { ring: string; dot: string; label: string }> = {
  critical: { ring: 'border-rose-200 bg-rose-50/60', dot: 'bg-rose-500', label: 'Urgent' },
  warning: { ring: 'border-amber-200 bg-amber-50/60', dot: 'bg-amber-500', label: 'Check' },
  info: { ring: 'border-gray-200 bg-gray-50', dot: 'bg-[#03458f]', label: 'Note' },
};

const HEALTH_STYLES = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'OK' },
  warning: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Needs a look' },
  down: { dot: 'bg-rose-500', text: 'text-rose-700', label: 'Down' },
} as const;

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric' });
}

export default function OverviewPanel({
  overview,
  roles,
  recent,
  now,
  onNavigate,
}: {
  overview: AdminOverview;
  roles: AdminRole[];
  recent: AuditLogEntry[];
  /** Clock for relative times; starts at the server's render time so hydration matches. */
  now: number;
  onNavigate: (tab: AdminTab, filter?: string) => void;
}) {
  const { users, signIns } = overview;
  const customRoles = roles.filter((r) => !r.isAdmin).length;
  const chartData = signIns.daily.map((d) => ({ label: dayLabel(d.date), values: [d.succeeded, d.failed] }));
  const totalSignIns = signIns.daily.reduce((n, d) => n + d.succeeded, 0);
  const totalFailed = signIns.daily.reduce((n, d) => n + d.failed, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="People"
          value={users.total}
          hint={`${users.active} active${users.suspended ? ` · ${users.suspended} suspended` : ''}${users.inactive ? ` · ${users.inactive} inactive` : ''}`}
        />
        <StatTile
          label="Active now"
          value={overview.activeNow}
          hint={`${overview.activeSessions} signed-in session${overview.activeSessions === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Sign-ins, last 24 h"
          value={signIns.last24h.succeeded}
          hint={
            signIns.last24h.failed > 0 ? (
              <span className="text-rose-700">{signIns.last24h.failed} failed</span>
            ) : (
              'No failed attempts'
            )
          }
        />
        <StatTile
          label="Roles"
          value={roles.length}
          hint={`${users.admins} admin${users.admins === 1 ? '' : 's'} · ${customRoles} other role${customRoles === 1 ? '' : 's'}`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card
          title="Needs attention"
          description={overview.attention.length ? 'Worth a look, most important first.' : undefined}
          className="lg:col-span-3"
        >
          {overview.attention.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-emerald-50/70 px-4 py-3.5 text-sm text-emerald-800">
              <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              All clear. Nothing needs your attention right now.
            </div>
          ) : (
            <ul className="space-y-2.5">
              {overview.attention.map((item) => {
                const tone = TONE_STYLES[item.tone];
                return (
                  <li key={item.id} className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center ${tone.ring}`}>
                    <div className="flex min-w-0 flex-1 gap-3">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          <span className="sr-only">{tone.label}: </span>
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-600">{item.detail}</p>
                      </div>
                    </div>
                    {item.action && (
                      <button
                        type="button"
                        onClick={() => onNavigate(item.action!.tab, item.action!.filter)}
                        className="shrink-0 self-start rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#03458f] ring-1 ring-inset ring-[#03458f]/20 hover:bg-blue-50 sm:self-center"
                      >
                        {item.action.label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="System health" description={`Checked ${relativeTime(overview.generatedAt, now).toLowerCase()}`} className="lg:col-span-2">
          <ul className="divide-y divide-gray-100">
            {overview.health.map((check) => {
              const style = HEALTH_STYLES[check.state];
              return (
                <li key={check.name} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{check.name}</p>
                    <p className="text-xs text-gray-500">{check.detail}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold ${style.text}`}>
                    <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden="true" />
                    {style.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card
          title="Sign-ins, last 14 days"
          description={`${totalSignIns} successful · ${totalFailed} failed`}
          className="lg:col-span-3"
        >
          <ColumnChart
            data={chartData}
            height={200}
            series={[
              { name: 'Signed in', color: viz.series[0] },
              { name: 'Failed', color: viz.status.critical },
            ]}
          />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">Show as table</summary>
            <div className="mt-2 max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-gray-500">
                  <tr>
                    <th className="py-1 font-medium">Day</th>
                    <th className="py-1 text-right font-medium">Signed in</th>
                    <th className="py-1 text-right font-medium">Failed</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-gray-700">
                  {[...signIns.daily].reverse().map((d) => (
                    <tr key={d.date} className="border-t border-gray-100">
                      <td className="py-1">{dayLabel(d.date)}</td>
                      <td className="py-1 text-right">{d.succeeded}</td>
                      <td className="py-1 text-right">{d.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>

        <Card
          title="Recent activity"
          action={
            <button type="button" onClick={() => onNavigate('audit')} className="text-xs font-semibold text-[#03458f] hover:underline">
              Audit log →
            </button>
          }
          className="lg:col-span-2"
        >
          {recent.length === 0 ? (
            <p className="text-sm text-gray-500">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {recent.slice(0, 7).map((log) => (
                <li key={log.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">{describeAction(log.action)}</p>
                    <p className="truncate text-xs text-gray-500">
                      {log.actor?.name ?? 'System'}
                      {log.target && log.target.id !== log.actor?.id ? ` → ${log.target.name}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">{relativeTime(log.createdAt, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
