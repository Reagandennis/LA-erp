import 'server-only';

import { isOpenMaintenance, outstandingNextDue } from '@/lib/fleet';
import { listMaintenance } from '@/lib/fleet-server';
import { prisma } from '@/lib/prisma';

export type DueSource = 'invoice' | 'quote' | 'license' | 'contract' | 'sop' | 'trip' | 'calendar' | 'maintenance';

export type DueDateItem = {
  id: string; // stable composite key, e.g. "invoice-12"
  source: DueSource;
  sourceLabel: string;
  title: string;
  subtitle: string | null;
  date: string; // ISO due date
  daysRemaining: number;
  amount: number | null;
  currency: string | null;
  href: string;
};

export type DueDateBuckets = {
  total: number;
  overdue: number;
  dueThisWeek: number;
  dueThisMonth: number;
  later: number;
};

// How far back / forward to surface items.
const PAST_DAYS = 365;
const FUTURE_DAYS = 120;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysUntil(date: Date): number {
  const today = startOfToday();
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - today.getTime()) / 86400000);
}

function windowBounds(): { floor: Date; ceil: Date } {
  const floor = new Date(startOfToday().getTime() - PAST_DAYS * 86400000);
  const ceil = new Date(startOfToday().getTime() + FUTURE_DAYS * 86400000);
  return { floor, ceil };
}

/**
 * Aggregate dated, action-requiring items from across the platform into a single
 * upcoming-deadlines list. Read-only — derives from existing module data.
 * Calendar events are scoped to the current user; everything else is org-wide.
 */
