'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import Breadcrumbs from '@/app/ui/breadcrumbs';
import { DEFAULT_MODULES, type SeedModuleDefinition } from '@/lib/module-catalog';

type PeriodKey = 'week' | 'month' | 'quarter';
type DashboardTab = 'overview' | 'scorecards' | 'tracker';
type ModuleStatus = 'On Track' | 'Needs Focus' | 'At Risk';
type TrendDirection = 'Rising' | 'Stable' | 'Falling';

type ModuleKpi = SeedModuleDefinition & {
  actual: number;
  target: number;
  variance: number;
  attainment: number;
  forecast: number;
  engagement: number;
  delivery: number;
  efficiency: number;
  quality: number;
  openActions: number;
  owner: string;
  reviewDate: string;
  status: ModuleStatus;
  trend: TrendDirection;
};

type CategorySummary = {
  category: string;
  moduleCount: number;
  averageActual: number;
  averageAttainment: number;
  atRiskCount: number;
  topModule: string;
};

const PERIODS: Array<{ key: PeriodKey; label: string; description: string }> = [
  { key: 'week', label: 'Week', description: 'Fast-moving operational pulse' },
  { key: 'month', label: 'Month', description: 'Balanced performance view' },
  { key: 'quarter', label: 'Quarter', description: 'Long-range target posture' },
];

const TABS: Array<{ key: DashboardTab; label: string; description: string }> = [
  { key: 'overview', label: 'Overview', description: 'Portfolio pulse and category health' },
  { key: 'scorecards', label: 'Scorecards', description: 'One KPI card for every module' },
  { key: 'tracker', label: 'Target Tracker', description: 'Detailed module target table' },
];

const STATUS_FILTERS: Array<'All' | ModuleStatus> = ['All', 'On Track', 'Needs Focus', 'At Risk'];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getCategoryTone(category: string) {
  const palette = [
    { pill: 'border-sky-100 bg-sky-50 text-sky-700', soft: 'bg-sky-50/80', accent: 'bg-sky-500' },
    { pill: 'border-violet-100 bg-violet-50 text-violet-700', soft: 'bg-violet-50/80', accent: 'bg-violet-500' },
    { pill: 'border-emerald-100 bg-emerald-50 text-emerald-700', soft: 'bg-emerald-50/80', accent: 'bg-emerald-500' },
    { pill: 'border-amber-100 bg-amber-50 text-amber-700', soft: 'bg-amber-50/80', accent: 'bg-amber-500' },
    { pill: 'border-rose-100 bg-rose-50 text-rose-700', soft: 'bg-rose-50/80', accent: 'bg-rose-500' },
    { pill: 'border-cyan-100 bg-cyan-50 text-cyan-700', soft: 'bg-cyan-50/80', accent: 'bg-cyan-500' },
  ];

  const hash = Array.from(category).reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0);
  return palette[hash % palette.length];
}

function getStatusClasses(status: ModuleStatus) {
  switch (status) {
    case 'On Track':
      return 'border-emerald-100 bg-emerald-50 text-emerald-700';
    case 'Needs Focus':
      return 'border-amber-100 bg-amber-50 text-amber-700';
    case 'At Risk':
      return 'border-rose-100 bg-rose-50 text-rose-700';
  }
}

function getTrendClasses(trend: TrendDirection) {
  switch (trend) {
    case 'Rising':
      return 'text-emerald-600';
    case 'Stable':
      return 'text-slate-500';
    case 'Falling':
      return 'text-rose-600';
  }
}

