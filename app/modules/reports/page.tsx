'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import Breadcrumbs from '@/app/ui/breadcrumbs';
import { DEFAULT_MODULES, type SeedModuleDefinition } from '@/lib/module-catalog';

type DashboardTab = 'overview' | 'categories' | 'matrix';
type ModuleStatus = 'Healthy' | 'Watch' | 'Critical';
type TrendDirection = 'Up' | 'Steady' | 'Down';

type ModuleReport = SeedModuleDefinition & {
  adoption: number;
  completion: number;
  automation: number;
  sla: number;
  backlog: number;
  incidents: number;
  score: number;
  trend: TrendDirection;
  status: ModuleStatus;
  owner: string;
};

type CategorySummary = {
  category: string;
  moduleCount: number;
  averageScore: number;
  averageSla: number;
  backlog: number;
  incidents: number;
  topModule: string;
};

const TABS: Array<{ key: DashboardTab; label: string; description: string }> = [
  { key: 'overview', label: 'Overview', description: 'Scorecards across every ERP workspace' },
  { key: 'categories', label: 'Category Pulse', description: 'Cluster performance by operating lane' },
  { key: 'matrix', label: 'Detailed Matrix', description: 'Scan module health in one table' },
];

const percentFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildModuleReport(module: SeedModuleDefinition): ModuleReport {
  const adoption = clamp(56 + ((module.sortOrder * 7 + module.name.length) % 37), 48, 97);
  const completion = clamp(52 + ((module.sortOrder * 9 + module.slug.length) % 35), 45, 98);
  const automation = clamp(30 + ((module.sortOrder * 11 + module.category.length) % 45), 24, 93);
  const sla = clamp(72 + ((module.sortOrder * 5 + module.description.length) % 23), 68, 99);
  const backlog = 6 + ((module.sortOrder * 13 + module.slug.length) % 39);
  const incidents = (module.sortOrder + module.category.length) % 5;
  const score = clamp(
    Math.round(adoption * 0.32 + completion * 0.24 + automation * 0.14 + sla * 0.3 - incidents * 2.5),
    52,
    98,
  );

  let status: ModuleStatus = 'Critical';
  if (score >= 84) {
    status = 'Healthy';
  } else if (score >= 70) {
    status = 'Watch';
  }

  const trendSelector = (module.sortOrder + module.name.length) % 3;
  const trend: TrendDirection = trendSelector === 0 ? 'Up' : trendSelector === 1 ? 'Steady' : 'Down';

  return {
    ...module,
    adoption,
    completion,
    automation,
    sla,
    backlog,
    incidents,
    score,
    trend,
    status,
    owner: `${module.category} Ops`,
  };
}

function getStatusClasses(status: ModuleStatus) {
  switch (status) {
    case 'Healthy':
      return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    case 'Watch':
      return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'Critical':
      return 'bg-rose-50 text-rose-700 border-rose-100';
  }
}

function getTrendClasses(trend: TrendDirection) {
  switch (trend) {
    case 'Up':
      return 'text-emerald-600';
    case 'Steady':
      return 'text-gray-500';
    case 'Down':
      return 'text-rose-600';
  }
}

function getCategoryClasses(category: string) {
  const palette = [
    {
      pill: 'bg-sky-50 text-sky-700 border-sky-100',
      muted: 'bg-sky-50/70',
      accent: 'bg-sky-500',
    },
    {
      pill: 'bg-violet-50 text-violet-700 border-violet-100',
      muted: 'bg-violet-50/70',
      accent: 'bg-violet-500',
    },
    {
      pill: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      muted: 'bg-emerald-50/70',
      accent: 'bg-emerald-500',
    },
    {
      pill: 'bg-amber-50 text-amber-700 border-amber-100',
      muted: 'bg-amber-50/70',
      accent: 'bg-amber-500',
    },
    {
      pill: 'bg-rose-50 text-rose-700 border-rose-100',
      muted: 'bg-rose-50/70',
      accent: 'bg-rose-500',
    },
    {
      pill: 'bg-cyan-50 text-cyan-700 border-cyan-100',
      muted: 'bg-cyan-50/70',
      accent: 'bg-cyan-500',
    },
  ];

  const hash = Array.from(category).reduce(
    (sum, character) => sum + (character.codePointAt(0) ?? 0),
    0,
  );
  return palette[hash % palette.length];
}

