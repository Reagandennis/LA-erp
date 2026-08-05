import 'server-only';

import { prisma } from './prisma';
import { DueDateBuckets, computeBuckets, listUpcomingDueDates } from './due-dates';
import { ADMIN_ROLE_NAME } from './rbac';
import { AccessUser, userHasRole } from './user';

/** How many tiles the dashboard hero shows. */
export const HIGHLIGHT_SLOT_COUNT = 4;

export type HighlightTone = 'neutral' | 'good' | 'warn' | 'danger';

export interface HighlightDefinition {
  key: string;
  label: string;
  description: string;
  /** Module the metric belongs to; null means every signed-in user may pick it. */
  moduleSlug: string | null;
  href: string;
}

export interface HighlightValue {
  key: string;
  label: string;
  href: string;
  value: number;
  caption: string;
  tone: HighlightTone;
}

interface HighlightContext {
  userId: number;
  /** Memoised per request — see `createDueDateBucketsLoader`. */
  dueDateBuckets: () => Promise<DueDateBuckets>;
}

type Loader = (
  context: HighlightContext,
) => Promise<{ value: number; caption: string; tone: HighlightTone }>;

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysFromToday(days: number) {
  return new Date(startOfToday().getTime() + days * 86400000);
}

/**
 * `listUpcomingDueDates` fans out across seven tables, so the two due-date
 * tiles share one memoised call per request instead of running it twice.
 */
function createDueDateBucketsLoader(userId: number) {
  let pending: Promise<DueDateBuckets> | null = null;

  return () => {
    pending ??= listUpcomingDueDates(userId).then(computeBuckets);
    return pending;
  };
}

const HIGHLIGHTS: Array<HighlightDefinition & { load: Loader }> = [
  {
    key: 'due-overdue',
    label: 'Overdue',
    description: 'Invoices, licences, contracts, SOP reviews and trips past their date.',
    moduleSlug: 'notification-center',
    href: '/modules/notification-center',
    load: async ({ dueDateBuckets }) => {
      const buckets = await dueDateBuckets();
      return {
        value: buckets.overdue,
        caption: buckets.overdue === 1 ? 'item past due' : 'items past due',
        tone: buckets.overdue > 0 ? 'danger' : 'good',
      };
    },
  },
  {
    key: 'due-this-week',
    label: 'Due this week',
    description: 'Everything falling due in the next seven days.',
    moduleSlug: 'notification-center',
    href: '/modules/notification-center',
    load: async ({ dueDateBuckets }) => {
      const buckets = await dueDateBuckets();
      return {
        value: buckets.dueThisWeek,
        caption: 'due within 7 days',
        tone: buckets.dueThisWeek > 0 ? 'warn' : 'good',
      };
    },
  },
  {
    key: 'my-open-tasks',
    label: 'My open tasks',
    description: 'Personal to-dos you have not completed yet.',
    moduleSlug: 'todo-personal',
    href: '/modules/todo-personal',
    load: async ({ userId }) => {
      const value = await prisma.personalTodo.count({
        where: { userId, completed: false, deletedAt: null },
      });
      return {
        value,
        caption: value === 1 ? 'task open' : 'tasks open',
        tone: 'neutral',
      };
    },
  },
  {
    key: 'my-overdue-tasks',
    label: 'My overdue tasks',
    description: 'Personal to-dos whose due date has already passed.',
    moduleSlug: 'todo-personal',
    href: '/modules/todo-personal',
    load: async ({ userId }) => {
      const value = await prisma.personalTodo.count({
        where: {
          userId,
          completed: false,
          deletedAt: null,
          dueDate: { lt: startOfToday() },
        },
      });
      return {
        value,
        caption: value === 1 ? 'task overdue' : 'tasks overdue',
        tone: value > 0 ? 'danger' : 'good',
      };
    },
  },
  {
    key: 'quotes-awaiting-approval',
    label: 'Quotes to approve',
    description: 'Quotes submitted and waiting on an approval decision.',
    moduleSlug: 'quotes',
    href: '/modules/quotes',
    load: async () => {
      const value = await prisma.quote.count({ where: { status: 'Submitted' } });
      return {
        value,
        caption: value === 1 ? 'quote awaiting review' : 'quotes awaiting review',
        tone: value > 0 ? 'warn' : 'neutral',
      };
    },
  },
  {
    key: 'invoices-unpaid',
    label: 'Unpaid invoices',
    description: 'Invoices issued but not yet settled in full.',
    moduleSlug: 'invoices-review',
    href: '/modules/invoices-review',
    load: async () => {
      const value = await prisma.invoice.count({
        where: { status: { in: ['Sent', 'Partial'] } },
      });
      return {
        value,
        caption: value === 1 ? 'invoice outstanding' : 'invoices outstanding',
        tone: value > 0 ? 'warn' : 'good',
      };
    },
  },
  {
    key: 'trips-active',
    label: 'Active trips',
    description: 'Trips currently planned or under way.',
    moduleSlug: 'trip-planning',
    href: '/modules/trip-planning',
    load: async () => {
      const value = await prisma.trip.count({
        where: { status: { in: ['Planned', 'Active'] } },
      });
      return {
        value,
        caption: value === 1 ? 'trip in motion' : 'trips in motion',
        tone: 'neutral',
      };
    },
  },
  {
    key: 'sops-to-acknowledge',
    label: 'SOPs to sign',
    description: 'Active SOPs you have not acknowledged at their current version.',
    moduleSlug: 'sops',
    href: '/modules/sops',
    load: async ({ userId }) => {
      const active = await prisma.sop.findMany({
        where: { status: 'Active' },
        select: { id: true, version: true },
      });

      if (active.length === 0) {
        return { value: 0, caption: 'all SOPs signed', tone: 'good' };
      }

      const acknowledged = await prisma.sopAcknowledgement.findMany({
        where: { userId, sopId: { in: active.map((sop) => sop.id) } },
        select: { sopId: true, version: true },
      });

      const signed = new Set(
        acknowledged.map((entry) => `${entry.sopId}:${entry.version}`),
      );
      const value = active.filter(
        (sop) => !signed.has(`${sop.id}:${sop.version}`),
      ).length;

      return {
        value,
        caption: value === 1 ? 'SOP needs your sign-off' : 'SOPs need your sign-off',
        tone: value > 0 ? 'warn' : 'good',
      };
    },
  },
  {
    key: 'events-this-week',
    label: 'Upcoming events',
    description: 'Your calendar entries over the next seven days.',
    moduleSlug: 'calendar',
    href: '/modules/calendar',
    load: async ({ userId }) => {
      const value = await prisma.calendarEvent.count({
        where: {
          userId,
          startsAt: { gte: startOfToday(), lte: daysFromToday(7) },
        },
      });
      return {
        value,
        caption: value === 1 ? 'event this week' : 'events this week',
        tone: 'neutral',
      };
    },
  },
  {
    key: 'licenses-expiring',
    label: 'Licences expiring',
    description: 'Driver licences lapsing within the next 30 days.',
    moduleSlug: 'drivers-license-expiry',
    href: '/modules/drivers-license-expiry',
    load: async () => {
      const value = await prisma.driverLicense.count({
        where: { expiryDate: { gte: startOfToday(), lte: daysFromToday(30) } },
      });
      return {
        value,
        caption: value === 1 ? 'licence expiring soon' : 'licences expiring soon',
        tone: value > 0 ? 'warn' : 'good',
      };
    },
  },
  {
    key: 'contracts-renewal',
    label: 'Contracts to renew',
    description: 'Contracts reaching their end date within 60 days.',
    moduleSlug: 'contract-renewal',
    href: '/modules/contract-renewal',
    load: async () => {
      const value = await prisma.contract.count({
        where: {
          status: { in: ['Active', 'In Renewal'] },
          endDate: { gte: startOfToday(), lte: daysFromToday(60) },
        },
      });
      return {
        value,
        caption: value === 1 ? 'contract up for renewal' : 'contracts up for renewal',
        tone: value > 0 ? 'warn' : 'neutral',
      };
    },
  },
  {
    key: 'feedback-open',
    label: 'Open feedback',
    description: 'Feedback still new or under review.',
    moduleSlug: 'feedback',
    href: '/modules/feedback',
    load: async () => {
      const value = await prisma.feedback.count({
        where: { status: { in: ['New', 'Under Review'] } },
      });
      return {
        value,
        caption: value === 1 ? 'item awaiting triage' : 'items awaiting triage',
        tone: 'neutral',
      };
    },
  },
];

