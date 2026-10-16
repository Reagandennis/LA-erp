import 'server-only';

import { PEOPLE_VIEWS } from '../people-views';
import { prisma } from '../prisma';
import { buildAccessFilter as quoteAccessFilter } from '../quotes';
import { ADMIN_ROLE_NAME } from '../rbac';
import { buildAccessFilter as tripAccessFilter } from '../trips';
import { type AccessUser, userHasModule, userHasRole } from '../user';

/**
 * Global search: one query across every kind of record a person can open.
 *
 * Each searcher belongs to a module and only runs for people who can use
 * that module — many module APIs check only that someone is signed in, so
 * search enforces access itself rather than trusting them. Within a module
 * each searcher applies the same visibility rule the module does (trips and
 * quotes to their owners, notes and chats to their owner, and so on), and
 * selects only what it shows, never file or photo bytes.
 *
 * Matching is a case-insensitive substring match, which is quick at this
 * platform's sizes; a few extra rows are fetched so prefix matches can be
 * ranked first.
 */

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface SearchGroup {
  id: string;
  label: string;
  hits: SearchHit[];
}

interface Context {
  userId: number;
  isAdmin: boolean;
  can: (slug: string) => boolean;
  term: string;
}

interface Searcher {
  id: string;
  label: string;
  /** Runs when the person can use any of these modules (the searcher may narrow further). */
  modules: string[];
  run: (ctx: Context) => Promise<SearchHit[]>;
}

export const MIN_QUERY = 2;
export const MAX_QUERY = 80;
const SHOW = 5;
const FETCH = 12;

const like = (term: string) => ({ contains: term, mode: 'insensitive' as const });

const join = (...parts: Array<string | null | undefined | false>) =>
  parts.filter((p): p is string => Boolean(p && String(p).trim())).join(' · ') || null;

const day = (date: Date | null | undefined) =>
  date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

/** Up to this length, a match must start a word: "ali" finds Ali, not "Finalise". */
const WORD_START_UP_TO = 3;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Exact, then prefix, then word-start, then anywhere — stable within each.
 * `text` should cover every field the searcher matched on.
 */
function rank<T>(rows: T[], text: (row: T) => string, term: string): T[] {
  const t = term.toLowerCase();
  const wordStart = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(t)}`, 'iu');
  const score = (row: T) => {
    const value = text(row).toLowerCase();
    if (value === t) return 0;
    if (value.startsWith(t)) return 1;
    if (wordStart.test(value)) return 2;
    return 3;
  };
  return rows
    .map((row, i) => ({ row, i, s: score(row) }))
    .filter((x) => term.length > WORD_START_UP_TO || x.s < 3)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, SHOW)
    .map((x) => x.row);
}

/** All the searchable text of a row, for ranking. */
const fields = (...values: Array<string | null | undefined>) => values.filter(Boolean).join(' ');

/** A short excerpt of `text` around the first match. */
function excerpt(text: string, term: string, width = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(term.toLowerCase());
  if (flat.length <= width) return flat;
  const start = Math.max(0, Math.min(at - 30, flat.length - width));
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + width).trim()}${start + width < flat.length ? '…' : ''}`;
}

// --- Searchers -----------------------------------------------------------------

