'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import ZelloMap, { type MapDevice } from '../radio-zello/zello-map';

type LocationsResponse = {
  devices?: Record<string, unknown>[];
  source?: string;
  total?: number;
  error?: string;
};

function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Live within 5 min, recent within an hour, otherwise stale.
function freshnessDot(at: number, now: number): string {
  const min = (now - at) / 60000;
  if (min <= 5) return 'bg-emerald-500';
  if (min <= 60) return 'bg-amber-500';
  return 'bg-gray-300';
}

export default function MapClient() {
  const [devices, setDevices] = useState<MapDevice[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [mapFocus, setMapFocus] = useState<{ from: string; n: number } | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/zello/locations', { credentials: 'include' });
      const data = (await res.json().catch(() => null)) as LocationsResponse | null;
      const list: MapDevice[] = (data?.devices ?? [])
        .map((it) => ({
          from: String(it.device ?? ''),
          lat: Number(it.latitude),
          lon: Number(it.longitude),
          accuracy: typeof it.accuracy === 'number' ? it.accuracy : undefined,
          at: new Date(String(it.at)).getTime(),
          address: it.address ? String(it.address) : undefined,
        }))
        .filter((x) => x.from && Number.isFinite(x.lat) && Number.isFinite(x.lon));
      setDevices(list);
      setConfigured(data?.source === 'zellowork');
      setNotice(
        data?.source === 'zellowork'
          ? null
          : data?.error ?? 'No Zello Work network is configured. Set the ZELLO_* environment variables to track devices network-wide.',
      );
      setUpdatedAt(Date.now());
      setNow(Date.now());
    } catch {
      setNotice('Could not reach the location service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const sortedDevices = useMemo(() => [...devices].sort((a, b) => a.from.localeCompare(b.from)), [devices]);
  const focus = (from: string) => setMapFocus((p) => ({ from, n: (p?.n ?? 0) + 1 }));

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Map</h1>
            <p className="mt-1 text-sm text-gray-500">
              Live positions of active Zello devices across the network.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {updatedAt && (
              <span className="text-xs text-gray-400">Updated {timeAgo(updatedAt, now)}</span>
            )}
            <button
              type="button"
              onClick={() => setFitNonce((n) => n + 1)}
              disabled={sortedDevices.length === 0}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              Fit all
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
          <SummaryCard label="Active devices" value={`${sortedDevices.length}`} accent="text-primary" />
          <SummaryCard
            label="Live (≤5m)"
            value={`${sortedDevices.filter((d) => now - d.at <= 5 * 60_000).length}`}
          />
          <SummaryCard
            label="Recent (≤1h)"
            value={`${sortedDevices.filter((d) => now - d.at <= 60 * 60_000).length}`}
          />
          <SummaryCard label="Source" value={configured ? 'Zello Work' : '—'} />
        </div>

        {notice && (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Device roster */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-gray-100 bg-white p-3">
              <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Devices</h2>
              {loading && sortedDevices.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-sm text-gray-400">Loading…</div>
              ) : sortedDevices.length === 0 ? (
                <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-gray-200 px-4 text-center text-sm text-gray-400">
                  No devices sharing location yet.
                </div>
              ) : (
                <div className="max-h-[28rem] divide-y divide-gray-50 overflow-y-auto rounded-xl border border-gray-100">
                  {sortedDevices.map((d, i) => (
                    <button
                      key={d.from}
                      type="button"
                      onClick={() => focus(d.from)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50"
                      title="Show on map"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{d.from}</span>
                        <span className="block truncate text-[11px] text-gray-400">
                          {timeAgo(d.at, now)}
                          {d.accuracy ? ` · ±${Math.round(d.accuracy)}m` : ''}
                          {d.address ? ` · ${d.address}` : ''}
                        </span>
                      </span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${freshnessDot(d.at, now)}`} aria-hidden />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Map */}
          <div className="lg:col-span-2">
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white p-1">
              <ZelloMap devices={sortedDevices} focus={mapFocus} fitNonce={fitNonce} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold lg:text-2xl ${accent}`}>{value}</p>
    </div>
  );
}
