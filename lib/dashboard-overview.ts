import 'server-only';

import { prisma } from './prisma';
import { ADMIN_ROLE_NAME } from './rbac';
import { AccessUser, userHasRole } from './user';

/**
 * The operational picture for the dashboard: what needs the user's decision,
 * what is moving today, what is due, what is expiring, and what is on their
 * own list. Every section is gated by module access and loads concurrently;
 * a failing section degrades to empty rather than breaking the page.
 */

const DAY = 86_400_000;

export interface ApprovalItem {
  id: number;
  reference: string;
  title: string;
  customer: string;
  amount: number | null;
  currency: string | null;
  submittedAt: string | null;
  href: string;
}
export interface HandoverItem {
  id: number;
  post: string | null;
  status: string;
  period: string;
  shiftDate: string;
  summary: string;
}
export interface LeaveItem {
  id: string;
  person: string;
  type: string;
  startDate: string;
  endDate: string;
}
export interface MovementItem {
  id: number;
  reference: string;
  title: string;
  customer: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  vehicle: string | null;
  driver: string | null;
  officer: string | null;
}
export interface ItineraryTodayItem {
  id: number;
  tripId: number;
  tripTitle: string;
  description: string;
  timeLabel: string | null;
  scheduledAt: string | null;
  placeName: string | null;
}
export interface OverdueInvoiceItem {
  id: number;
  number: string;
  customer: string;
  balance: number;
  currency: string;
  dueDate: string;
  daysOverdue: number;
}
export interface ExpiryItem {
  id: number;
  title: string;
  subtitle: string;
  date: string;
  days: number;
  href: string;
}
export interface AgendaItem {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  tag: string | null;
}
export interface TaskItem {
  id: number;
  title: string;
  priority: string;
  status: string;
  dueDate: string | null;
  days: number | null;
}

export interface DashboardOverview {
  canSee: Record<'quotes' | 'invoices' | 'handover' | 'trips' | 'licences' | 'contracts' | 'calendar' | 'tasks' | 'leave', boolean>;
  approvals: { quotes: ApprovalItem[]; invoices: ApprovalItem[]; handovers: HandoverItem[]; leave: LeaveItem[] };
  movements: { trips: MovementItem[]; today: ItineraryTodayItem[] };
  money: { overdue: OverdueInvoiceItem[]; outstandingTotal: number; overdueTotal: number; currency: string };
  expiring: ExpiryItem[];
  agenda: AgendaItem[];
  tasks: TaskItem[];
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysFrom(date: Date, from = startOfToday()): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - from.getTime()) / DAY);
}
function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

async function safe<T>(label: string, work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch (error) {
    console.error(`[dashboard] ${label} failed:`, error);
    return fallback;
  }
}