function MetricBar({ value, accent }: Readonly<{ value: number; accent: string }>) {
  return (
    <div className="h-2 rounded-full bg-slate-100">
      <div className={`h-2 rounded-full ${accent}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function TrendIcon({ trend }: Readonly<{ trend: TrendDirection }>) {
  if (trend === 'Rising') {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M7 14l5-5 5 5" />
      </svg>
    );
  }

  if (trend === 'Falling') {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M17 10l-5 5-5-5" />
      </svg>
    );
  }

  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M5 12h14" />
    </svg>
  );
}

function buildModuleKpi(module: SeedModuleDefinition, period: PeriodKey): ModuleKpi {
  const periodIndex = PERIODS.findIndex((item) => item.key === period);
  const engagement = clamp(52 + ((module.sortOrder * 7 + module.name.length * 2 + periodIndex * 4) % 38), 48, 97);
  const delivery = clamp(50 + ((module.sortOrder * 5 + module.slug.length * 4 + periodIndex * 6) % 40), 45, 98);
  const efficiency = clamp(46 + ((module.sortOrder * 11 + module.category.length * 4 + periodIndex * 3) % 36), 42, 95);
  const quality = clamp(60 + ((module.sortOrder * 3 + module.description.length + periodIndex * 2) % 30), 54, 99);
  const openActions = 3 + ((module.sortOrder * 9 + module.slug.length + periodIndex * 4) % 15);
  const target = clamp(75 + ((module.sortOrder * 4 + module.category.length + periodIndex * 2) % 16), 72, 96);
  const actual = clamp(
    Math.round(engagement * 0.24 + delivery * 0.3 + efficiency * 0.2 + quality * 0.26 - openActions * 0.6),
    48,
    99,
  );
  const forecast = clamp(actual + (((module.sortOrder + periodIndex) % 7) - 3), 45, 99);
  const variance = actual - target;
  const attainment = clamp(Math.round((actual / target) * 100), 55, 132);

  let status: ModuleStatus = 'At Risk';
  if (variance >= 2) {
    status = 'On Track';
  } else if (variance >= -5) {
    status = 'Needs Focus';
  }

  const trendSelector = (module.sortOrder + module.name.length + periodIndex) % 3;
  const trend: TrendDirection = trendSelector === 0 ? 'Rising' : trendSelector === 1 ? 'Stable' : 'Falling';
  const reviewDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(Date.UTC(2026, 3, 29 + module.sortOrder * 2 + periodIndex * 5)),
  );

  return {
    ...module,
    actual,
    target,
    variance,
    attainment,
    forecast,
    engagement,
    delivery,
    efficiency,
    quality,
    openActions,
    owner: `${module.category} Lead`,
    reviewDate,
    status,
    trend,
  };
}

export default function KpisPage() {
  const [activePeriod, setActivePeriod] = useState<PeriodKey>('month');
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeStatus, setActiveStatus] = useState<'All' | ModuleStatus>('All');

  const moduleKpis = useMemo(
    () => DEFAULT_MODULES.slice().sort((left, right) => left.sortOrder - right.sortOrder).map((module) => buildModuleKpi(module, activePeriod)),
    [activePeriod],
  );

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(moduleKpis.map((module) => module.category))).sort((left, right) => left.localeCompare(right))],
    [moduleKpis],
  );

  const filteredKpis = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return moduleKpis.filter((module) => {
      const matchesCategory = activeCategory === 'All' || module.category === activeCategory;
      const matchesStatus = activeStatus === 'All' || module.status === activeStatus;
      const matchesSearch =
        normalizedQuery.length === 0 ||
        module.name.toLowerCase().includes(normalizedQuery) ||
        module.slug.toLowerCase().includes(normalizedQuery) ||
        module.description.toLowerCase().includes(normalizedQuery) ||
        module.category.toLowerCase().includes(normalizedQuery) ||
        module.owner.toLowerCase().includes(normalizedQuery);

      return matchesCategory && matchesStatus && matchesSearch;
    });
  }, [activeCategory, activeStatus, moduleKpis, searchQuery]);

  const summary = useMemo(() => ({
    averageActual: average(filteredKpis.map((module) => module.actual)),
    averageTarget: average(filteredKpis.map((module) => module.target)),
    averageAttainment: average(filteredKpis.map((module) => module.attainment)),
    totalActions: filteredKpis.reduce((sum, module) => sum + module.openActions, 0),
    onTrackCount: filteredKpis.filter((module) => module.status === 'On Track').length,
    focusCount: filteredKpis.filter((module) => module.status === 'Needs Focus').length,
    atRiskCount: filteredKpis.filter((module) => module.status === 'At Risk').length,
    categoryCount: new Set(filteredKpis.map((module) => module.category)).size,
    moduleCount: filteredKpis.length,
  }), [filteredKpis]);

  const categorySummaries = useMemo<CategorySummary[]>(() => {
    return Array.from(new Set(filteredKpis.map((module) => module.category)))
      .sort((left, right) => left.localeCompare(right))
      .map((category) => {
        const categoryModules = filteredKpis.filter((module) => module.category === category);
        const topModule = categoryModules.slice().sort((left, right) => right.actual - left.actual)[0];
        return {
          category,
          moduleCount: categoryModules.length,
          averageActual: average(categoryModules.map((module) => module.actual)),
          averageAttainment: average(categoryModules.map((module) => module.attainment)),
          atRiskCount: categoryModules.filter((module) => module.status === 'At Risk').length,
          topModule: topModule?.name ?? '—',
        };
      });
  }, [filteredKpis]);

  const topPerformers = useMemo(() => filteredKpis.slice().sort((left, right) => right.actual - left.actual).slice(0, 4), [filteredKpis]);
  const biggestGaps = useMemo(() => filteredKpis.slice().sort((left, right) => left.variance - right.variance).slice(0, 5), [filteredKpis]);
  const activePeriodMeta = PERIODS.find((item) => item.key === activePeriod) ?? PERIODS[1];

  return (
    <main className="min-h-screen bg-slate-50 p-6 lg:p-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <section className="relative overflow-hidden rounded-4xl bg-slate-950 p-8 text-white shadow-2xl lg:p-10">
          <div className="absolute -right-20 top-0 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="relative z-10 flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-5">
              <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Insights' }, { label: 'KPIs' }]} />
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-emerald-300">KPI Command Center</p>
                <h1 className="mt-3 text-3xl font-black tracking-tight text-white lg:text-5xl">KPI coverage for every module in the ERP catalog</h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-white/70 lg:text-base">
                  A working KPI dashboard generated from the module catalog, with scorecards, filters, and target tracking for every workspace.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {PERIODS.map((period) => {
                  const isActive = period.key === activePeriod;
                  return (
                    <button
                      key={period.key}
                      type="button"
                      onClick={() => setActivePeriod(period.key)}
                      className={`rounded-2xl px-4 py-3 text-left transition ${
                        isActive ? 'bg-white text-slate-950 shadow-lg' : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      <p className="text-sm font-black">{period.label}</p>
                      <p className={`mt-1 text-xs ${isActive ? 'text-slate-500' : 'text-white/55'}`}>{period.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">Top performers</p>
                  <h2 className="mt-2 text-xl font-black text-white">Best KPI scores in the current view</h2>
                </div>
                <div className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs font-bold text-white/60">{filteredKpis.length} visible</div>
              </div>
              <div className="mt-5 space-y-3">
                {topPerformers.map((module, index) => (
                  <div key={module.slug} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">#{index + 1}</p>
                      <p className="mt-1 text-sm font-bold text-white">{module.name}</p>
                      <p className="text-xs text-white/55">{module.category} • target {module.target}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-white">{module.actual}</p>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">kpi score</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Modules in view</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-slate-950">{summary.moduleCount}</p>
            <p className="mt-4 text-sm font-medium text-slate-500">{summary.categoryCount} categories match the active filters</p>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Average KPI score</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-slate-950">{summary.averageActual}</p>
            <p className="mt-4 text-sm font-medium text-slate-500">Against an average target of {summary.averageTarget}</p>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Target attainment</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-slate-950">{summary.averageAttainment}%</p>
            <p className="mt-4 text-sm font-medium text-slate-500">{summary.onTrackCount} on track, {summary.focusCount} need focus, {summary.atRiskCount} at risk</p>
          </div>
          <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-2xl">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">Open actions</p>
            <p className="mt-3 text-4xl font-black tracking-tight">{summary.totalActions}</p>
            <p className="mt-4 text-sm font-medium text-white/60">Deterministic follow-up queue across visible modules</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <svg className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search modules, owners, descriptions, or categories..."
                  className="w-full rounded-2xl bg-slate-50 py-3 pl-11 pr-4 text-sm font-medium text-slate-700 outline-none ring-1 ring-transparent transition focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((status) => {
                  const isActive = activeStatus === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setActiveStatus(status)}
                      className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                        isActive ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950'
                      }`}
                    >
                      {status}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => {
                const isActive = activeCategory === category;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                      isActive ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950'
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-100 bg-white p-2 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-3xl px-4 py-3 text-left transition lg:min-w-60 ${
                    isActive ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950'
                  }`}
                >
                  <p className="text-sm font-black">{tab.label}</p>
                  <p className={`mt-1 text-xs ${isActive ? 'text-white/60' : 'text-slate-500'}`}>{tab.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        {filteredKpis.length === 0 ? (
          <section className="rounded-4xl border-2 border-dashed border-slate-200 bg-white px-6 py-20 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-slate-50 text-slate-300">
              <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4V7m4 10H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="mt-6 text-2xl font-black text-slate-950">No modules match this KPI view</h2>
            <p className="mt-2 text-sm font-medium text-slate-500">Adjust the search, category, or status filters to restore the dashboard.</p>
          </section>
        ) : null}

        {filteredKpis.length > 0 && activeTab === 'overview' ? (
          <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <article className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Portfolio pulse</p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Current KPI posture for the selected period</h2>
                </div>
                <div className="rounded-full bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500">{activePeriodMeta.label}</div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Average score</p>
                  <p className="mt-3 text-3xl font-black text-slate-950">{summary.averageActual}</p>
                  <p className="mt-2 text-sm font-medium text-slate-500">Across all visible module scorecards</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Attainment</p>
                  <p className="mt-3 text-3xl font-black text-slate-950">{summary.averageAttainment}%</p>
                  <p className="mt-2 text-sm font-medium text-slate-500">Portfolio target attainment versus planned thresholds</p>
                </div>
                <div className="rounded-2xl bg-slate-950 p-5 text-white">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">At-risk modules</p>
                  <p className="mt-3 text-3xl font-black">{summary.atRiskCount}</p>
                  <p className="mt-2 text-sm font-medium text-white/60">Modules with the largest negative target variance</p>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-3xl border border-slate-100">
                <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
                  <p className="text-sm font-black text-slate-950">Largest target gaps</p>
                  <p className="mt-1 text-xs font-medium text-slate-500">Modules needing the most attention in this view</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {biggestGaps.map((module) => (
                    <div key={module.slug} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-black text-slate-950">{module.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{module.category} • review {module.reviewDate}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${getStatusClasses(module.status)}`}>
                          {module.status}
                        </span>
                        <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                          {new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, signDisplay: 'always' }).format(module.variance)} pts
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Category performance</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Operational lanes at a glance</h2>
              <div className="mt-6 space-y-4">
                {categorySummaries.map((snapshot) => {
                  const tone = getCategoryTone(snapshot.category);
                  return (
                    <div key={snapshot.category} className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${tone.pill}`}>
                            {snapshot.category}
                          </span>
                          <p className="mt-3 text-lg font-black text-slate-950">{snapshot.averageActual}</p>
                          <p className="text-sm font-medium text-slate-500">{snapshot.moduleCount} modules • top: {snapshot.topModule}</p>
                        </div>
                        <div className={`rounded-2xl px-4 py-3 ${tone.soft}`}>
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Attainment</p>
                          <p className="mt-2 text-xl font-black text-slate-950">{snapshot.averageAttainment}%</p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
                        <span>{snapshot.atRiskCount} at risk</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>
        ) : null}

        {filteredKpis.length > 0 && activeTab === 'scorecards' ? (
          <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filteredKpis.map((module) => {
              const tone = getCategoryTone(module.category);
              return (
                <article key={module.slug} className="group rounded-3xl border border-slate-100 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-xl hover:shadow-emerald-500/5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${tone.pill}`}>
                        {module.category}
                      </span>
                      <h2 className="mt-4 text-xl font-black tracking-tight text-slate-950">{module.name}</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-500">{module.description}</p>
                    </div>
                    <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${getStatusClasses(module.status)}`}>
                      {module.status}
                    </span>
                  </div>

                  <div className="mt-6 grid grid-cols-3 gap-3">
                    <div className={`rounded-2xl p-3 ${tone.soft}`}>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Actual</p>
                      <p className="mt-2 text-2xl font-black text-slate-950">{module.actual}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Target</p>
                      <p className="mt-2 text-2xl font-black text-slate-950">{module.target}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Gap</p>
                      <p className="mt-2 text-2xl font-black text-slate-950">{new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, signDisplay: 'always' }).format(module.variance)}</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500"><span>Engagement</span><span>{module.engagement}%</span></div>
                      <MetricBar value={module.engagement} accent={tone.accent} />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500"><span>Delivery</span><span>{module.delivery}%</span></div>
                      <MetricBar value={module.delivery} accent="bg-slate-900" />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500"><span>Efficiency</span><span>{module.efficiency}%</span></div>
                      <MetricBar value={module.efficiency} accent="bg-emerald-500" />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500"><span>Quality</span><span>{module.quality}%</span></div>
                      <MetricBar value={module.quality} accent="bg-violet-500" />
                    </div>
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Owner</p>
                      <p className="mt-1 text-sm font-bold text-slate-950">{module.owner}</p>
                    </div>
                    <div className={`inline-flex items-center gap-1 text-xs font-black uppercase tracking-[0.18em] ${getTrendClasses(module.trend)}`}>
                      <TrendIcon trend={module.trend} />
                      {module.trend}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs font-bold text-slate-500">
                    <span>{module.openActions} open actions</span>
                    <span>Review {module.reviewDate}</span>
                  </div>

                  <Link href={`/modules/${module.slug}`} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-slate-950 transition group-hover:text-emerald-700">
                    Open module
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M13 5l7 7-7 7M5 12h15" />
                    </svg>
                  </Link>
                </article>
              );
            })}
          </section>
        ) : null}

        {filteredKpis.length > 0 && activeTab === 'tracker' ? (
          <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Target tracker</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">Detailed KPI target table for every visible module</h2>
              </div>
              <div className="rounded-full bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500">{filteredKpis.length} rows</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left">
                <thead className="bg-slate-50/90">
                  <tr className="border-b border-slate-100">
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Module</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Category</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Owner</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Actual</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Target</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Variance</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Forecast</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Attainment</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Actions</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Review</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Trend</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredKpis.map((module) => {
                    const tone = getCategoryTone(module.category);
                    return (
                      <tr key={module.slug} className="transition-colors hover:bg-slate-50/80">
                        <td className="px-6 py-5">
                          <div className="min-w-56">
                            <Link href={`/modules/${module.slug}`} className="text-sm font-black text-slate-950 transition hover:text-emerald-700">{module.name}</Link>
                            <p className="mt-1 text-xs text-slate-500">{module.slug}</p>
                          </div>
                        </td>
                        <td className="px-6 py-5"><span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${tone.pill}`}>{module.category}</span></td>
                        <td className="px-6 py-5 text-sm font-bold text-slate-600">{module.owner}</td>
                        <td className="px-6 py-5 text-right text-sm font-black text-slate-950">{module.actual}</td>
                        <td className="px-6 py-5 text-right text-sm font-bold text-slate-600">{module.target}</td>
                        <td className={`px-6 py-5 text-right text-sm font-black ${module.variance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, signDisplay: 'always' }).format(module.variance)}</td>
                        <td className="px-6 py-5 text-right text-sm font-bold text-slate-600">{module.forecast}</td>
                        <td className="px-6 py-5 text-right text-sm font-bold text-slate-600">{module.attainment}%</td>
                        <td className="px-6 py-5 text-right text-sm font-bold text-slate-600">{module.openActions}</td>
                        <td className="px-6 py-5 text-right text-sm font-bold text-slate-600">{module.reviewDate}</td>
                        <td className={`px-6 py-5 text-right text-sm font-black ${getTrendClasses(module.trend)}`}><span className="inline-flex items-center justify-end gap-1"><TrendIcon trend={module.trend} />{module.trend}</span></td>
                        <td className="px-6 py-5 text-right"><span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${getStatusClasses(module.status)}`}>{module.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
