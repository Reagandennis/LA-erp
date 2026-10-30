'use client';

import type { OpsVehicles } from '@/lib/ops-dashboard';

import { Empty, Panel, type PanelFrame, type Segment, StackedBar, TONE_SOLID, TONE_TEXT, type Tone, rowClass } from './ops-ui';

/** The register's statuses (app/modules/vehicles), in the order the bar shows them. */
const STATUSES: { status: string; tone: Tone }[] = [
  { status: 'Available', tone: 'good' },
  { status: 'Assigned', tone: 'info' },
  { status: 'Maintenance', tone: 'warn' },
  { status: 'Off duty', tone: 'danger' },
];

/** The fleet by status: how much of it is on the road, and how much is out. */
export default function VehiclesPanel({ data, frame }: Readonly<{ data: OpsVehicles; frame: PanelFrame }>) {
  const count = (status: string) => data.byStatus.find((row) => row.status === status)?.count ?? 0;
  const segments: Segment[] = [
    ...STATUSES.map(({ status, tone }) => ({ label: status, value: count(status), tone })),
    // Anything the register holds beyond the four it offers.
    ...data.byStatus.filter((row) => !STATUSES.some((s) => s.status === row.status)).map((row) => ({ label: row.status, value: row.count, tone: 'neutral' as const })),
  ];

  return (
    <Panel id="ops-vehicles" title="Vehicles" summary={`${data.total} in fleet`} href="/modules/vehicles" moduleName="Vehicles" frame={frame}>
      {data.total === 0 ? (
        <Empty>No vehicles in the register yet.</Empty>
      ) : (
        <>
          <div className="border-b border-gray-100 py-4">
            <StackedBar segments={segments} legend={false} />
          </div>
          <ul>
            {segments.map((s) => (
              <li key={s.label} className={rowClass}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_SOLID[s.tone]}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{s.label}</span>
                <span className={`text-sm font-semibold tabular-nums ${s.value > 0 && (s.tone === 'warn' || s.tone === 'danger') ? TONE_TEXT[s.tone] : 'text-gray-900'}`}>
                  {s.value}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