export const DEFAULT_HIGHLIGHT_KEYS = [
  'due-overdue',
  'due-this-week',
  'my-open-tasks',
  'my-overdue-tasks',
];

function definitionOf(key: string) {
  return HIGHLIGHTS.find((highlight) => highlight.key === key) ?? null;
}

/** Highlights the user is allowed to pick, given their module assignments. */
export function listAvailableHighlights(
  user: AccessUser,
): HighlightDefinition[] {
  const isAdmin = userHasRole(user, ADMIN_ROLE_NAME);
  const assigned = new Set(user.modules.map((module) => module.slug));

  return HIGHLIGHTS.filter(
    (highlight) =>
      highlight.moduleSlug === null || isAdmin || assigned.has(highlight.moduleSlug),
  ).map(({ key, label, description, moduleSlug, href }) => ({
    key,
    label,
    description,
    moduleSlug,
    href,
  }));
}

/**
 * Narrows a stored selection to keys that still exist and that the user may
 * still see, then pads it with defaults so the hero always has four tiles.
 */
export function resolveHighlightKeys(user: AccessUser, stored: string[]) {
  const allowed = new Set(
    listAvailableHighlights(user).map((highlight) => highlight.key),
  );

  const chosen: string[] = [];

  for (const key of stored) {
    if (allowed.has(key) && !chosen.includes(key)) {
      chosen.push(key);
    }
  }

  for (const key of DEFAULT_HIGHLIGHT_KEYS) {
    if (chosen.length >= HIGHLIGHT_SLOT_COUNT) break;
    if (allowed.has(key) && !chosen.includes(key)) {
      chosen.push(key);
    }
  }

  // Still short (e.g. a user with very few modules) — take whatever is left.
  for (const highlight of listAvailableHighlights(user)) {
    if (chosen.length >= HIGHLIGHT_SLOT_COUNT) break;
    if (!chosen.includes(highlight.key)) {
      chosen.push(highlight.key);
    }
  }

  return chosen.slice(0, HIGHLIGHT_SLOT_COUNT);
}

export async function loadHighlightValues(
  user: AccessUser,
  keys: string[],
): Promise<HighlightValue[]> {
  const context: HighlightContext = {
    userId: user.id,
    dueDateBuckets: createDueDateBucketsLoader(user.id),
  };

  const values = await Promise.all(
    keys.map(async (key) => {
      const definition = definitionOf(key);

      if (!definition) {
        return null;
      }

      try {
        const result = await definition.load(context);
        return {
          key: definition.key,
          label: definition.label,
          href: definition.href,
          ...result,
        };
      } catch (error) {
        console.error(`[highlights] "${key}" failed to load`, error);
        return {
          key: definition.key,
          label: definition.label,
          href: definition.href,
          value: 0,
          caption: 'unavailable',
          tone: 'neutral' as HighlightTone,
        };
      }
    }),
  );

  return values.filter((value): value is HighlightValue => value !== null);
}