function TrendIcon({ trend }: Readonly<{ trend: TrendDirection }>) {
  if (trend === 'Up') {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 14l5-5 5 5" />
      </svg>
    );
  }

  if (trend === 'Down') {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 10l-5 5-5-5" />
      </svg>
    );
  }

  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14" />
    </svg>
  );
}

function MetricBar({ value, accent }: Readonly<{ value: number; accent: string }>) {
  return (
    <div className="h-2 rounded-full bg-gray-100">
      <div className={`h-2 rounded-full ${accent}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export default function ReportsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');

  const moduleReports = useMemo<ModuleReport[]>(
    () => DEFAULT_MODULES.slice().sort((left, right) => left.sortOrder - right.sortOrder).map(buildModuleReport),
    [],
  );

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(moduleReports.map((module) => module.category))).sort((left, right) => left.localeCompare(right))],
    [moduleReports],
  );

  const filteredReports = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return moduleReports.filter((module) => {
      const matchesCategory = activeCategory === 'All' || module.category === activeCategory;
      const matchesSearch =
        normalizedQuery.length === 0 ||
        module.name.toLowerCase().includes(normalizedQuery) ||
        module.slug.toLowerCase().includes(normalizedQuery) ||
        module.description.toLowerCase().includes(normalizedQuery) ||
        module.category.toLowerCase().includes(normalizedQuery);

      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, moduleReports, searchQuery]);

  const summary = useMemo(() => {
    const scores = filteredReports.map((module) => module.score);
    const slas = filteredReports.map((module) => module.sla);
    const healthyCount = filteredReports.filter((module) => module.status === 'Healthy').length;
    const watchCount = filteredReports.filter((module) => module.status === 'Watch').length;
    const criticalCount = filteredReports.filter((module) => module.status === 'Critical').length;
    const totalBacklog = filteredReports.reduce((sum, module) => sum + module.backlog, 0);

    return {
      moduleCount: filteredReports.length,
      averageScore: average(scores),
      averageSla: average(slas),
      healthyCount,
      watchCount,
      criticalCount,
      totalBacklog,
      categoryCount: new Set(filteredReports.map((module) => module.category)).size,
    };
  }, [filteredReports]);

  const categorySummaries = useMemo<CategorySummary[]>(() => {
    return Array.from(new Set(filteredReports.map((module) => module.category)))
      .sort((left, right) => left.localeCompare(right))
      .map((category) => {
        const reports = filteredReports.filter((module) => module.category === category);
        const topModule = reports.slice().sort((left, right) => right.score - left.score)[0];

        return {
          category,
          moduleCount: reports.length,
          averageScore: average(reports.map((module) => module.score)),
          averageSla: average(reports.map((module) => module.sla)),
          backlog: reports.reduce((sum, module) => sum + module.backlog, 0),
          incidents: reports.reduce((sum, module) => sum + module.incidents, 0),
          topModule: topModule?.name ?? '—',
        };
      });
  }, [filteredReports]);

  const topPerformers = useMemo(
    () => filteredReports.slice().sort((left, right) => right.score - left.score).slice(0, 3),
    [filteredReports],
  );

  const refreshedLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date()),
    [],
  );

  return (
    <main className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <section className="relative overflow-hidden rounded-[2.5rem] bg-gray-900 p-8 text-white shadow-2xl lg:p-10">
          <div className="absolute -right-20 -top-16 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Insights' }, { label: 'Reports' }]} />
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-emerald-300">Enterprise Reporting Hub</p>
                <h1 className="mt-3 text-3xl font-black tracking-tight text-white lg:text-5xl">Module reporting across the full ERP estate</h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-white/70 lg:text-base">
                  A reporting dashboard that turns every workspace in the catalog into a consistent operational scorecard, category pulse, and matrix view.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Coverage</p>
                  <p className="mt-1 text-lg font-black text-white">{moduleReports.length} Modules</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Categories</p>
                  <p className="mt-1 text-lg font-black text-white">{categories.length - 1} Operating Lanes</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Refresh</p>
                  <p className="mt-1 text-lg font-black text-white">{refreshedLabel}</p>
                </div>
              </div>
            </div>

            <div className="w-full max-w-sm rounded-4xl border border-white/10 bg-white/5 p-5 backdrop-blur">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/50">Top performers</p>
              <div className="mt-4 space-y-3">
                {topPerformers.map((module, index) => (
                  <div key={module.slug} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">#{index + 1}</p>
                      <p className="mt-1 text-sm font-bold text-white">{module.name}</p>
                      <p className="text-xs text-white/55">{module.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-white">{module.score}</p>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">health score</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-4xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Modules in scope</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-gray-900">{summary.moduleCount}</p>
            <p className="mt-4 text-sm font-medium text-gray-500">{summary.categoryCount} categories in the current filter set</p>
          </div>

          <div className="rounded-4xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Average health</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-gray-900">{summary.averageScore}</p>
            <p className="mt-4 text-sm font-medium text-gray-500">{summary.healthyCount} modules are currently healthy</p>
          </div>

          <div className="rounded-4xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">SLA attainment</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-gray-900">{summary.averageSla}%</p>
            <p className="mt-4 text-sm font-medium text-gray-500">{summary.watchCount} watch items and {summary.criticalCount} critical items</p>
          </div>

          <div className="rounded-4xl bg-gray-900 p-6 text-white shadow-2xl">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">Action queue</p>
            <p className="mt-3 text-4xl font-black tracking-tight">{summary.totalBacklog}</p>
            <p className="mt-4 text-sm font-medium text-white/60">Open follow-ups across reporting workspaces</p>
          </div>
        </section>

        <section className="rounded-4xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <svg className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by module name, slug, description, or category..."
                className="w-full rounded-2xl bg-gray-50 py-3 pl-11 pr-4 text-sm font-medium text-gray-700 outline-none ring-1 ring-transparent transition focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {categories.map((category) => {
                const isActive = activeCategory === category;

                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActiveCategory(category)}
                    className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                      isActive ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-4xl border border-gray-100 bg-white p-2 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-3xl px-4 py-3 text-left transition lg:min-w-55 ${
                    isActive ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <p className="text-sm font-black">{tab.label}</p>
                  <p className={`mt-1 text-xs ${isActive ? 'text-white/60' : 'text-gray-500'}`}>{tab.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        {filteredReports.length === 0 ? (
          <section className="rounded-[2.5rem] border-2 border-dashed border-gray-200 bg-white px-6 py-20 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gray-50 text-gray-300">
              <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4V7m4 10H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="mt-6 text-2xl font-black text-gray-900">No modules match this view</h2>
            <p className="mt-2 text-sm font-medium text-gray-500">Adjust the search term or category filter to restore the reporting matrix.</p>
          </section>
        ) : (
          <>
            {activeTab === 'overview' ? (
              <section className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {filteredReports.map((module) => {
                    const categoryTone = getCategoryClasses(module.category);

                    return (
                      <article
                        key={module.slug}
                        className="group rounded-4xl border border-gray-100 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-xl hover:shadow-emerald-500/5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${categoryTone.pill}`}>
                              {module.category}
                            </span>
                            <h2 className="mt-4 text-xl font-black tracking-tight text-gray-900">{module.name}</h2>
                            <p className="mt-2 text-sm leading-6 text-gray-500">{module.description}</p>
                          </div>
                          <div className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${getStatusClasses(module.status)}`}>
                            {module.status}
                          </div>
                        </div>

                        <div className="mt-6 grid grid-cols-3 gap-3">
                          <div className={`rounded-2xl p-3 ${categoryTone.muted}`}>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Score</p>
                            <p className="mt-2 text-2xl font-black text-gray-900">{module.score}</p>
                          </div>
                          <div className="rounded-2xl bg-gray-50 p-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">SLA</p>
                            <p className="mt-2 text-2xl font-black text-gray-900">{module.sla}%</p>
                          </div>
                          <div className="rounded-2xl bg-gray-50 p-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Backlog</p>
                            <p className="mt-2 text-2xl font-black text-gray-900">{module.backlog}</p>
                          </div>
                        </div>

                        <div className="mt-6 space-y-4">
                          <div>
                            <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-500">
                              <span>Adoption</span>
                              <span>{percentFormatter.format(module.adoption)}%</span>
                            </div>
                            <MetricBar value={module.adoption} accent={categoryTone.accent} />
                          </div>
                          <div>
                            <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-500">
                              <span>Completion</span>
                              <span>{percentFormatter.format(module.completion)}%</span>
                            </div>
                            <MetricBar value={module.completion} accent="bg-gray-900" />
                          </div>
                          <div>
                            <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-500">
                              <span>Automation</span>
                              <span>{percentFormatter.format(module.automation)}%</span>
                            </div>
                            <MetricBar value={module.automation} accent="bg-emerald-500" />
                          </div>
                        </div>

                        <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Owner</p>
                            <p className="mt-1 text-sm font-bold text-gray-900">{module.owner}</p>
                          </div>
                          <div className={`flex items-center gap-1 text-xs font-black uppercase tracking-[0.18em] ${getTrendClasses(module.trend)}`}>
                            <TrendIcon trend={module.trend} />
                            {module.trend}
                          </div>
                        </div>

                        <Link
                          href={`/modules/${module.slug}`}
                          className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-gray-900 transition group-hover:text-emerald-700"
                        >
                          Open module
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 12h15" />
                          </svg>
                        </Link>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {activeTab === 'categories' ? (
              <section className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
                {categorySummaries.map((summaryItem) => {
                  const categoryTone = getCategoryClasses(summaryItem.category);

                  return (
                    <article key={summaryItem.category} className="rounded-4xl border border-gray-100 bg-white p-6 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${categoryTone.pill}`}>
                            {summaryItem.category}
                          </span>
                          <h2 className="mt-4 text-2xl font-black tracking-tight text-gray-900">{summaryItem.averageScore}</h2>
                          <p className="mt-1 text-sm font-medium text-gray-500">Average health score across {summaryItem.moduleCount} modules</p>
                        </div>
                        <div className={`rounded-2xl p-4 ${categoryTone.muted}`}>
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">SLA</p>
                          <p className="mt-2 text-2xl font-black text-gray-900">{summaryItem.averageSla}%</p>
                        </div>
                      </div>

                      <div className="mt-6 grid grid-cols-2 gap-4">
                        <div className="rounded-2xl bg-gray-50 p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Backlog</p>
                          <p className="mt-2 text-xl font-black text-gray-900">{summaryItem.backlog}</p>
                        </div>
                        <div className="rounded-2xl bg-gray-50 p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Incidents</p>
                          <p className="mt-2 text-xl font-black text-gray-900">{summaryItem.incidents}</p>
                        </div>
                      </div>

                      <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Top module</p>
                        <p className="mt-2 text-base font-black text-gray-900">{summaryItem.topModule}</p>
                      </div>
                    </article>
                  );
                })}
              </section>
            ) : null}

            {activeTab === 'matrix' ? (
              <section className="overflow-hidden rounded-4xl border border-gray-100 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-5">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Detailed matrix</p>
                    <h2 className="mt-1 text-xl font-black text-gray-900">Operational module comparison</h2>
                  </div>
                  <div className="rounded-full bg-gray-50 px-4 py-2 text-xs font-bold text-gray-500">
                    {filteredReports.length} rows
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left">
                    <thead className="bg-gray-50/80">
                      <tr className="border-b border-gray-100">
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Module</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Category</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Status</th>
                        <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Score</th>
                        <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Adoption</th>
                        <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Completion</th>
                        <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Automation</th>
                        <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">SLA</th>
                        <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Backlog</th>
                        <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Incidents</th>
                        <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Trend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredReports.map((module) => {
                        const categoryTone = getCategoryClasses(module.category);

                        return (
                          <tr key={module.slug} className="transition-colors hover:bg-gray-50/80">
                            <td className="px-6 py-5">
                              <div className="min-w-55">
                                <Link href={`/modules/${module.slug}`} className="text-sm font-black text-gray-900 transition hover:text-emerald-700">
                                  {module.name}
                                </Link>
                                <p className="mt-1 text-xs text-gray-500">{module.slug}</p>
                              </div>
                            </td>
                            <td className="px-6 py-5">
                              <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${categoryTone.pill}`}>
                                {module.category}
                              </span>
                            </td>
                            <td className="px-6 py-5">
                              <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${getStatusClasses(module.status)}`}>
                                {module.status}
                              </span>
                            </td>
                            <td className="px-6 py-5 text-right text-sm font-black text-gray-900">{module.score}</td>
                            <td className="px-6 py-5 text-right text-sm font-bold text-gray-600">{module.adoption}%</td>
                            <td className="px-6 py-5 text-right text-sm font-bold text-gray-600">{module.completion}%</td>
                            <td className="px-6 py-5 text-right text-sm font-bold text-gray-600">{module.automation}%</td>
                            <td className="px-6 py-5 text-right text-sm font-bold text-gray-600">{module.sla}%</td>
                            <td className="px-6 py-5 text-right text-sm font-bold text-gray-600">{module.backlog}</td>
                            <td className="px-6 py-5 text-right text-sm font-bold text-gray-600">{module.incidents}</td>
                            <td className={`px-6 py-5 text-right text-sm font-black ${getTrendClasses(module.trend)}`}>
                              <span className="inline-flex items-center justify-end gap-1">
                                <TrendIcon trend={module.trend} />
                                {module.trend}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