const searchers: Searcher[] = [
  {
    id: 'trips',
    label: 'Trips',
    modules: ['trip-planning'],
    async run({ term, userId, isAdmin }) {
      const rows = await prisma.trip.findMany({
        where: {
          AND: [
            tripAccessFilter(userId, isAdmin),
            { OR: [{ reference: like(term) }, { trackingCode: like(term) }, { title: like(term) }, { customer: { name: like(term) } }] },
          ],
        },
        select: { id: true, reference: true, title: true, status: true, startDate: true, customer: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.reference, r.title, r.customer?.name), term).map((r) => ({
        id: `trip-${r.id}`,
        title: r.title,
        subtitle: join(r.reference, r.status, r.customer?.name, day(r.startDate)),
        href: `/modules/trip-planning/${r.id}`,
      }));
    },
  },
  {
    id: 'tasks',
    label: 'Tasks',
    modules: ['todo-personal'],
    async run({ term, userId }) {
      const rows = await prisma.personalTodo.findMany({
        where: {
          deletedAt: null,
          OR: [{ userId }, { shares: { some: { userId } } }],
          AND: [{ OR: [{ title: like(term) }, { description: like(term) }] }],
        },
        select: { id: true, title: true, description: true, status: true, priority: true, dueDate: true, completed: true },
        orderBy: [{ completed: 'asc' }, { updatedAt: 'desc' }],
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.title, r.description), term).map((r) => ({
        id: `task-${r.id}`,
        title: r.title,
        subtitle: join(r.completed ? 'Done' : r.status, r.priority && `${r.priority} priority`, r.dueDate && `due ${day(r.dueDate)}`),
        href: `/modules/todo-personal?open=${r.id}`,
      }));
    },
  },
  {
    id: 'quotes',
    label: 'Quotes',
    modules: ['quotes'],
    async run({ term, userId, isAdmin }) {
      const rows = await prisma.quote.findMany({
        where: {
          AND: [
            quoteAccessFilter(userId, isAdmin),
            { OR: [{ reference: like(term) }, { trackingCode: like(term) }, { subject: like(term) }, { customer: { name: like(term) } }] },
          ],
        },
        select: { id: true, reference: true, subject: true, status: true, customer: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.reference, r.subject, r.customer?.name), term).map((r) => ({
        id: `quote-${r.id}`,
        title: r.subject || r.reference,
        subtitle: join(r.reference, r.status, r.customer?.name),
        href: `/modules/quotes/${r.id}/edit`,
      }));
    },
  },
  {
    id: 'invoices',
    label: 'Invoices',
    modules: ['invoices-review'],
    async run({ term }) {
      const rows = await prisma.invoice.findMany({
        where: { OR: [{ number: like(term) }, { customer: { name: like(term) } }] },
        select: { id: true, number: true, status: true, dueDate: true, customer: { select: { name: true } } },
        orderBy: { issueDate: 'desc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.number, r.customer?.name), term).map((r) => ({
        id: `invoice-${r.id}`,
        title: `Invoice ${r.number}`,
        subtitle: join(r.customer?.name, r.status, `due ${day(r.dueDate)}`),
        href: `/modules/invoices-review?open=${r.id}`,
      }));
    },
  },
  {
    id: 'customers',
    label: 'Customers',
    modules: ['customers'],
    async run({ term }) {
      const rows = await prisma.customer.findMany({
        where: { OR: [{ name: like(term) }, { company: like(term) }, { email: like(term) }, { phone: like(term) }] },
        select: { id: true, name: true, company: true, email: true, phone: true },
        orderBy: { name: 'asc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.name, r.company, r.email, r.phone), term).map((r) => ({
        id: `customer-${r.id}`,
        title: r.name,
        subtitle: join(r.company !== r.name && r.company, r.email, r.phone),
        href: `/modules/customers?open=${r.id}`,
      }));
    },
  },
  {
    id: 'contacts',
    label: 'Contacts',
    modules: ['contact-list'],
    async run({ term }) {
      const rows = await prisma.contact.findMany({
        where: { OR: [{ name: like(term) }, { email: like(term) }, { phone: like(term) }, { role: like(term) }, { location: like(term) }] },
        select: { id: true, name: true, role: true, category: true, email: true, phone: true, location: true },
        orderBy: { name: 'asc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.name, r.email, r.phone, r.role, r.location), term).map((r) => ({
        id: `contact-${r.id}`,
        title: r.name,
        subtitle: join(r.role, r.category, r.phone ?? r.email),
        href: `/modules/contact-list?open=${r.id}`,
      }));
    },
  },
  {
    id: 'people',
    label: 'People',
    modules: Object.keys(PEOPLE_VIEWS),
    async run({ term, can }) {
      // The full directory, or just the roles whose modules this person has.
      const everyone = can('personnel');
      const views = Object.values(PEOPLE_VIEWS).filter((v) => v.role && can(v.slug));
      const roles = views.map((v) => v.role!);
      if (!everyone && roles.length === 0) return [];

      const rows = await prisma.personnel.findMany({
        where: {
          ...(everyone ? {} : { roles: { hasSome: roles } }),
          OR: [{ name: like(term) }, { email: like(term) }, { phone: like(term) }, { callSign: like(term) }, { role: like(term) }],
        },
        select: { id: true, name: true, email: true, role: true, roles: true, department: true, callSign: true, phone: true },
        orderBy: { name: 'asc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.name, r.email, r.phone, r.callSign, r.role), term).map((r) => {
        const view = everyone ? PEOPLE_VIEWS.personnel : views.find((v) => r.roles.includes(v.role!)) ?? PEOPLE_VIEWS.personnel;
        return {
          id: `person-${r.id}`,
          title: r.name,
          subtitle: join(r.role ?? r.roles.join(', '), r.callSign && `“${r.callSign}”`, r.department),
          href: `/modules/${view.slug}?person=${r.id}`,
        };
      });
    },
  },
  {
    id: 'travelers',
    label: 'Travelers',
    modules: ['travelers'],
    async run({ term }) {
      // Name and contact details only: passports and medical notes are never searched.
      const rows = await prisma.traveler.findMany({
        where: { OR: [{ name: like(term) }, { email: like(term) }, { phone: like(term) }] },
        select: { id: true, name: true, email: true, phone: true, status: true, customer: { select: { name: true } } },
        orderBy: { name: 'asc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.name, r.email, r.phone), term).map((r) => ({
        id: `traveler-${r.id}`,
        title: r.name,
        subtitle: join(r.customer?.name, r.status),
        href: `/modules/travelers?open=${r.id}`,
      }));
    },
  },
  {
    id: 'vehicles',
    label: 'Vehicles',
    modules: ['vehicles'],
    async run({ term }) {
      const rows = await prisma.vehicle.findMany({
        where: { OR: [{ registration: like(term) }, { make: like(term) }, { model: like(term) }] },
        select: { id: true, registration: true, make: true, model: true, status: true },
        orderBy: { registration: 'asc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.registration, r.make, r.model), term).map((r) => ({
        id: `vehicle-${r.id}`,
        title: r.registration,
        subtitle: join([r.make, r.model].filter(Boolean).join(' '), r.status),
        href: '/modules/vehicles',
      }));
    },
  },
  {
    id: 'contracts',
    label: 'Contracts',
    modules: ['contract-renewal'],
    async run({ term }) {
      const rows = await prisma.contract.findMany({
        where: { OR: [{ reference: like(term) }, { counterpartyName: like(term) }, { email: like(term) }, { type: like(term) }] },
        select: { id: true, reference: true, counterpartyName: true, email: true, type: true, status: true, endDate: true },
        orderBy: { endDate: 'asc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.counterpartyName, r.reference, r.email, r.type), term).map((r) => ({
        id: `contract-${r.id}`,
        title: r.counterpartyName,
        subtitle: join(r.reference, r.type, r.status, `ends ${day(r.endDate)}`),
        href: `/modules/contract-renewal?open=${r.id}`,
      }));
    },
  },
  {
    id: 'sops',
    label: 'SOPs',
    modules: ['sops'],
    async run({ term }) {
      const rows = await prisma.sop.findMany({
        where: { OR: [{ code: like(term) }, { title: like(term) }, { category: like(term) }, { description: like(term) }] },
        select: { id: true, code: true, title: true, category: true, status: true, version: true, description: true },
        orderBy: { code: 'asc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.code, r.title, r.category, r.description), term).map((r) => ({
        id: `sop-${r.id}`,
        title: r.title,
        subtitle: join(r.code, r.category, r.status, r.version && `v${r.version}`),
        href: `/modules/sops?open=${r.id}`,
      }));
    },
  },
  {
    id: 'notes',
    label: 'Notes',
    modules: ['notes'],
    async run({ term, userId }) {
      const rows = await prisma.note.findMany({
        where: { userId, OR: [{ title: like(term) }, { content: like(term) }] },
        select: { id: true, title: true, content: true, category: true },
        orderBy: { updatedAt: 'desc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.title, r.content), term).map((r) => ({
        id: `note-${r.id}`,
        title: r.title || 'Untitled note',
        subtitle: join(r.category, excerpt(r.content, term, 70)),
        href: '/modules/notes',
      }));
    },
  },
  {
    id: 'files',
    label: 'Files',
    modules: ['file-upload'],
    async run({ term, userId }) {
      const rows = await prisma.storedFile.findMany({
        where: {
          OR: [{ uploadedById: userId }, { shares: { some: { userId } } }],
          AND: [{ OR: [{ name: like(term) }, { description: like(term) }, { tags: { has: term } }] }],
        },
        select: { id: true, name: true, description: true, tags: true, size: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.name, r.description, ...r.tags), term).map((r) => ({
        id: `file-${r.id}`,
        title: r.name,
        subtitle: join(r.size >= 1024 * 1024 ? `${(r.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(r.size / 1024))} KB`, day(r.updatedAt)),
        href: '/modules/file-upload',
      }));
    },
  },
  {
    id: 'handover',
    label: 'Handovers',
    modules: ['handover'],
    async run({ term }) {
      const rows = await prisma.handoverEntry.findMany({
        where: { OR: [{ post: like(term) }, { summary: like(term) }, { incidents: like(term) }, { watchItems: like(term) }] },
        select: { id: true, post: true, shiftPeriod: true, shiftDate: true, status: true, summary: true, incidents: true, watchItems: true },
        orderBy: { shiftDate: 'desc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.post, r.summary, r.incidents, r.watchItems), term).map((r) => ({
        id: `handover-${r.id}`,
        title: join(r.post ?? 'Handover', r.shiftPeriod, day(r.shiftDate)) ?? 'Handover',
        subtitle: join(r.status, excerpt(r.summary, term, 70)),
        href: '/modules/handover',
      }));
    },
  },
  {
    id: 'intel',
    label: 'Intel reports',
    modules: ['intel'],
    async run({ term }) {
      const rows = await prisma.intelAssessment.findMany({
        where: { OR: [{ title: like(term) }, { location: like(term) }, { country: like(term) }, { formattedAddress: like(term) }] },
        select: { id: true, title: true, location: true, country: true, formattedAddress: true, riskLevel: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.title, r.location, r.country, r.formattedAddress), term).map((r) => ({
        id: `intel-${r.id}`,
        title: r.title,
        subtitle: join(r.location, r.riskLevel && `${r.riskLevel} risk`, day(r.createdAt)),
        href: '/modules/intel',
      }));
    },
  },
  {
    id: 'products',
    label: 'Products & services',
    modules: ['products-services'],
    async run({ term }) {
      const rows = await prisma.product.findMany({
        where: { OR: [{ name: like(term) }, { sku: like(term) }, { description: like(term) }] },
        select: { id: true, name: true, sku: true, description: true, archived: true },
        orderBy: [{ archived: 'asc' }, { name: 'asc' }],
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.name, r.sku, r.description), term).map((r) => ({
        id: `product-${r.id}`,
        title: r.name,
        subtitle: join(r.sku, r.archived && 'Archived'),
        href: '/modules/products-services',
      }));
    },
  },
  {
    id: 'licences',
    label: 'Driver licences',
    modules: ['drivers-license-expiry'],
    async run({ term, can }) {
      const rows = await prisma.driverLicense.findMany({
        where: { OR: [{ driverName: like(term) }, { licenseNumber: like(term) }] },
        select: { id: true, driverName: true, licenseNumber: true, category: true, expiryDate: true, personnelId: true },
        orderBy: { expiryDate: 'asc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.driverName, r.licenseNumber), term).map((r) => ({
        id: `licence-${r.id}`,
        title: r.driverName,
        subtitle: join(r.licenseNumber, r.category, `expires ${day(r.expiryDate)}`),
        href: r.personnelId && can('drivers') ? `/modules/drivers?person=${r.personnelId}` : '/modules/drivers-license-expiry',
      }));
    },
  },
  {
    id: 'calendar',
    label: 'Calendar',
    modules: ['calendar'],
    async run({ term, userId }) {
      const rows = await prisma.calendarEvent.findMany({
        where: { userId, OR: [{ title: like(term) }, { location: like(term) }, { description: like(term) }] },
        select: { id: true, title: true, location: true, description: true, startsAt: true },
        orderBy: { startsAt: 'desc' },
        take: FETCH,
      });
      return rank(rows, (r) => fields(r.title, r.location, r.description), term).map((r) => ({
        id: `event-${r.id}`,
        title: r.title,
        subtitle: join(day(r.startsAt), r.location),
        href: '/modules/calendar',
      }));
    },
  },
  {
    id: 'chats',
    label: 'Chats',
    modules: ['whatsapp', 'telegram', 'signal'],
    async run(ctx) {
      const accounts = await ownMessagingAccounts(ctx);
      if (accounts.size === 0) return [];
      const rows = await prisma.messagingChat.findMany({
        where: { accountId: { in: [...accounts.keys()] }, name: like(ctx.term) },
        select: { accountId: true, chatId: true, name: true, kind: true, lastMessageAt: true },
        orderBy: { lastMessageAt: 'desc' },
        take: FETCH,
      });
      return rank(rows, (r) => r.name, ctx.term).map((r) => {
        const account = accounts.get(r.accountId)!;
        return {
          id: `chat-${r.accountId}-${r.chatId}`,
          title: r.name,
          subtitle: join(account.name, r.kind === 'group' ? 'Group' : null, account.label),
          href: chatHref(account.provider, r.accountId, r.chatId),
        };
      });
    },
  },
  {
    id: 'messages',
    label: 'Messages',
    modules: ['whatsapp', 'telegram', 'signal'],
    async run(ctx) {
      const accounts = await ownMessagingAccounts(ctx);
      if (accounts.size === 0) return [];
      const rows = await prisma.messagingMessage.findMany({
        where: { accountId: { in: [...accounts.keys()] }, text: like(ctx.term) },
        select: { id: true, accountId: true, chatId: true, text: true, senderName: true, at: true },
        orderBy: { at: 'desc' },
        take: FETCH * 2,
      });
      const ranked = rank(rows, (r) => r.text, ctx.term);
      if (ranked.length === 0) return [];
      const chats = await prisma.messagingChat.findMany({
        where: { OR: ranked.map((r) => ({ accountId: r.accountId, chatId: r.chatId })) },
        select: { accountId: true, chatId: true, name: true },
      });
      const chatName = new Map(chats.map((c) => [`${c.accountId}:${c.chatId}`, c.name]));
      return ranked.map((r) => {
        const account = accounts.get(r.accountId)!;
        // Channels and unknown senders come through as raw ids; those say nothing.
        const sender = r.senderName.includes('@') ? null : r.senderName;
        return {
          id: `message-${r.id}`,
          title: excerpt(r.text, ctx.term),
          subtitle: join(sender, chatName.get(`${r.accountId}:${r.chatId}`), account.name, day(r.at)),
          href: chatHref(account.provider, r.accountId, r.chatId),
        };
      });
    },
  },
];

const SERVICE_NAMES: Record<string, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram', signal: 'Signal' };

/** The person's own linked accounts — never anyone else's, admins included. */
async function ownMessagingAccounts(ctx: Context) {
  const providers = ['whatsapp', 'telegram', 'signal'].filter((p) => ctx.can(p));
  const rows = await prisma.messagingAccount.findMany({
    where: { userId: ctx.userId, provider: { in: providers } },
    select: { id: true, provider: true, label: true },
  });
  return new Map(rows.map((a) => [a.id, { provider: a.provider, label: a.label, name: SERVICE_NAMES[a.provider] ?? a.provider }]));
}

function chatHref(provider: string, accountId: number, chatId: string): string {
  return `/modules/${provider}?account=${accountId}&chat=${encodeURIComponent(chatId)}`;
}

// --- Entry point ---------------------------------------------------------------

export async function searchEverything(user: AccessUser, query: string): Promise<SearchGroup[]> {
  const term = query.trim().slice(0, MAX_QUERY);
  if (term.length < MIN_QUERY) return [];

  const isAdmin = userHasRole(user, ADMIN_ROLE_NAME);
  const can = (slug: string) => isAdmin || userHasModule(user, slug);
  const ctx: Context = { userId: user.id, isAdmin, can, term };

  const active = searchers.filter((s) => s.modules.some(can));
  const results = await Promise.all(
    active.map(async (searcher) => {
      try {
        return { id: searcher.id, label: searcher.label, hits: await searcher.run(ctx) };
      } catch (error) {
        // One failing source must not blank the whole search.
        console.error(`[search] ${searcher.id} failed:`, error instanceof Error ? error.message : error);
        return { id: searcher.id, label: searcher.label, hits: [] };
      }
    }),
  );
  return results.filter((group) => group.hits.length > 0);
}
