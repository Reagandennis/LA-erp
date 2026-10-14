import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getServerAuth } from '@/lib/auth';
import {
  HIGHLIGHT_SLOT_COUNT,
  listAvailableHighlights,
  loadHighlightValues,
  resolveHighlightKeys,
} from '@/lib/dashboard-highlights';
import { loadDashboardOverview } from '@/lib/dashboard-overview';
import { APP_LOCALE } from '@/lib/locale';
import { prisma } from '@/lib/prisma';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { getAccessibleModulesForUser, userHasRole } from '@/lib/user';
import { DashboardHighlights } from '@/app/ui/dashboard-highlights';
import { moduleIcon } from '@/app/ui/module-icons';

// ---------------------------------------------------------------- formatting

const money = (value: number, currency: string) =>
  new Intl.NumberFormat(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' });
const relativeDays = (days: number) =>
  days < 0 ? `${-days}d overdue` : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`;

function greeting(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---------------------------------------------------------------- building blocks

function Panel({
  title,
  count,
  href,
  tone = 'neutral',
  children,
}: Readonly<{ title: string; count: number; href: string; tone?: 'neutral' | 'warn' | 'danger'; children: ReactNode }>) {
  const pill =
    count === 0
      ? 'bg-gray-100 text-gray-500'
      : tone === 'danger'
        ? 'bg-rose-100 text-rose-700'
        : tone === 'warn'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-primary/10 text-primary';
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-gray-100 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-bold text-primary">{title}</h3>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${pill}`}>{count}</span>
        </div>
        <Link href={href} className="text-xs font-bold text-gray-400 transition-colors hover:text-primary">
          View all →
        </Link>
      </header>
      <div className="flex-1 px-2 py-2">{children}</div>
    </section>
  );
}

function Empty({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="px-3 py-6 text-center text-sm text-gray-400">{children}</p>;
}

function Row({
  href,
  title,
  subtitle,
  meta,
  metaTone = 'neutral',
}: Readonly<{ href: string; title: string; subtitle?: string | null; meta?: string | null; metaTone?: 'neutral' | 'warn' | 'danger' | 'good' }>) {
  const metaColor =
    metaTone === 'danger' ? 'text-rose-600' : metaTone === 'warn' ? 'text-amber-600' : metaTone === 'good' ? 'text-emerald-600' : 'text-gray-400';
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-gray-50">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-gray-900">{title}</span>
        {subtitle && <span className="block truncate text-xs text-gray-500">{subtitle}</span>}
      </span>
      {meta && <span className={`shrink-0 text-xs font-bold tabular-nums ${metaColor}`}>{meta}</span>}
    </Link>
  );
}

// ---------------------------------------------------------------- page

