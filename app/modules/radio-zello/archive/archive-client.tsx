'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { APP_LOCALE } from '@/lib/locale';

type Row = {
  id: number;
  network: string;
  channel: string;
  kind: 'voice' | 'text';
  fromName: string;
  direction: 'in' | 'out';
  text: string | null;
  transcript: string | null;
  translation: string | null;
  language: string | null;
  durationMs: number | null;
  hasAudio: boolean;
  at: string;
};

type Filters = {
  channel: string;
  from: string;
  to: string;
  speaker: string;
  kind: '' | 'voice' | 'text';
  q: string;
  withAudio: boolean;
};

const STORAGE_KEY = 'la-erp.zello.config';
const PAGE = 50;

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';
const labelClass = 'block text-xs font-medium text-gray-600 mb-1.5';

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtWhen(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString(APP_LOCALE, { year: 'numeric', month: 'short', day: '2-digit' }),
    time: d.toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

function buildQuery(network: string, f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  p.set('network', network);
  if (f.channel) p.set('channel', f.channel);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.speaker) p.set('speaker', f.speaker);
  if (f.kind) p.set('kind', f.kind);
  if (f.q) p.set('q', f.q);
  if (f.withAudio) p.set('withAudio', '1');
  return p;
}

type Page = { items: Row[]; total: number; nextCursor: number | null; channels: string[]; speakers: string[] };

