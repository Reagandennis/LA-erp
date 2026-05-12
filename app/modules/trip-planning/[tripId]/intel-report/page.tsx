import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  BadgeAlert,
  Calendar,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Download,
  FileText,
  MapPin,
  Route,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

import { getServerAuth } from '@/lib/auth';
import { ensureTripIntelReportForTrip } from '@/lib/intel-report';
import { prisma } from '@/lib/prisma';

type IntelReportSectionView = Awaited<
  ReturnType<typeof ensureTripIntelReportForTrip>
>['sections'][number];

const SECTION_STYLES: Record<
  string,
  { icon: typeof ClipboardList; accent: string; soft: string }
> = {
  general_information: { icon: ClipboardList, accent: 'bg-sky-700', soft: 'bg-sky-50 text-sky-700' },
  location_and_access: { icon: MapPin, accent: 'bg-indigo-700', soft: 'bg-indigo-50 text-indigo-700' },
  contacts: { icon: FileText, accent: 'bg-violet-700', soft: 'bg-violet-50 text-violet-700' },
  site_specific_information: { icon: ClipboardList, accent: 'bg-teal-700', soft: 'bg-teal-50 text-teal-700' },
  routes_and_parking: { icon: Route, accent: 'bg-amber-700', soft: 'bg-amber-50 text-amber-700' },
  security_and_emergency: { icon: ShieldAlert, accent: 'bg-rose-700', soft: 'bg-rose-50 text-rose-700' },
  medical_support: { icon: ShieldCheck, accent: 'bg-emerald-700', soft: 'bg-emerald-50 text-emerald-700' },
  risk_assessment: { icon: BadgeAlert, accent: 'bg-orange-700', soft: 'bg-orange-50 text-orange-700' },
  data_sources: { icon: FileText, accent: 'bg-slate-700', soft: 'bg-slate-100 text-slate-700' },
};

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function asRecord(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateRange(startDate: Date | null, endDate: Date | null) {
  if (!startDate && !endDate) {
    return 'Dates pending';
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (startDate && endDate) {
    return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
  }

  return startDate ? formatter.format(startDate) : formatter.format(endDate as Date);
}

function getRiskTone(risk: string | null | undefined) {
  const value = (risk ?? 'Pending Review').toLowerCase();

  if (value.includes('high')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }

  if (value.includes('medium')) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }

  if (value.includes('low')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  return 'border-slate-200 bg-slate-100 text-slate-700';
}

export default async function TripIntelReportPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  const { tripId: rawTripId } = await params;
  const tripId = Number.parseInt(rawTripId, 10);

  if (Number.isNaN(tripId)) {
    redirect('/modules/trip-planning');
  }

  const trip = await prisma.trip.findFirst({
    where: {
      id: tripId,
      userId: auth.user.id,
    },
  });

  if (!trip) {
    redirect('/modules/trip-planning');
  }

  const report = await ensureTripIntelReportForTrip({
    tripId: trip.id,
    actorUserId: auth.user.id,
  });

  const metadataSection = report.sections.find(
    (section: IntelReportSectionView) => section.key === 'metadata',
  );
  const visibleSections = report.sections.filter(
    (section: IntelReportSectionView) => section.key !== 'metadata',
  );
  const metadataFields = asRecord(asRecord(metadataSection?.content).fields);
  const sourceSnapshot = asRecord(report.sourceSnapshot);
  const itineraryCount = typeof sourceSnapshot.itineraryCount === 'number' ? sourceSnapshot.itineraryCount : 0;
  const outstandingInputs = visibleSections.reduce((total: number, section: IntelReportSectionView) => {
    return total + asStringArray(asRecord(section.content).requiredInputs).length;
  }, 0);
  const enrichedSections = visibleSections.filter(
    (section: IntelReportSectionView) => section.status === 'ai_enriched',
  ).length;
  const sectionsNeedingInput = visibleSections.filter(
    (section: IntelReportSectionView) => asStringArray(asRecord(section.content).requiredInputs).length > 0,
  ).length;
  const completionPercent = visibleSections.length > 0
    ? Math.max(8, Math.round(((visibleSections.length - sectionsNeedingInput * 0.55) / visibleSections.length) * 100))
    : 0;

  return (
    <main className="min-h-full bg-[#f4f7fb] p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="bg-linear-to-r from-slate-950 via-slate-900 to-blue-950 px-6 py-8 text-white lg:px-8 lg:py-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`/modules/trip-planning/${trip.id}`}
                    className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white/85 transition hover:bg-white/15 hover:text-white"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Trip
                  </Link>
                  <Link
                    href={`/api/trip-planning/trips/${trip.id}/intel-report/export`}
                    className="inline-flex w-fit items-center gap-2 rounded-full border border-blue-300/40 bg-blue-500/15 px-4 py-2 text-sm font-semibold text-blue-50 transition hover:bg-blue-500/25 hover:text-white"
                  >
                    <Download className="h-4 w-4" />
                    Export DOCX
                  </Link>
                </div>

                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-blue-100">
                    Intel Report
                  </div>
                  <h1 className="mt-4 text-3xl font-black tracking-tight text-white lg:text-5xl">
                    {report.title}
                  </h1>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200 lg:text-base">
                    Mission-ready brief for {trip.title}. This page focuses on readiness, missing information, and next actions instead of dumping raw report data.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-3xl border border-white/10 bg-white/10 px-5 py-4 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">Destination</p>
                  <p className="mt-2 text-sm font-bold text-white">{trip.destination || 'Pending'}</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/10 px-5 py-4 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">Travel Window</p>
                  <p className="mt-2 text-sm font-bold text-white">{formatDateRange(trip.startDate, trip.endDate)}</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/10 px-5 py-4 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">Readiness</p>
                  <p className="mt-2 text-sm font-bold text-white">{completionPercent}% baseline complete</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/10 px-5 py-4 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">Risk</p>
                  <p className="mt-2 text-sm font-bold text-white">{report.overallRiskLevel ?? 'Pending Review'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 border-t border-slate-200 bg-slate-50 px-6 py-5 lg:grid-cols-4 lg:px-8">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Sections</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{visibleSections.length}</p>
              <p className="mt-1 text-sm text-slate-500">Operational report blocks</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Outstanding Inputs</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{outstandingInputs}</p>
              <p className="mt-1 text-sm text-slate-500">Items still needing confirmation</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">AI Enriched</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{enrichedSections}</p>
              <p className="mt-1 text-sm text-slate-500">Sections with AI augmentation</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Itinerary Lines</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{itineraryCount}</p>
              <p className="mt-1 text-sm text-slate-500">Used as source data</p>
            </div>
          </div>
        </div>

        <section className="grid gap-6 xl:grid-cols-[1.65fr_0.95fr]">
          <div className="space-y-5">
            {visibleSections.map((section: IntelReportSectionView) => {
              const content = asRecord(section.content);
              const fields = asRecord(content.fields);
              const details = asStringArray(content.details);
              const requiredInputs = asStringArray(content.requiredInputs);
              const sourcesUsed = asStringArray(content.sourcesUsed);
              const sourcesRecommended = asStringArray(content.sourcesRecommended);
              const style = SECTION_STYLES[section.key] ?? {
                icon: ClipboardList,
                accent: 'bg-slate-700',
                soft: 'bg-slate-100 text-slate-700',
              };
              const SectionIcon = style.icon;

              return (
                <article
                  key={section.id}
                  className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm"
                >
                  <div className="border-b border-slate-100 px-6 py-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-4">
                        <div className={`rounded-2xl p-3 ${style.soft}`}>
                          <SectionIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${style.soft}`}>
                              {section.sourceType}
                            </span>
                            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">
                              {section.status}
                            </span>
                          </div>
                          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">
                            {section.label}
                          </h2>
                          {typeof content.summary === 'string' && content.summary.length > 0 ? (
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                              {content.summary}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                        {requiredInputs.length > 0 ? (
                          <>
                            <CircleDashed className="h-4 w-4 text-amber-500" />
                            {requiredInputs.length} items pending
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            Ready for review
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5 px-6 py-5">
                    {details.length > 0 ? (
                      <div>
                        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Operational Notes</h3>
                        <ul className="mt-3 space-y-3">
                          {details.map((detail) => (
                            <li key={detail} className="flex gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.accent}`} />
                              <span>{detail}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {Object.keys(fields).length > 0 ? (
                      <div>
                        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Tracked Fields</h3>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {Object.entries(fields).map(([fieldKey, fieldValue]) => (
                            <div key={fieldKey} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                                {formatLabel(fieldKey)}
                              </p>
                              <p className="mt-2 text-sm font-semibold text-slate-700">
                                {fieldValue === null || fieldValue === '' ? 'Pending confirmation' : String(fieldValue)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {requiredInputs.length > 0 ? (
                      <div>
                        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Needed Now</h3>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {requiredInputs.map((input) => (
                            <span
                              key={input}
                              className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700"
                            >
                              {input}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {sourcesUsed.length > 0 || sourcesRecommended.length > 0 ? (
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Sources Used</h3>
                          <ul className="mt-3 space-y-2 text-sm text-slate-700">
                            {sourcesUsed.length > 0
                              ? sourcesUsed.map((source) => <li key={source}>{source}</li>)
                              : <li>No confirmed sources recorded yet.</li>}
                          </ul>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Recommended Sources</h3>
                          <ul className="mt-3 space-y-2 text-sm text-slate-700">
                            {sourcesRecommended.map((source) => (
                              <li key={source}>{source}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          <aside className="space-y-5">
            <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-950">Mission Snapshot</h2>
                  <p className="text-sm text-slate-500">Trip facts and report state</p>
                </div>
              </div>

              <div className="mt-5 space-y-3 text-sm text-slate-600">
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="inline-flex items-center gap-2"><Calendar className="h-4 w-4" /> Generated</span>
                  <span className="font-semibold text-slate-900">
                    {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : 'Pending'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" /> Destination</span>
                  <span className="font-semibold text-slate-900">{trip.destination || 'Pending'}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="inline-flex items-center gap-2"><BadgeAlert className="h-4 w-4" /> Approval</span>
                  <span className="font-semibold text-slate-900">{report.approvedBy ?? 'Not reviewed'}</span>
                </div>
                <div className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${getRiskTone(report.overallRiskLevel)}`}>
                  <span className="inline-flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Risk posture</span>
                  <span className="font-semibold">{report.overallRiskLevel ?? 'Pending Review'}</span>
                </div>
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">Immediate Actions</h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-700">
                <li className="rounded-2xl bg-slate-50 px-4 py-3">Choose a verified venue and attach exact coordinates, map link, and geofence.</li>
                <li className="rounded-2xl bg-slate-50 px-4 py-3">Add general manager and security contacts so the report becomes operationally usable.</li>
                <li className="rounded-2xl bg-slate-50 px-4 py-3">Link the nearest hospital by route distance and complete emergency procedures.</li>
              </ul>

              <div className="mt-5 flex flex-col gap-3">
                <Link
                  href="/modules/trip-planning/venue-database"
                  className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
                >
                  Open Venue Database
                </Link>
                <Link
                  href={`/modules/trip-planning/${trip.id}`}
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Return to Trip Timeline
                </Link>
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">Audit Trail</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">AI Audit Note</p>
                  <p className="mt-2 leading-6 text-slate-700">
                    {typeof metadataFields.aiUsageAudit === 'string'
                      ? metadataFields.aiUsageAudit
                      : 'No AI usage note recorded.'}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Last Updated</p>
                  <p className="mt-2 font-semibold text-slate-900">
                    {typeof metadataFields.dateUpdated === 'string'
                      ? new Date(metadataFields.dateUpdated).toLocaleString()
                      : 'Pending'}
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
