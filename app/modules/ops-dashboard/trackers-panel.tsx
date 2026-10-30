'use client';

import Link from 'next/link';

import { timeAgo } from '@/app/modules/map/map-format';
import { useNow } from '@/app/ui/use-client';
import type { TrackedDevice } from '@/lib/map-types';
import type { OpsTrackers } from '@/lib/ops-dashboard';

import { type TrackerState, isMoving, trackerState, trackerTally } from './ops-model';
import { Empty, Panel, type PanelFrame, Pill, type Tone, mono, rowClass, subClass } from './ops-ui';

/** Rows on the card; the rest are a click away on the map. */
const ROWS = 8;

const STATE: Record<TrackerState, { label: string; tone: Tone; rank: number }> = {
  offline: { label: 'Offline', tone: 'danger', rank: 0 },
  low: { label: 'Low battery', tone: 'warn', rank: 1 },
  stale: { label: 'Stale', tone: 'warn', rank: 2 },
  online: { label: 'Online', tone: 'good', rank: 3 },
};

/** What is wrong with it, or how it is doing: "No signal · last fix 3h ago", "Battery 9%", "Ping 4s ago". */
function describe(device: TrackedDevice, state: TrackerState, now: number): string {
  const ago = timeAgo(device.at, now);
  switch (state) {
    case 'offline':
      return `No signal · last fix ${ago}`;
    case 'stale':
      return `Last fix ${ago}`;
    case 'low':
      return `Battery ${device.batteryPct}%${isMoving(device, now) ? ` · ${Math.round(device.speedKph!)} km/h` : ''}`;
    case 'online':
      return isMoving(device, now) ? `${Math.round(device.speedKph!)} km/h · ping ${ago}` : `Ping ${ago}`;
  }
}

/** The trackers that need attention first (offline, low battery, stale), then the rest. */
export default function TrackersPanel({ data, frame }: Readonly<{ data: OpsTrackers; frame: PanelFrame }>) {
  const now = useNow(30_000);
  const tally = now === null ? null : trackerTally(data.devices, now);
  const rows = data.devices
    .map((device) => ({ device, state: now === null ? null : trackerState(device, now) }))
    .sort((a, b) => (a.state && b.state ? STATE[a.state].rank - STATE[b.state].rank : 0) || a.device.name.localeCompare(b.device.name));
  const shown = rows.slice(0, ROWS);

  const summary = !data.configured ? (
    'No tracking source'
  ) : tally === null ? (
    `${data.devices.length} trackers`
  ) : tally.attention > 0 ? (
    <span className={tally.offline > 0 ? 'text-rose-600' : 'text-amber-600'}>{tally.attention} need attention</span>
  ) : (
    `All ${tally.total} online`
  );

  return (
    <Panel id="ops-trackers" title="Trackers" summary={summary} href="/modules/map" moduleName="Map" frame={frame}>
      {!data.configured ? (
        <Empty>No tracking source is configured. Set TRACCAR_URL and TRACCAR_TOKEN, or the ZELLO_* variables.</Empty>
      ) : data.devices.length === 0 ? (
        <Empty>{data.error ?? 'No tracker has reported a position yet.'}</Empty>
      ) : (
        <>
          {data.error && <p className="border-b border-gray-100 py-2 text-xs text-amber-700">{data.error}</p>}
          <ul>
            {shown.map(({ device, state }) => (
              <li key={device.key} className={rowClass}>
                <span className={`${mono} w-28 shrink-0 truncate text-xs text-gray-500`} title={device.uniqueId ? `${device.name} · ${device.uniqueId}` : device.name}>
                  {device.name}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{state && now !== null ? describe(device, state, now) : '…'}</span>
                  {device.address && <span className={subClass}>{device.address}</span>}
                </span>
                {state && <Pill tone={STATE[state].tone}>{STATE[state].label}</Pill>}
              </li>
            ))}
          </ul>
          {rows.length > ROWS && (
            <Link href="/modules/map" className="block pt-2 text-xs font-bold text-primary hover:underline">
              {rows.length - ROWS} more on the map →
            </Link>
          )}
        </>
      )}
    </Panel>
  );
}