async function loadArchive(network: string, f: Filters, cursor: number | null): Promise<Page> {
  const p = buildQuery(network, f);
  p.set('limit', String(PAGE));
  if (cursor) p.set('cursor', String(cursor));
  const res = await fetch(`/api/zello/archive?${p.toString()}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Page;
}

/** Play/stop for one stored clip; only one clip plays at a time across the page. */
function ClipButton({ id, durationMs, current, onPlay }: { id: number; durationMs: number | null; current: number | null; onPlay: (id: number | null) => void }) {
  const playing = current === id;
  const secs = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : null;
  return (
    <button
      type="button"
      onClick={() => onPlay(playing ? null : id)}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
        playing ? 'bg-primary text-white' : 'bg-primary/10 text-primary hover:bg-primary/20'
      }`}
      aria-label={playing ? 'Stop' : 'Play recording'}
    >
      {playing ? (
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : (
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
      {secs ? `${secs}s` : 'Play'}
    </button>
  );
}

export default function ArchiveClient({ defaultNetwork }: { defaultNetwork: string }) {
  // The console stores its network in localStorage; prefer that so both views agree.
  // Not rendered anywhere, so a client-only initial value can't cause a hydration mismatch.
  const [network] = useState(() => {
    if (typeof window === 'undefined') return defaultNetwork;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { network?: string } | null;
      return saved?.network?.trim() || defaultNetwork;
    } catch {
      return defaultNetwork;
    }
  });
  const [filters, setFilters] = useState<Filters>(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
    return { channel: '', from: isoDay(from), to: isoDay(to), speaker: '', kind: '', q: '', withAudio: false };
  });
  const [applied, setApplied] = useState<Filters>(filters);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const applyPage = useCallback((d: Page, append: boolean) => {
    setRows((cur) => (append ? [...cur, ...d.items] : d.items));
    setTotal(d.total);
    setNextCursor(d.nextCursor);
    setChannels(d.channels);
    setSpeakers(d.speakers);
    setError(null);
    setLoading(false);
  }, []);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : 'Could not load the archive.');
    setLoading(false);
  }, []);

  // Re-query whenever the applied filters change. State is only touched once the
  // response is in, and a stale response (filters changed again) is dropped.
  useEffect(() => {
    let active = true;
    loadArchive(network, applied, null)
      .then((d) => {
        if (active) applyPage(d, false);
      })
      .catch((e: unknown) => {
        if (active) fail(e);
      });
    return () => {
      active = false;
    };
  }, [network, applied, applyPage, fail]);

  const apply = () => {
    setLoading(true);
    setApplied(filters);
  };
  const loadMore = () => {
    if (!nextCursor) return;
    setLoading(true);
    loadArchive(network, applied, nextCursor)
      .then((d) => applyPage(d, true))
      .catch(fail);
  };
  const reset = () => {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
    const next: Filters = { channel: '', from: isoDay(from), to: isoDay(to), speaker: '', kind: '', q: '', withAudio: false };
    setFilters(next);
    setLoading(true);
    setApplied(next);
  };

  const play = useCallback((id: number | null) => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(id);
    if (id == null) return;
    const a = new Audio(`/api/zello/activity/${id}/audio`);
    a.onended = () => setPlaying((cur) => (cur === id ? null : cur));
    a.onerror = () => setPlaying((cur) => (cur === id ? null : cur));
    audioRef.current = a;
    void a.play();
  }, []);

  useEffect(() => () => audioRef.current?.pause(), []);

  const exportHref = useMemo(() => {
    const p = buildQuery(network, applied);
    return (format: 'csv' | 'zip') => {
      p.set('format', format);
      return `/api/zello/archive/export?${p.toString()}`;
    };
  }, [network, applied]);

  const recordings = rows.filter((r) => r.hasAudio).length;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelClass} htmlFor="arch-channel">Channel</label>
            <select id="arch-channel" value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })} className={inputClass}>
              <option value="">All channels</option>
              {channels.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="arch-speaker">Speaker / sender</label>
            <input id="arch-speaker" list="arch-speakers" value={filters.speaker} onChange={(e) => setFilters({ ...filters, speaker: e.target.value })} placeholder="Anyone" className={inputClass} />
            <datalist id="arch-speakers">
              {speakers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={labelClass} htmlFor="arch-from">From</label>
            <input id="arch-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="arch-to">To</label>
            <input id="arch-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="arch-q">Search transcripts &amp; messages</label>
            <input
              id="arch-q"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') apply();
              }}
              placeholder="e.g. gate 4, vehicle, all clear…"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="arch-kind">Type</label>
            <select id="arch-kind" value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value as Filters['kind'] })} className={inputClass}>
              <option value="">Voice &amp; text</option>
              <option value="voice">Voice only</option>
              <option value="text">Text only</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex cursor-pointer items-center gap-2 pb-2.5 text-sm text-gray-700">
              <input type="checkbox" checked={filters.withAudio} onChange={(e) => setFilters({ ...filters, withAudio: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30" />
              With recording only
            </label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
          <button type="button" onClick={apply} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90">
            Apply filters
          </button>
          <button type="button" onClick={reset} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">
            Reset
          </button>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <a
              href={exportHref('csv')}
              download
              className={`rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 ${total === 0 ? 'pointer-events-none opacity-50' : ''}`}
            >
              Export CSV
            </a>
            <a
              href={exportHref('zip')}
              download
              className={`rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 ${total === 0 ? 'pointer-events-none opacity-50' : ''}`}
            >
              Export with audio (ZIP)
            </a>
          </span>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <p className="text-sm font-semibold text-gray-900">
            {loading && rows.length === 0 ? 'Loading…' : `${total.toLocaleString(APP_LOCALE)} ${total === 1 ? 'entry' : 'entries'}`}
            {rows.length > 0 && <span className="ml-2 text-xs font-normal text-gray-400">showing {rows.length.toLocaleString(APP_LOCALE)} · {recordings} with recordings</span>}
          </p>
          {error && <span className="text-xs font-medium text-rose-600">{error}</span>}
        </div>

        {rows.length === 0 && !loading ? (
          <p className="py-16 text-center text-sm text-gray-400">No traffic matches these filters.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const when = fmtWhen(r.at);
              return (
                <li key={r.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <div className="w-24 shrink-0 text-xs leading-5 text-gray-400">
                    <div className="tabular-nums text-gray-600">{when.time}</div>
                    <div>{when.day}</div>
                  </div>
                  <span
                    className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      r.kind === 'voice' ? 'bg-primary/10 text-primary' : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    {r.kind}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-gray-900">{r.fromName}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">{r.channel}</span>
                      {r.direction === 'out' && <span className="text-[10px] font-medium uppercase text-gray-400">sent</span>}
                      {r.kind === 'voice' &&
                        (r.hasAudio ? (
                          <ClipButton id={r.id} durationMs={r.durationMs} current={playing} onPlay={play} />
                        ) : (
                          <span className="text-xs text-gray-400">{r.durationMs ? `${Math.max(1, Math.round(r.durationMs / 1000))}s · no recording` : 'no recording'}</span>
                        ))}
                      {r.language && <span className="text-[10px] uppercase text-gray-400">{r.language}</span>}
                    </div>
                    {r.kind === 'text' && r.text && <p className="mt-0.5 text-gray-700">{r.text}</p>}
                    {r.kind === 'voice' &&
                      (r.transcript ? (
                        <>
                          <p className="mt-0.5 text-gray-700">{r.transcript}</p>
                          {r.translation && (
                            <p className="mt-0.5 text-xs text-gray-500">
                              <span className="font-semibold text-primary/70">EN</span> {r.translation}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="mt-0.5 text-xs text-gray-300">No transcript</p>
                      ))}
                  </div>
                  {r.hasAudio && (
                    <a
                      href={`/api/zello/activity/${r.id}/audio`}
                      download={`zello_${r.channel}_${r.fromName}_${r.id}.wav`}
                      className="shrink-0 rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-50 hover:text-primary"
                      aria-label="Download recording"
                      title="Download recording"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                      </svg>
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {nextCursor && (
          <div className="border-t border-gray-100 p-3 text-center">
            <button
              type="button"
              disabled={loading}
              onClick={loadMore}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