export async function loadDashboardOverview(user: AccessUser): Promise<DashboardOverview> {
  const isAdmin = userHasRole(user, ADMIN_ROLE_NAME);
  const assigned = new Set(user.modules.map((m) => m.slug));
  const has = (slug: string) => isAdmin || assigned.has(slug);
  const canSee = {
    quotes: has('quotes'),
    invoices: has('invoices-review'),
    handover: has('handover'),
    trips: has('trip-planning'),
    licences: has('drivers-license-expiry') || has('drivers'),
    contracts: has('contract-renewal'),
    calendar: has('calendar'),
    tasks: has('todo-personal'),
    leave: isAdmin || has('shift-planning'),
  };

  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + DAY);
  const inTwoDays = new Date(today.getTime() + 2 * DAY);
  const inWeek = new Date(today.getTime() + 7 * DAY);
  const inMonth = new Date(today.getTime() + 30 * DAY);
  const weekAgo = new Date(today.getTime() - 7 * DAY);
  const none = <T,>(): T[] => [];

  const [quotes, invoices, handovers, leave, trips, overdueInvoices, outstanding, licences, contracts, events, todos] =
    await Promise.all([
      canSee.quotes
        ? safe('quotes', prisma.quote.findMany({
            where: { status: 'Submitted', ...(isAdmin ? {} : { approverId: user.id }) },
            orderBy: { submittedAt: 'asc' },
            take: 6,
            select: { id: true, reference: true, subject: true, total: true, currency: true, submittedAt: true, customer: { select: { name: true } } },
          }), none())
        : Promise.resolve(none<never>()),
      canSee.invoices
        ? safe('invoices', prisma.invoice.findMany({
            where: { status: 'Pending Approval', ...(isAdmin ? {} : { approverId: user.id }) },
            orderBy: { submittedAt: 'asc' },
            take: 6,
            select: { id: true, number: true, total: true, currency: true, submittedAt: true, customer: { select: { name: true } } },
          }), none())
        : Promise.resolve(none<never>()),
      canSee.handover
        ? safe('handovers', prisma.handoverEntry.findMany({
            where: { acknowledgedAt: null, status: { in: ['Attention', 'Urgent'] }, shiftDate: { gte: weekAgo } },
            orderBy: [{ status: 'desc' }, { shiftDate: 'desc' }],
            take: 5,
            select: { id: true, post: true, status: true, shiftPeriod: true, shiftDate: true, summary: true },
          }), none())
        : Promise.resolve(none<never>()),
      canSee.leave
        ? safe('leave', prisma.leaveRequest.findMany({
            where: { status: 'pending' },
            orderBy: { createdAt: 'asc' },
            take: 5,
            select: { id: true, type: true, startDate: true, endDate: true, user: { select: { name: true } } },
          }), none())
        : Promise.resolve(none<never>()),
      canSee.trips
        ? safe('trips', prisma.trip.findMany({
            where: {
              OR: [
                { status: 'Active' },
                { status: 'Planned', startDate: { gte: today, lt: inTwoDays } },
              ],
            },
            orderBy: { startDate: 'asc' },
            take: 6,
            select: {
              id: true, reference: true, title: true, status: true, startDate: true, endDate: true,
              customer: { select: { name: true } },
              assignments: {
                where: { status: { in: ['Planned', 'Confirmed', 'Active'] } },
                take: 1,
                select: { vehicle: { select: { registration: true } }, driver: { select: { name: true } }, officer: { select: { name: true, callSign: true } } },
              },
              items: {
                where: { scheduledAt: { gte: today, lt: tomorrow } },
                orderBy: { scheduledAt: 'asc' },
                take: 6,
                select: { id: true, description: true, timeLabel: true, scheduledAt: true, placeName: true },
              },
            },
          }), none())
        : Promise.resolve(none<never>()),
      canSee.invoices
        ? safe('overdue invoices', prisma.invoice.findMany({
            where: { status: { in: ['Sent', 'Partial'] }, dueDate: { lt: today } },
            orderBy: { dueDate: 'asc' },
            take: 6,
            select: { id: true, number: true, total: true, amountPaid: true, currency: true, dueDate: true, customer: { select: { name: true } } },
          }), none())
        : Promise.resolve(none<never>()),
      canSee.invoices
        ? safe('outstanding', prisma.invoice.findMany({
            where: { status: { in: ['Sent', 'Partial'] } },
            select: { total: true, amountPaid: true, dueDate: true, currency: true },
          }), none())
        : Promise.resolve(none<never>()),
      canSee.licences
        ? safe('licences', prisma.driverLicense.findMany({
            where: { expiryDate: { lte: inMonth } },
            orderBy: { expiryDate: 'asc' },
            take: 6,
            select: { id: true, driverName: true, licenseNumber: true, expiryDate: true },
          }), none())
        : Promise.resolve(none<never>()),
      canSee.contracts
        ? safe('contracts', prisma.contract.findMany({
            where: { status: { in: ['Active', 'In Renewal'] }, endDate: { lte: inMonth } },
            orderBy: { endDate: 'asc' },
            take: 6,
            select: { id: true, reference: true, counterpartyName: true, endDate: true },
          }), none())
        : Promise.resolve(none<never>()),
      canSee.calendar
        ? safe('agenda', prisma.calendarEvent.findMany({
            where: { userId: user.id, startsAt: { gte: today, lt: inWeek } },
            orderBy: { startsAt: 'asc' },
            take: 8,
            select: { id: true, title: true, startsAt: true, endsAt: true, allDay: true, location: true, tag: true },
          }), none())
        : Promise.resolve(none<never>()),
      canSee.tasks
        ? safe('tasks', prisma.personalTodo.findMany({
            where: { userId: user.id, completed: false, deletedAt: null, OR: [{ dueDate: { lte: inWeek } }, { priority: 'high' }] },
            orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
            take: 7,
            select: { id: true, title: true, priority: true, status: true, dueDate: true },
          }), none())
        : Promise.resolve(none<never>()),
    ]);

  const currency = outstanding[0]?.currency ?? 'USD';
  const outstandingTotal = outstanding.reduce((acc, i) => acc + Number(i.total) - Number(i.amountPaid), 0);
  const overdueTotal = outstanding
    .filter((i) => i.dueDate < today)
    .reduce((acc, i) => acc + Number(i.total) - Number(i.amountPaid), 0);

  const expiring: ExpiryItem[] = [
    ...licences.map((l) => ({ id: l.id, title: `${l.driverName} — licence`, subtitle: l.licenseNumber, date: l.expiryDate.toISOString(), days: daysFrom(l.expiryDate), href: '/modules/drivers-license-expiry' })),
    ...contracts.map((c) => ({ id: c.id, title: c.counterpartyName, subtitle: `Contract ${c.reference}`, date: c.endDate.toISOString(), days: daysFrom(c.endDate), href: '/modules/contract-renewal' })),
  ].sort((a, b) => a.days - b.days).slice(0, 7);

  return {
    canSee,
    approvals: {
      quotes: quotes.map((q) => ({ id: q.id, reference: q.reference, title: q.subject, customer: q.customer.name, amount: Number(q.total), currency: q.currency, submittedAt: iso(q.submittedAt), href: '/modules/quotes' })),
      invoices: invoices.map((i) => ({ id: i.id, reference: i.number, title: `Invoice ${i.number}`, customer: i.customer.name, amount: Number(i.total), currency: i.currency, submittedAt: iso(i.submittedAt), href: '/modules/invoices-review' })),
      handovers: handovers.map((h) => ({ id: h.id, post: h.post, status: h.status, period: h.shiftPeriod, shiftDate: h.shiftDate.toISOString(), summary: h.summary })),
      leave: leave.map((l) => ({ id: l.id, person: l.user.name, type: l.type, startDate: l.startDate, endDate: l.endDate })),
    },
    movements: {
      trips: trips.map((t) => {
        const a = t.assignments[0];
        return {
          id: t.id, reference: t.reference, title: t.title, customer: t.customer.name, status: t.status,
          startDate: iso(t.startDate), endDate: iso(t.endDate),
          vehicle: a?.vehicle?.registration ?? null, driver: a?.driver?.name ?? null,
          officer: a?.officer ? `${a.officer.name}${a.officer.callSign ? ` (${a.officer.callSign})` : ''}` : null,
        };
      }),
      today: trips
        .flatMap((t) => t.items.map((it) => ({ id: it.id, tripId: t.id, tripTitle: t.title, description: it.description, timeLabel: it.timeLabel, scheduledAt: iso(it.scheduledAt), placeName: it.placeName })))
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
        .slice(0, 8),
    },
    money: {
      overdue: overdueInvoices.map((i) => ({ id: i.id, number: i.number, customer: i.customer.name, balance: Number(i.total) - Number(i.amountPaid), currency: i.currency, dueDate: i.dueDate.toISOString(), daysOverdue: -daysFrom(i.dueDate) })),
      outstandingTotal,
      overdueTotal,
      currency,
    },
    expiring,
    agenda: events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt.toISOString(), endsAt: iso(e.endsAt), allDay: e.allDay, location: e.location, tag: e.tag })),
    tasks: todos.map((t) => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, dueDate: iso(t.dueDate), days: t.dueDate ? daysFrom(t.dueDate) : null })),
  };
}