export default async function DashboardPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const [accessibleModules, preferences, overview] = await Promise.all([
    getAccessibleModulesForUser(auth.user),
    prisma.user.findUnique({ where: { id: auth.user.id }, select: { dashboardHighlights: true } }),
    loadDashboardOverview(auth.user),
  ]);
  const selectedHighlightKeys = resolveHighlightKeys(auth.user, preferences?.dashboardHighlights ?? []);
  const highlights = await loadHighlightValues(auth.user, selectedHighlightKeys);

  const now = new Date();
  const { approvals, movements, money: finance, expiring, agenda, tasks, canSee } = overview;
  const approvalCount = approvals.quotes.length + approvals.invoices.length + approvals.handovers.length + approvals.leave.length;
  const showApprovals = canSee.quotes || canSee.invoices || canSee.handover || canSee.leave;
  const showExpiring = canSee.licences || canSee.contracts;
  const firstName = auth.user.name.split(' ')[0];

  return (
    <main className="min-h-full space-y-8 bg-gray-50/50 p-6 lg:p-10">
      {/* Greeting + highlights */}
      <section className="relative overflow-hidden rounded-3xl bg-primary p-6 text-white shadow-xl lg:p-8">
        <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">
              {now.toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight lg:text-4xl">
              {greeting(now.getHours())}, <span className="text-secondary">{firstName}</span>
            </h2>
            <p className="mt-3 max-w-md text-sm text-white/70">
              {approvalCount > 0
                ? `${approvalCount} ${approvalCount === 1 ? 'item needs' : 'items need'} your decision, and ${movements.trips.length} ${movements.trips.length === 1 ? 'trip is' : 'trips are'} in motion.`
                : `Nothing is waiting on you. ${movements.trips.length} ${movements.trips.length === 1 ? 'trip is' : 'trips are'} in motion.`}
            </p>
            {isAdmin && (
              <Link
                href="/admin"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-secondary px-5 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-white"
              >
                Admin workspace →
              </Link>
            )}
          </div>

          <DashboardHighlights
            initialHighlights={highlights}
            available={listAvailableHighlights(auth.user)}
            initialSelected={selectedHighlightKeys}
            slots={HIGHLIGHT_SLOT_COUNT}
          />
        </div>
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-secondary/10 blur-3xl" />
      </section>

      {/* Today */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {showApprovals && (
          <Panel title="Needs your decision" count={approvalCount} href={canSee.quotes ? '/modules/quotes' : '/modules/handover'} tone="warn">
            {approvalCount === 0 ? (
              <Empty>Nothing waiting for you.</Empty>
            ) : (
              <>
                {approvals.quotes.map((q) => (
                  <Row key={`q${q.id}`} href={q.href} title={`Quote ${q.reference} · ${q.customer}`} subtitle={q.title} meta={q.amount !== null ? money(q.amount, q.currency ?? 'USD') : null} />
                ))}
                {approvals.invoices.map((i) => (
                  <Row key={`i${i.id}`} href={i.href} title={`${i.title} · ${i.customer}`} subtitle="Awaiting approval" meta={i.amount !== null ? money(i.amount, i.currency ?? 'USD') : null} />
                ))}
                {approvals.handovers.map((h) => (
                  <Row key={`h${h.id}`} href="/modules/handover" title={`${h.status} handover · ${h.post ?? h.period}`} subtitle={h.summary} meta={shortDate(h.shiftDate)} metaTone={h.status === 'Urgent' ? 'danger' : 'warn'} />
                ))}
                {approvals.leave.map((l) => (
                  <Row key={`l${l.id}`} href="/modules/shift-planning" title={`${l.person} · ${l.type} leave`} subtitle={`${l.startDate} → ${l.endDate}`} meta="pending" metaTone="warn" />
                ))}
              </>
            )}
          </Panel>
        )}

        {canSee.trips && (
          <Panel title="Trips in motion" count={movements.trips.length} href="/modules/trip-planning">
            {movements.trips.length === 0 ? (
              <Empty>No trips active or starting in the next two days.</Empty>
            ) : (
              <>
                {movements.trips.map((t) => (
                  <Row
                    key={t.id}
                    href={`/modules/trip-planning/${t.id}`}
                    title={t.title}
                    subtitle={[t.customer, t.vehicle, t.officer ?? t.driver].filter(Boolean).join(' · ')}
                    meta={t.status === 'Active' ? 'Active' : t.startDate ? shortDate(t.startDate) : t.status}
                    metaTone={t.status === 'Active' ? 'good' : 'neutral'}
                  />
                ))}
                {movements.today.length > 0 && (
                  <div className="mt-2 border-t border-gray-100 px-3 pt-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Today&apos;s itinerary</p>
                    {movements.today.map((it) => (
                      <Link key={it.id} href={`/modules/trip-planning/${it.tripId}`} className="flex items-baseline gap-3 rounded-lg px-1 py-1.5 text-sm hover:bg-gray-50">
                        <span className="w-12 shrink-0 text-xs font-bold tabular-nums text-primary">{it.scheduledAt ? time(it.scheduledAt) : it.timeLabel ?? ''}</span>
                        <span className="min-w-0 flex-1 truncate text-gray-800">{it.description}{it.placeName ? <span className="text-gray-400"> · {it.placeName}</span> : null}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </Panel>
        )}

        {canSee.calendar && (
          <Panel title="Your week" count={agenda.length} href="/modules/calendar">
            {agenda.length === 0 ? (
              <Empty>No events in the next seven days.</Empty>
            ) : (
              agenda.map((e) => (
                <Row
                  key={e.id}
                  href="/modules/calendar"
                  title={e.title}
                  subtitle={[e.allDay ? 'All day' : time(e.startsAt), e.location, e.tag].filter(Boolean).join(' · ')}
                  meta={shortDate(e.startsAt)}
                />
              ))
            )}
          </Panel>
        )}

        {canSee.invoices && (
          <Panel title="Money" count={finance.overdue.length} href="/modules/invoices-review" tone="danger">
            <div className="mb-1 grid grid-cols-2 gap-2 px-3 pt-1">
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Outstanding</p>
                <p className="mt-1 text-xl font-bold text-primary tabular-nums">{money(finance.outstandingTotal, finance.currency)}</p>
              </div>
              <div className="rounded-xl bg-rose-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-rose-400">Overdue</p>
                <p className="mt-1 text-xl font-bold text-rose-700 tabular-nums">{money(finance.overdueTotal, finance.currency)}</p>
              </div>
            </div>
            {finance.overdue.length === 0 ? (
              <Empty>No overdue invoices.</Empty>
            ) : (
              finance.overdue.map((i) => (
                <Row key={i.id} href="/modules/invoices-review" title={`${i.number} · ${i.customer}`} subtitle={`Due ${shortDate(i.dueDate)}`} meta={`${money(i.balance, i.currency)} · ${i.daysOverdue}d`} metaTone="danger" />
              ))
            )}
          </Panel>
        )}

        {showExpiring && (
          <Panel title="Expiring soon" count={expiring.length} href={canSee.licences ? '/modules/drivers-license-expiry' : '/modules/contract-renewal'} tone="warn">
            {expiring.length === 0 ? (
              <Empty>Nothing expiring in the next 30 days.</Empty>
            ) : (
              expiring.map((x) => (
                <Row key={`${x.href}-${x.id}`} href={x.href} title={x.title} subtitle={x.subtitle} meta={relativeDays(x.days)} metaTone={x.days < 0 ? 'danger' : x.days <= 14 ? 'warn' : 'neutral'} />
              ))
            )}
          </Panel>
        )}

        {canSee.tasks && (
          <Panel title="My tasks" count={tasks.length} href="/modules/todo-personal">
            {tasks.length === 0 ? (
              <Empty>Nothing due this week.</Empty>
            ) : (
              tasks.map((t) => (
                <Row
                  key={t.id}
                  href="/modules/todo-personal"
                  title={t.title}
                  subtitle={`${t.status} · ${t.priority} priority`}
                  meta={t.days === null ? null : relativeDays(t.days)}
                  metaTone={t.days !== null && t.days < 0 ? 'danger' : t.days !== null && t.days <= 1 ? 'warn' : 'neutral'}
                />
              ))
            )}
          </Panel>
        )}
      </section>

      {/* Modules */}
      <section className="space-y-4">
        <div className="flex items-end justify-between px-1">
          <div>
            <h3 className="text-lg font-bold text-primary">Your modules</h3>
            <p className="text-sm text-gray-500">{accessibleModules.length} workspaces assigned to you</p>
          </div>
          {isAdmin && (
            <Link href="/admin" className="text-sm font-bold text-primary transition-colors hover:text-secondary">
              Manage access →
            </Link>
          )}
        </div>

        {accessibleModules.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {accessibleModules.map((module) => (
              <Link
                key={module.id}
                href={`/modules/${module.slug}`}
                className="group flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 transition-all hover:border-secondary hover:shadow-md"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-primary transition-colors group-hover:bg-secondary/10">
                  {moduleIcon(module.slug)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-primary">{module.name}</span>
                  <span className="block truncate text-[11px] font-semibold uppercase tracking-wider text-gray-400">{module.category}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
            <h4 className="text-lg font-bold text-primary">No modules assigned</h4>
            <p className="mt-1 text-sm text-gray-500">Ask your administrator to grant access to the workspaces you need.</p>
          </div>
        )}
      </section>
    </main>
  );
}