export async function listUpcomingDueDates(userId: number): Promise<DueDateItem[]> {
  const { floor, ceil } = windowBounds();

  const [invoices, quotes, licenses, contracts, sops, trips, events, maintenance] = await Promise.all([
    prisma.invoice.findMany({
      where: { status: { in: ['Sent', 'Partial'] }, dueDate: { gte: floor, lte: ceil } },
      select: { id: true, number: true, dueDate: true, total: true, currency: true, customer: { select: { name: true } } },
    }),
    prisma.quote.findMany({
      where: { status: { in: ['Submitted', 'Approved', 'Sent'] }, expiryDate: { gte: floor, lte: ceil } },
      select: { id: true, reference: true, expiryDate: true, customer: { select: { name: true } } },
    }),
    prisma.driverLicense.findMany({
      where: { expiryDate: { gte: floor, lte: ceil } },
      select: { id: true, driverName: true, licenseNumber: true, expiryDate: true },
    }),
    prisma.contract.findMany({
      where: { status: { in: ['Active', 'In Renewal'] }, endDate: { gte: floor, lte: ceil } },
      select: { id: true, reference: true, counterpartyName: true, endDate: true, value: true, currency: true },
    }),
    prisma.sop.findMany({
      where: { status: 'Active', reviewDate: { gte: floor, lte: ceil } },
      select: { id: true, code: true, title: true, reviewDate: true },
    }),
    prisma.trip.findMany({
      where: { status: { notIn: ['Cancelled', 'Completed'] }, startDate: { gte: floor, lte: ceil } },
      select: { id: true, reference: true, title: true, startDate: true, customer: { select: { name: true } } },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, startsAt: { gte: floor, lte: ceil } },
      select: { id: true, title: true, startsAt: true },
    }),
    listMaintenance(),
  ]);

  const items: DueDateItem[] = [];

  for (const inv of invoices) {
    items.push({
      id: `invoice-${inv.id}`,
      source: 'invoice',
      sourceLabel: 'Invoice',
      title: `Invoice ${inv.number}`,
      subtitle: inv.customer?.name ?? null,
      date: inv.dueDate.toISOString(),
      daysRemaining: daysUntil(inv.dueDate),
      amount: Number(inv.total),
      currency: inv.currency,
      href: '/modules/invoices-review',
    });
  }

  for (const q of quotes) {
    items.push({
      id: `quote-${q.id}`,
      source: 'quote',
      sourceLabel: 'Quote',
      title: `Quote ${q.reference}`,
      subtitle: q.customer?.name ?? null,
      date: q.expiryDate.toISOString(),
      daysRemaining: daysUntil(q.expiryDate),
      amount: null,
      currency: null,
      href: `/modules/quotes/${q.id}/edit`,
    });
  }

  for (const lic of licenses) {
    items.push({
      id: `license-${lic.id}`,
      source: 'license',
      sourceLabel: 'License',
      title: `${lic.driverName} — license`,
      subtitle: lic.licenseNumber,
      date: lic.expiryDate.toISOString(),
      daysRemaining: daysUntil(lic.expiryDate),
      amount: null,
      currency: null,
      href: '/modules/drivers-license-expiry',
    });
  }

  for (const c of contracts) {
    items.push({
      id: `contract-${c.id}`,
      source: 'contract',
      sourceLabel: 'Contract',
      title: `Contract ${c.reference}`,
      subtitle: c.counterpartyName,
      date: c.endDate.toISOString(),
      daysRemaining: daysUntil(c.endDate),
      amount: c.value,
      currency: c.currency,
      href: '/modules/contract-renewal',
    });
  }

  for (const s of sops) {
    if (!s.reviewDate) continue;
    items.push({
      id: `sop-${s.id}`,
      source: 'sop',
      sourceLabel: 'SOP review',
      title: `Review: ${s.title}`,
      subtitle: s.code,
      date: s.reviewDate.toISOString(),
      daysRemaining: daysUntil(s.reviewDate),
      amount: null,
      currency: null,
      href: '/modules/sops',
    });
  }

  for (const t of trips) {
    if (!t.startDate) continue;
    items.push({
      id: `trip-${t.id}`,
      source: 'trip',
      sourceLabel: 'Trip',
      title: `Trip: ${t.title}`,
      subtitle: t.customer?.name ?? t.reference,
      date: t.startDate.toISOString(),
      daysRemaining: daysUntil(t.startDate),
      amount: null,
      currency: null,
      href: '/modules/trip-planning',
    });
  }

  for (const e of events) {
    items.push({
      id: `calendar-${e.id}`,
      source: 'calendar',
      sourceLabel: 'Calendar',
      title: e.title,
      subtitle: 'Calendar event',
      date: e.startsAt.toISOString(),
      daysRemaining: daysUntil(e.startsAt),
      amount: null,
      currency: null,
      href: '/modules/calendar',
    });
  }

  // Fleet: open work by its planned date, finished work by when it is due again.
  const inWindow = (date: Date) => date >= floor && date <= ceil;
  const fleetItem = (id: string, title: string, subtitle: string, key: string) => {
    const date = new Date(`${key}T00:00:00Z`);
    if (!inWindow(date)) return;
    items.push({
      id,
      source: 'maintenance',
      sourceLabel: 'Maintenance',
      title,
      subtitle,
      date: date.toISOString(),
      daysRemaining: daysUntil(new Date(`${key}T00:00:00`)),
      amount: null,
      currency: null,
      href: '/modules/car-maintenance',
    });
  };
  for (const m of maintenance) {
    if (isOpenMaintenance(m) && m.scheduledFor) {
      fleetItem(`maintenance-${m.id}`, `${m.category}: ${m.vehicle.registration}`, m.title, m.scheduledFor);
    }
  }
  for (const m of outstandingNextDue(maintenance)) {
    if (m.nextDueAt) {
      fleetItem(`maintenance-next-${m.id}`, `${m.category} due: ${m.vehicle.registration}`, m.title, m.nextDueAt);
    }
  }

  items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return items;
}

export function computeBuckets(items: DueDateItem[]): DueDateBuckets {
  return {
    total: items.length,
    overdue: items.filter((i) => i.daysRemaining < 0).length,
    dueThisWeek: items.filter((i) => i.daysRemaining >= 0 && i.daysRemaining <= 7).length,
    dueThisMonth: items.filter((i) => i.daysRemaining > 7 && i.daysRemaining <= 30).length,
    later: items.filter((i) => i.daysRemaining > 30).length,
  };
}
