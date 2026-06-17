'use client';

import React, { useState } from 'react';

import type { AssessmentDetail, AssessmentSummary, IntelData } from './types';

const BRAND = '#03458f';

function riskTone(level: string): string {
  switch (level) {
    case 'Extreme':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'High':
      return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'Moderate':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'Low':
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

export default function IntelClient({
  initialData,
  configured,
}: {
  initialData: IntelData;
  configured: boolean;
}) {
  const [assessments, setAssessments] = useState<AssessmentSummary[]>(initialData.assessments);
  const [stats, setStats] = useState(initialData.stats);
  const [location, setLocation] = useState('');
  const [context, setContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AssessmentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const reloadList = async () => {
    try {
      const res = await fetch('/api/intel', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as IntelData;
      setAssessments(data.assessments);
      setStats(data.stats);
    } catch {
      // ignore
    }
  };

  const generate = async () => {
    if (!location.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/intel', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: location.trim(), context: context.trim() || null }),
      });
      const payload = (await res.json().catch(() => null)) as { item?: AssessmentDetail; error?: string } | null;
      if (!res.ok || !payload?.item) {
        setError(payload?.error ?? 'Could not generate the assessment.');
        return;
      }
      setSelected(payload.item);
      setLocation('');
      setContext('');
      await reloadList();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const openDetail = async (id: number) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await fetch(`/api/intel/${id}`, { credentials: 'include' });
      const payload = (await res.json().catch(() => null)) as { item?: AssessmentDetail } | null;
      if (res.ok && payload?.item) setSelected(payload.item);
    } finally {
      setLoadingDetail(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Delete this assessment? This cannot be undone.')) return;
    const res = await fetch(`/api/intel/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      if (selected?.id === id) setSelected(null);
      await reloadList();
    }
  };

  if (selected) {
    return <ReportView detail={selected} onBack={() => setSelected(null)} onDelete={() => remove(selected.id)} />;
  }

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Intel</h1>
        <p className="text-sm text-gray-500 mt-1">
          AI security &amp; travel-risk assessments for any location — grounded in current sources, with a map and
          recommendations.
        </p>
      </div>

      {!configured && (
        <div className="mb-5 px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800">
          The AI service isn&apos;t configured yet. Set <code className="font-mono">AI_ASSISTANT_API_KEY</code> to enable
          assessments.
        </div>
      )}

      {/* Generator */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6">
        <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Location or place</label>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) generate();
          }}
          placeholder="e.g. Eastleigh, Nairobi · Tripoli, Libya · JKIA Airport"
          className={inputClass}
          disabled={generating}
        />
        <label className="text-xs font-semibold text-gray-500 mb-1.5 mt-4 block">Purpose / context (optional)</label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
          placeholder="e.g. Client executive visit, hotel stay near the CBD, 3-day detail"
          className={inputClass}
          disabled={generating}
        />
        <div className="flex items-center justify-between mt-4 gap-3">
          <p className="text-xs text-gray-400">Generation can take up to a minute while the AI researches and sources the report.</p>
          <button
            onClick={generate}
            disabled={generating || !location.trim() || !configured}
            className="shrink-0 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {generating ? 'Assessing…' : 'Generate assessment'}
          </button>
        </div>
        {generating && (
          <div className="mt-4 flex items-center gap-3 text-sm text-gray-500">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-gray-300 border-t-[#03458f] animate-spin" />
            Researching the location, gathering current sources and imagery…
          </div>
        )}
        {error && <div className="mt-4 px-4 py-3 bg-rose-50 border border-rose-100 rounded-xl text-sm text-rose-700">{error}</div>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Assessments', value: stats.total },
          { label: 'High / Extreme', value: stats.high },
          { label: 'Last 7 days', value: stats.recent },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="text-2xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* History */}
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent assessments</h2>
      {assessments.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center text-sm text-gray-500">
          No assessments yet. Enter a location above to generate your first report.
        </div>
      ) : (
        <div className="space-y-2">
          {assessments.map((a) => (
            <button
              key={a.id}
              onClick={() => openDetail(a.id)}
              disabled={loadingDetail}
              className="w-full text-left bg-white border border-gray-100 rounded-2xl p-4 flex items-center justify-between gap-4 hover:border-gray-200 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${riskTone(a.riskLevel)}`}>{a.riskLevel}</span>
                  <span className="text-[11px] text-gray-400">{formatDate(a.createdAt)}</span>
                </div>
                <div className="font-semibold text-gray-900 truncate">{a.title}</div>
                <div className="text-xs text-gray-500 truncate">{a.formattedAddress ?? a.location}</div>
              </div>
              <span className="shrink-0 text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportView({
  detail,
  onBack,
  onDelete,
}: {
  detail: AssessmentDetail;
  onBack: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="p-6 sm:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-5">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-900">← Back</button>
        <div className="flex items-center gap-2">
          <a
            href={`/api/intel/${detail.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: BRAND }}
          >
            Download PDF
          </a>
          <button onClick={onDelete} className="px-3 py-2 rounded-xl text-sm font-medium text-rose-600 hover:bg-rose-50">
            Delete
          </button>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 mb-2">
        <h1 className="text-2xl font-bold text-gray-900">{detail.title}</h1>
        <span className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-full border ${riskTone(detail.riskLevel)}`}>
          {detail.riskLevel} risk
        </span>
      </div>
      <p className="text-sm text-gray-500">{detail.formattedAddress ?? detail.location}</p>
      <p className="text-xs text-gray-400 mt-1">
        Generated {formatDate(detail.createdAt)}
        {detail.createdBy ? ` · ${detail.createdBy.name}` : ''}
        {detail.model ? ` · ${detail.model}` : ''}
      </p>

      {/* Imagery */}
      {(detail.hasMap || detail.hasStreet) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          {detail.hasMap && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/intel/${detail.id}/image/map`}
                alt="Location map"
                className="w-full h-44 object-cover rounded-xl border border-gray-200"
              />
              <figcaption className="text-[11px] text-gray-400 mt-1 text-center">Location map</figcaption>
            </figure>
          )}
          {detail.hasStreet && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/intel/${detail.id}/image/street`}
                alt="Street view"
                className="w-full h-44 object-cover rounded-xl border border-gray-200"
              />
              <figcaption className="text-[11px] text-gray-400 mt-1 text-center">Street view</figcaption>
            </figure>
          )}
        </div>
      )}

      {detail.context && (
        <p className="mt-5 text-sm text-gray-500 italic">Brief: {detail.context}</p>
      )}

      {/* Executive summary */}
      <div className="mt-6 bg-slate-50 border border-slate-100 rounded-2xl p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#03458f] mb-2">Executive summary</h2>
        <p className="text-sm text-gray-800 leading-relaxed">{detail.summary}</p>
      </div>

      {/* Sections */}
      <div className="mt-6 space-y-5">
        {detail.sections.map((s, i) => (
          <div key={i}>
            <h3 className="text-base font-bold text-gray-900 mb-1">{s.heading}</h3>
            <p className="text-sm text-gray-700 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>

      {/* Recommendations */}
      {detail.recommendations.length > 0 && (
        <div className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#03458f] mb-3">Recommendations</h2>
          <ul className="space-y-2">
            {detail.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-gray-700">
                <span className="text-[#03458f] font-bold leading-relaxed">•</span>
                <span className="leading-relaxed">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sources */}
      {detail.sources.length > 0 && (
        <div className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#03458f] mb-3">Sources</h2>
          <ol className="space-y-1.5">
            {detail.sources.map((src, i) => (
              <li key={i} className="text-xs text-gray-500">
                {i + 1}.{' '}
                <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-[#03458f] hover:underline break-all">
                  {src.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="mt-8 text-[11px] text-gray-400 italic leading-relaxed">
        This assessment is AI-generated from open-source information for operational planning. Verify against
        authoritative government travel advisories before relying on it for safety-critical decisions.
      </p>
    </div>
  );
}
