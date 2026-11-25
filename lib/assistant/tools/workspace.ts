import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import {
  CONTACT_CATEGORIES,
  type ContactSummary,
  contactVisibleTo,
  createContact,
  deleteContact,
  listContacts,
  updateContact,
} from '@/lib/contacts';
import {
  CONTRACT_DISPLAY_STATUSES,
  CONTRACT_LIFECYCLE,
  CONTRACT_TYPES,
  type ContractSummary,
  computeStats as contractStats,
  createContract,
  listContracts,
  updateContract,
} from '@/lib/contracts';
import { type DueDateItem, type DueSource, listUpcomingDueDates } from '@/lib/due-dates';
import { listFiles } from '@/lib/files';
import {
  HANDOVER_STATUSES,
  type HandoverDetail,
  SHIFT_PERIODS,
  acknowledgeHandover,
  createHandover,
  getHandover,
  listHandovers,
} from '@/lib/handover';
import { notifyIncomingShift, settleHandoverNotifications } from '@/lib/handover-notifications';
import { NOTE_CATEGORIES, NOTE_COLORS, type NoteSummary, createNote, deleteNote, listNotes, updateNote } from '@/lib/notes';
import { PEOPLE_VIEWS, PERSONNEL_ROLES, type PersonnelRole } from '@/lib/people-views';
import { PERSONNEL_STATUSES, type PersonnelLicence, getPersonnelById, listPersonnel } from '@/lib/personnel';
import { prisma } from '@/lib/prisma';
import { plainText } from '@/lib/rich-text';
import { utcToZoned } from '@/lib/zoned-time';

import { asString, type JsonSchema, type ToolContext, type ToolDefinition, ToolRefusal } from '../types';
import {
  audit,
  changedFields,
  localStamp,
  matches,
  optAmount,
  optCurrency,
  optDate,
  optEnum,
  optFlag,
  optId,
  optText,
  pageOf,
  reqDate,
  reqId,
  reqText,
  requireChange,
  todayIn,
} from './_shared';

type Args = Record<string, unknown>;

const PAGE_SIZE = 20;

const clip = (text: string | null | undefined, max: number) => (text && text.length > max ? `${text.slice(0, max)}…` : (text ?? null));

/** The day a stored instant falls on where the user is. */
const localDate = (iso: string | null | undefined, zone: string) => (iso ? utcToZoned(iso, zone).date || null : null);

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** A row without its empty fields: every result is carried through the rest of the conversation. */
const compact = <T extends Record<string, unknown>>(row: T) =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)));

/** The lib's own "no" (a plain Error with a message for the user) is a refusal; a database fault stays a fault. */
async function attempt<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof Error && error.constructor === Error) throw new ToolRefusal(error.message);
    throw error;
  }
}

/** Text given for a field: a value sets it; null clears it where the schema allows null. */
function putText(patch: Args, args: Args, key: string, max: number): void {
  const value = optText(args, key, { max });
  if (value !== undefined) patch[key] = value;
}

const requireSomething = (patch: Args, what: string) => {
  if (Object.keys(patch).length === 0) throw new ToolRefusal(`Say what to change on the ${what}.`);
};

const quoted = (args: Args, key: string, fallback: string) => (asString(args[key]) ? `"${asString(args[key])}"` : fallback);

// --- Notes (personal) -------------------------------------------------------

const NOTES_HREF = '/modules/notes';
const NOTE_FIELDS = ['title', 'content', 'category', 'color', 'pinned'] as const;

async function loadNote(id: number, ctx: ToolContext): Promise<NoteSummary> {
  const note = (await listNotes(ctx.userId)).find((n) => n.id === id);
  if (!note) throw new ToolRefusal(`Note ${id} was not found among this user's notes. Find it with list_notes.`);
  return note;
}

const listNotesTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.notes,
  functionDeclaration: {
    name: 'list_notes',
    description: `The user's own notes, pinned first, then most recently edited. ${PAGE_SIZE} per page.`,
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Words in the title, text or category' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const rows = (await listNotes(ctx.userId)).filter((n) => matches(q, n.title, n.content, n.category));
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      notes: page.rows.map((n) => ({
        id: n.id,
        title: n.title,
        content: clip(n.content, 300),
        category: n.category,
        color: n.color,
        pinned: n.pinned,
        edited: localStamp(n.updatedAt, ctx.timeZone),
      })),
    };
  },
};

const createNoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: API_ACCESS.notes,
  functionDeclaration: {
    name: 'create_note',
    description: 'Write a personal note for the user.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        category: { type: 'string', enum: [...NOTE_CATEGORIES], description: 'Default Work' },
        color: { type: 'string', enum: [...NOTE_COLORS], description: 'Default yellow' },
        pinned: { type: 'boolean' },
      },
      required: ['title'],
    },
  },
  async handler(args, ctx) {
    const input = {
      userId: ctx.userId,
      title: reqText(args, 'title', { max: 200 }),
      content: optText(args, 'content', { max: 20000 }) ?? '',
      category: optEnum(args, 'category', NOTE_CATEGORIES),
      color: optEnum(args, 'color', NOTE_COLORS),
      pinned: optFlag(args, 'pinned') ?? false,
    };
    const note = await attempt(() => createNote(input));
    await audit({
      action: 'ai.note.create', entityType: 'Note', entityId: String(note.id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return {
      id: note.id,
      title: note.title,
      category: note.category,
      color: note.color,
      pinned: note.pinned,
      href: NOTES_HREF,
      summary: `Wrote the note "${note.title}"`,
    };
  },
};

const updateNoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: API_ACCESS.notes,
  functionDeclaration: {
    name: 'update_note',
    description:
      "Change one of the user's notes: title, text, category, colour, pinned. New text needs contentMode: append adds it under what is there, replace discards what is there. Send only what should change.",
    parameters: {
      type: 'object',
      properties: {
        noteId: { type: 'integer' },
        title: { type: 'string' },
        content: { type: 'string' },
        contentMode: { type: 'string', enum: ['append', 'replace'], description: 'Required with content' },
        category: { type: 'string', enum: [...NOTE_CATEGORIES] },
        color: { type: 'string', enum: [...NOTE_COLORS] },
        pinned: { type: 'boolean' },
      },
      required: ['noteId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'noteId', 'use list_notes');
    const before = await loadNote(id, ctx);

    const patch: Parameters<typeof updateNote>[2] = {};
    const title = optText(args, 'title', { max: 200 });
    if (title != null) patch.title = title;
    const content = optText(args, 'content', { max: 20000 });
    const mode = optEnum(args, 'contentMode', ['append', 'replace'] as const);
    if (content != null) {
      if (!mode) {
        throw new ToolRefusal(
          `Say how to apply the text: contentMode "append" adds it under what is there, "replace" discards what is there (${before.content.length} characters now).`,
        );
      }
      patch.content = mode === 'append' && before.content.trim() ? `${before.content.trimEnd()}\n\n${content}` : content;
    } else if (mode) {
      throw new ToolRefusal('contentMode was given without content.');
    }
    const category = optEnum(args, 'category', NOTE_CATEGORIES);
    if (category) patch.category = category;
    const color = optEnum(args, 'color', NOTE_COLORS);
    if (color) patch.color = color;
    const pinned = optFlag(args, 'pinned');
    if (pinned !== undefined) patch.pinned = pinned;
    requireSomething(patch, 'note');

    const after = await attempt(() => updateNote(id, ctx.userId, patch));
    if (!after) throw new ToolRefusal(`Note ${id} was not found.`);
    const changed = changedFields(before, after, NOTE_FIELDS);
    requireChange(changed, `the note "${before.title}"`);
    if (changed.content) changed.content = { from: clip(before.content, 120), to: clip(after.content, 120) };
    await audit({
      action: 'ai.note.update', entityType: 'Note', entityId: String(id),
      actorUserId: ctx.userId, metadata: { fields: Object.keys(changed) }, request: ctx.request,
    });
    return { id, title: after.title, changed, href: NOTES_HREF, summary: `Updated the note "${after.title}": ${Object.keys(changed).join(', ')}` };
  },
};

const deleteNoteTool: ToolDefinition = {
  destructive: true,
  requiredModule: API_ACCESS.notes,
  confirmLabel: (args) => `Delete the note ${quoted(args, 'title', `#${args.noteId}`)}`,
  functionDeclaration: {
    name: 'delete_note',
    description: "Delete one of the user's notes. Cannot be undone.",
    parameters: {
      type: 'object',
      properties: {
        noteId: { type: 'integer' },
        title: { type: 'string', description: "The note's title, shown to the user when they confirm" },
      },
      required: ['noteId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'noteId');
    const note = await loadNote(id, ctx);
    const ok = await deleteNote(id, ctx.userId);
    if (!ok) throw new ToolRefusal(`Note ${id} was not found.`);
    await audit({
      action: 'ai.note.delete', entityType: 'Note', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { deleted: true, noteId: id, href: NOTES_HREF, summary: `Deleted the note "${note.title}"` };
  },
};

// --- Contacts ---------------------------------------------------------------

const contactHref = (id: number) => `/modules/contact-list?open=${id}`;
const CONTACT_FIELDS = ['name', 'role', 'category', 'email', 'phone', 'location', 'notes', 'tags', 'client'] as const;

type ContactFacts = Pick<ContactSummary, 'name' | 'role' | 'category' | 'email' | 'phone' | 'location' | 'notes' | 'tags' | 'customer'>;

const contactFacts = (c: ContactFacts): Record<string, unknown> => ({
  name: c.name,
  role: c.role,
  category: c.category,
  email: c.email,
  phone: c.phone,
  location: c.location,
  notes: c.notes,
  tags: c.tags ?? [],
  client: c.customer?.name ?? null,
});

/** A contact this user may see: someone else's synced Google contact answers "not found", as on the page. */
async function loadContact(id: number, ctx: ToolContext) {
  const row = await prisma.contact.findFirst({
    where: { id, ...contactVisibleTo(ctx.userId) },
    select: {
      id: true, name: true, role: true, category: true, email: true, phone: true, location: true, notes: true, tags: true,
      customer: { select: { id: true, name: true, company: true } },
    },
  });
  if (!row) throw new ToolRefusal(`Contact ${id} was not found. Find it with list_contacts.`);
  return row;
}

/** The lib links nothing, without a word, when the client does not exist: check first. */
async function requireClient(customerId: number): Promise<void> {
  const client = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!client) throw new ToolRefusal(`Client ${customerId} was not found, so nothing was saved. Find the client's id with search_platform.`);
}

function readTags(args: Args): string[] | undefined {
  if (args.tags === undefined || args.tags === null) return undefined;
  const out: string[] = [];
  for (const raw of args.tags as unknown[]) {
    const tag = asString(raw);
    if (!tag) throw new ToolRefusal('tags cannot contain a blank tag.');
    if (!out.some((existing) => existing.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  if (out.length > 20) throw new ToolRefusal('A contact takes at most 20 tags.');
  return out;
}

const contactProperties: Record<string, JsonSchema> = {
  role: { type: 'string', description: 'Job title; null clears it', nullable: true },
  email: { type: 'string', description: 'null clears it', nullable: true },
  phone: { type: 'string', description: 'null clears it', nullable: true },
  location: { type: 'string', description: 'null clears it', nullable: true },
  notes: { type: 'string', description: 'null clears them', nullable: true },
  tags: { type: 'array', description: 'Replaces the tags (max 20)', items: { type: 'string' } },
  customerId: { type: 'integer', description: 'The client they belong to (id from search_platform); null unlinks', nullable: true },
};

/** The optional fields create and update share, as the page would send them. */
async function readContactFields(args: Args): Promise<Args> {
  const fields: Args = {};
  putText(fields, args, 'role', 120);
  putText(fields, args, 'email', 160);
  putText(fields, args, 'phone', 60);
  putText(fields, args, 'location', 200);
  putText(fields, args, 'notes', 4000);
  const tags = readTags(args);
  if (tags) fields.tags = tags;
  const category = optEnum(args, 'category', CONTACT_CATEGORIES);
  if (category) fields.category = category;
  const customerId = optId(args, 'customerId');
  if (customerId !== undefined) {
    if (customerId) await requireClient(customerId);
    fields.customerId = customerId;
  }
  return fields;
}

const contactView = (c: ContactFacts & { id: number }) =>
  compact({
    id: c.id,
    name: c.name,
    role: c.role,
    category: c.category,
    email: c.email,
    phone: c.phone,
    client: c.customer?.name ?? null,
    clientCompany: c.customer?.company ?? null,
    location: c.location,
    tags: c.tags,
  });

const listContactsTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.contacts,
  functionDeclaration: {
    name: 'list_contacts',
    description: `Find people in the contact directory by name, job title, email, phone, or their client's name or company. Returns phone, email, category and linked client. ${PAGE_SIZE} per page.`,
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Name, job title, email, phone, client or company' },
        category: { type: 'string', enum: [...CONTACT_CATEGORIES] },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const category = optEnum(args, 'category', CONTACT_CATEGORIES);
    // What this person sees in the directory: never someone else's Google contacts.
    const rows = (await listContacts(ctx.userId)).filter(
      (c) =>
        (!category || c.category === category) &&
        matches(q, c.name, c.role, c.email, c.phone, c.customer?.name, c.customer?.company, c.location, ...c.tags),
    );
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      contacts: page.rows.map((c) => ({ ...contactView(c), ...(c.private ? { fromMyGoogle: true } : {}) })),
    };
  },
};

const createContactTool: ToolDefinition = {
  destructive: false,
  requiredModule: API_ACCESS.contacts,
  functionDeclaration: {
    name: 'create_contact',
    description: 'Add a person to the contact directory, optionally linked to a client.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string', enum: [...CONTACT_CATEGORIES], description: 'Default Client' },
        ...contactProperties,
      },
      required: ['name'],
    },
  },
  async handler(args, ctx) {
    const name = reqText(args, 'name', { max: 160 });
    const fields = await readContactFields(args);
    const contact = await attempt(() => createContact({ userId: ctx.userId, name, ...fields }));
    await audit({
      action: 'ai.contact.create', entityType: 'Contact', entityId: String(contact.id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return {
      ...contactView(contact),
      // Said outright, so a link that was not asked for is never implied.
      client: contact.customer?.name ?? null,
      href: contactHref(contact.id),
      summary: `Added ${contact.name} to the contacts as ${contact.category}${contact.customer ? `, linked to ${contact.customer.name}` : ''}`,
    };
  },
};

const updateContactTool: ToolDefinition = {
  destructive: false,
  requiredModule: API_ACCESS.contacts,
  functionDeclaration: {
    name: 'update_contact',
    description: 'Change a contact: name, job title, category, email, phone, location, notes, tags, linked client. Send only what should change.',
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'integer' },
        name: { type: 'string' },
        category: { type: 'string', enum: [...CONTACT_CATEGORIES] },
        ...contactProperties,
      },
      required: ['contactId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'contactId', 'use list_contacts');
    const before = await loadContact(id, ctx);
    const patch = await readContactFields(args);
    const name = optText(args, 'name', { max: 160 });
    if (name != null) patch.name = name;
    requireSomething(patch, 'contact');

    const after = await attempt(() => updateContact(id, patch, ctx.userId));
    if (!after) throw new ToolRefusal(`Contact ${id} was not found.`);
    const changed = changedFields(contactFacts(before), contactFacts(after), CONTACT_FIELDS);
    requireChange(changed, `the contact ${before.name}`);
    await audit({
      action: 'ai.contact.update', entityType: 'Contact', entityId: String(id),
      actorUserId: ctx.userId, metadata: { fields: Object.keys(changed) }, request: ctx.request,
    });
    return { id, name: after.name, changed, href: contactHref(id), summary: `Updated the contact ${after.name}: ${Object.keys(changed).join(', ')}` };
  },
};

const deleteContactTool: ToolDefinition = {
  destructive: true,
  requiredModule: API_ACCESS.contacts,
  confirmLabel: (args) => `Delete the contact ${asString(args.name) ?? `#${args.contactId}`} from the directory`,
  functionDeclaration: {
    name: 'delete_contact',
    description: 'Delete a person from the contact directory. Cannot be undone.',
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'integer' },
        name: { type: 'string', description: "The contact's name, shown to the user when they confirm" },
      },
      required: ['contactId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'contactId');
    const contact = await loadContact(id, ctx);
    const ok = await deleteContact(id, ctx.userId);
    if (!ok) throw new ToolRefusal(`Contact ${id} was not found.`);
    await audit({
      action: 'ai.contact.delete', entityType: 'Contact', entityId: String(id),
      actorUserId: ctx.userId, metadata: { name: contact.name }, request: ctx.request,
    });
    return { deleted: true, contactId: id, href: '/modules/contact-list', summary: `Deleted the contact ${contact.name}` };
  },
};

// --- Files ------------------------------------------------------------------

const listFilesTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.files,
  functionDeclaration: {
    name: 'list_my_files',
    description: `Files the user uploaded and files shared with them, newest first (name, size, tags, owner). ${PAGE_SIZE} per page.`,
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: "Words in the name, description, tags or the owner's name" },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const rows = (await listFiles(ctx.userId)).filter((f) => matches(q, f.name, f.description, f.uploadedBy.name, ...f.tags));
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      files: page.rows.map((f) =>
        compact({
          id: f.id,
          name: f.name,
          description: clip(f.description, 160),
          sizeBytes: f.size,
          mimeType: f.mimeType,
          tags: f.tags,
          owner: f.uploadedBy.name,
          mine: f.isOwner,
          uploaded: localDate(f.createdAt, ctx.timeZone),
        }),
      ),
      href: '/modules/file-upload',
    };
  },
};

// --- Due dates (Notification Center) ---------------------------------------

const DUE_WINDOWS = ['overdue', 'week', 'month'] as const;
const DUE_SOURCES: readonly DueSource[] = ['invoice', 'quote', 'license', 'contract', 'sop', 'trip', 'calendar', 'maintenance'];
/** With no window asked for, the overdue items ride along as a short list under what is coming up. */
const OVERDUE_SHOWN = 10;

const listDueDatesTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: 'notification-center',
  functionDeclaration: {
    name: 'list_upcoming_due_dates',
    description:
      'Deadlines across the platform (invoices, quotes, licences, contracts, SOP reviews, trips, maintenance, the user\'s calendar). ' +
      `Returns what is coming up, soonest first, and what is overdue, most recent first, with counts. ${PAGE_SIZE} per page.`,
    parameters: {
      type: 'object',
      properties: {
        window: { type: 'string', enum: [...DUE_WINDOWS], description: 'overdue only; or due within a week / a month. Default: everything coming up' },
        source: { type: 'string', enum: [...DUE_SOURCES] },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const zone = ctx.timeZone;
    const window = optEnum(args, 'window', DUE_WINDOWS);
    const source = optEnum(args, 'source', DUE_SOURCES);
    const today = todayIn(zone);

    const all = (await listUpcomingDueDates(ctx.userId))
      .filter((item) => !source || item.source === source)
      .map((item) => {
        const date = localDate(item.date, zone) ?? today;
        return { item, date, days: daysBetween(today, date) };
      });
    const upcoming = all.filter((row) => row.days >= 0).sort((a, b) => a.days - b.days || a.item.date.localeCompare(b.item.date));
    const overdue = all.filter((row) => row.days < 0).sort((a, b) => b.days - a.days || b.item.date.localeCompare(a.item.date));

    const view = ({ item, date, days }: { item: DueDateItem; date: string; days: number }) =>
      compact({
        title: item.title,
        source: item.sourceLabel,
        detail: item.subtitle,
        date,
        ...(days < 0 ? { daysOverdue: -days } : { daysRemaining: days }),
        amount: item.amount,
        currency: item.amount != null ? item.currency : null,
        href: item.href,
      });

    const counts = {
      overdue: overdue.length,
      dueThisWeek: upcoming.filter((row) => row.days <= 7).length,
      dueThisMonth: upcoming.filter((row) => row.days > 7 && row.days <= 30).length,
      later: upcoming.filter((row) => row.days > 30).length,
    };
    if (window === 'overdue') {
      const page = pageOf(overdue, args, PAGE_SIZE);
      return { today, counts, overdue: page.rows.map(view), page: page.page, total: page.total, more: page.more };
    }
    const wanted = window === 'week' ? upcoming.filter((row) => row.days <= 7) : window === 'month' ? upcoming.filter((row) => row.days <= 30) : upcoming;
    const page = pageOf(wanted, args, PAGE_SIZE);
    return {
      today,
      counts,
      upcoming: page.rows.map(view),
      page: page.page,
      total: page.total,
      more: page.more,
      ...(!window && page.page === 1 && overdue.length > 0
        ? {
            overdue: overdue.slice(0, OVERDUE_SHOWN).map(view),
            ...(overdue.length > OVERDUE_SHOWN ? { overdueMore: `${overdue.length} overdue in all; ask for window "overdue"` } : {}),
          }
        : {}),
    };
  },
};

// --- Personnel --------------------------------------------------------------

/**
 * Whose records this user may read: everyone with the Personnel module, or
 * only the roles whose own module they hold (a Drivers coordinator reads
 * drivers), which is how the directory pages and the search show people.
 */
function peopleScope(ctx: ToolContext) {
  const can = (slug: string) => ctx.isAdmin || ctx.user.modules.some((module) => module.slug === slug);
  const everyone = can('personnel');
  const views = Object.values(PEOPLE_VIEWS).filter((view) => view.role && can(view.slug));
  const roles = views.map((view) => view.role!);
  return {
    everyone,
    roles,
    sees: (person: { roles: string[] }) => everyone || person.roles.some((role) => (roles as string[]).includes(role)),
    href: (person: { id: number; roles: string[] }) => {
      const view = everyone ? PEOPLE_VIEWS.personnel : (views.find((v) => person.roles.includes(v.role!)) ?? PEOPLE_VIEWS.personnel);
      return `/modules/${view.slug}?person=${person.id}`;
    },
  };
}

const licenceView = (licence: PersonnelLicence, zone: string) => ({
  number: licence.licenseNumber,
  category: licence.category,
  expires: localDate(licence.expiryDate, zone),
  status: licence.status,
});

const listPersonnelTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.people,
  functionDeclaration: {
    name: 'list_personnel',
    description:
      `Find people in the staff directory (drivers, CPOs, airport greeters, security advisors, office staff) by name, job title, role, department, phone, email or call sign. Returns contact details, roles and driving licences. ${PAGE_SIZE} per page. get_person gives the full record.`,
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Name, job title, role, department, phone, email, call sign or location' },
        role: { type: 'string', enum: [...PERSONNEL_ROLES] },
        status: { type: 'string', enum: [...PERSONNEL_STATUSES] },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const scope = peopleScope(ctx);
    const q = asString(args.q);
    const role = optEnum(args, 'role', PERSONNEL_ROLES) as PersonnelRole | undefined;
    const status = optEnum(args, 'status', PERSONNEL_STATUSES);
    if (role && !scope.everyone && !scope.roles.includes(role)) {
      throw new ToolRefusal(`This user has no access to the ${role} directory. Ask IT for permission.`);
    }
    const rows = (await listPersonnel({ role: role ?? null })).filter(
      (p) =>
        scope.sees(p) &&
        (!status || p.status === status) &&
        matches(q, p.name, p.role, p.department, p.email, p.phone, p.callSign, p.location, p.supplierName, ...p.roles),
    );
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      people: page.rows.map((p) =>
        compact({
          personId: p.id,
          name: p.name,
          jobTitle: p.role,
          roles: p.roles,
          department: p.department,
          status: p.status,
          phone: p.phone,
          email: p.email,
          location: p.location,
          callSign: p.callSign,
          grade: p.grade,
          supplier: p.engagement === 'Vendor' ? (p.supplierName ?? 'Vendor') : null,
          licences: p.licenses.map((licence) => licenceView(licence, ctx.timeZone)),
        }),
      ),
    };
  },
};

const getPersonTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.people,
  functionDeclaration: {
    name: 'get_person',
    description:
      'Open one person in the staff directory: contact details, roles, manager, skills, notes, driving licences, and the driver / officer ids they are assigned under.',
    parameters: { type: 'object', properties: { personId: { type: 'integer' } }, required: ['personId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'personId', 'use list_personnel');
    const scope = peopleScope(ctx);
    const person = await getPersonnelById(id);
    if (!person || !scope.sees(person)) throw new ToolRefusal(`Person ${id} was not found in the directories this user can open. Find people with list_personnel.`);
    return compact({
      personId: person.id,
      name: person.name,
      jobTitle: person.role,
      roles: person.roles,
      department: person.department,
      status: person.status,
      phone: person.phone,
      email: person.email,
      location: person.location,
      manager: person.manager,
      joined: localDate(person.joinDate, ctx.timeZone),
      engagement: person.engagement,
      supplier: person.supplierName,
      callSign: person.callSign,
      grade: person.grade,
      skills: person.skills,
      licences: person.licenses.map((licence) => ({ ...licenceView(licence, ctx.timeZone), daysRemaining: licence.daysRemaining })),
      driverId: person.resource.driverId,
      officerId: person.resource.officerId,
      login: person.user ? person.user.email : null,
      notes: clip(person.notes, 1500),
      href: scope.href(person),
    });
  },
};

// --- Contracts --------------------------------------------------------------

const contractHref = (id: number) => `/modules/contract-renewal?open=${id}`;
const MAX_INT = 2_147_483_647;

/** A date as the contracts page stores it: the day itself, at UTC midnight. */
const contractDay = (date: string) => new Date(`${date}T00:00:00.000Z`);

const contractFacts = (c: ContractSummary, zone: string): Record<string, unknown> => ({
  reference: c.reference,
  counterparty: c.counterpartyName,
  email: c.email,
  department: c.department,
  type: c.type,
  status: c.status,
  lifecycle: c.lifecycle,
  startDate: localDate(c.startDate, zone),
  endDate: localDate(c.endDate, zone),
  value: c.value,
  currency: c.currency,
  lastRenewalDate: localDate(c.lastRenewalDate, zone),
  notes: c.notes,
});

const CONTRACT_FIELDS = [
  'reference', 'counterparty', 'email', 'department', 'type', 'lifecycle', 'startDate', 'endDate', 'value', 'currency', 'lastRenewalDate', 'notes',
] as const;

const listContractsTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.contracts,
  functionDeclaration: {
    name: 'list_contracts',
    description:
      `Contracts and NDAs: running ones first (soonest to end first), then ended ones, with status, dates, days remaining and value. Search by reference, counterparty, department or type. ${PAGE_SIZE} per page.`,
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Reference, counterparty, email, department or type' },
        status: { type: 'string', enum: [...CONTRACT_DISPLAY_STATUSES] },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const status = optEnum(args, 'status', CONTRACT_DISPLAY_STATUSES);
    const all = await listContracts();
    const rows = all
      .filter((c) => (!status || c.status === status) && matches(q, c.reference, c.counterpartyName, c.email, c.department, c.type))
      // The lib sorts by end date, oldest first: put what is still running ahead of what has ended.
      .sort((a, b) =>
        a.daysRemaining >= 0 && b.daysRemaining >= 0
          ? a.daysRemaining - b.daysRemaining
          : a.daysRemaining < 0 && b.daysRemaining < 0
            ? b.daysRemaining - a.daysRemaining
            : b.daysRemaining - a.daysRemaining,
      );
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      counts: contractStats(all),
      contracts: page.rows.map((c) =>
        compact({
          id: c.id,
          reference: c.reference,
          counterparty: c.counterpartyName,
          type: c.type,
          status: c.status,
          lifecycle: c.lifecycle,
          startDate: localDate(c.startDate, ctx.timeZone),
          endDate: localDate(c.endDate, ctx.timeZone),
          daysRemaining: c.daysRemaining,
          value: c.value,
          currency: c.value != null ? c.currency : null,
          lastRenewed: localDate(c.lastRenewalDate, ctx.timeZone),
          department: c.department,
          href: contractHref(c.id),
        }),
      ),
    };
  },
};

const createContractTool: ToolDefinition = {
  destructive: false,
  // As on the page: anyone with the module reads and edits contracts, only an admin adds one.
  requiredModule: API_ACCESS.contracts,
  requiredRole: 'admin',
  functionDeclaration: {
    name: 'create_contract',
    description: 'Record a new contract or NDA (admins only). The reference must be new.',
    parameters: {
      type: 'object',
      properties: {
        reference: { type: 'string', description: 'e.g. CTR-9901' },
        counterpartyName: { type: 'string' },
        type: { type: 'string', enum: [...CONTRACT_TYPES], description: 'Default Fixed Term' },
        status: { type: 'string', enum: [...CONTRACT_LIFECYCLE], description: 'Default Active' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        value: { type: 'integer', description: 'Whole currency units' },
        currency: { type: 'string', description: '3-letter code, default USD' },
        email: { type: 'string' },
        department: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['reference', 'counterpartyName', 'startDate', 'endDate'],
    },
  },
  async handler(args, ctx) {
    const startDate = reqDate(args, 'startDate');
    const endDate = reqDate(args, 'endDate');
    if (endDate < startDate) throw new ToolRefusal(`endDate (${endDate}) is before startDate (${startDate}).`);
    const input = {
      userId: ctx.userId,
      reference: reqText(args, 'reference', { max: 60 }),
      counterpartyName: reqText(args, 'counterpartyName', { max: 200 }),
      type: optEnum(args, 'type', CONTRACT_TYPES),
      status: optEnum(args, 'status', CONTRACT_LIFECYCLE),
      startDate: contractDay(startDate),
      endDate: contractDay(endDate),
      value: optAmount(args, 'value', { min: 0, max: MAX_INT, integer: true }) ?? null,
      currency: optCurrency(args),
      email: optText(args, 'email', { max: 160 }) ?? null,
      department: optText(args, 'department', { max: 120 }) ?? null,
      notes: optText(args, 'notes', { max: 4000 }) ?? null,
    };
    const contract = await attempt(() => createContract(input));
    await audit({
      action: 'ai.contract.create', entityType: 'Contract', entityId: String(contract.id),
      actorUserId: ctx.userId, metadata: { reference: contract.reference }, request: ctx.request,
    });
    return {
      id: contract.id,
      ...compact(contractFacts(contract, ctx.timeZone)),
      href: contractHref(contract.id),
      summary: `Recorded contract ${contract.reference} with ${contract.counterpartyName} (${contract.type}), ending ${localDate(contract.endDate, ctx.timeZone)}`,
    };
  },
};

const updateContractTool: ToolDefinition = {
  destructive: false,
  requiredModule: API_ACCESS.contracts,
  functionDeclaration: {
    name: 'update_contract',
    description:
      'Change a contract: reference, counterparty, type, lifecycle status, dates, value, currency, notes. ' +
      'To renew or extend: the new endDate, lastRenewalDate (today) and status Active. To cancel: status Cancelled. Send only what should change.',
    parameters: {
      type: 'object',
      properties: {
        contractId: { type: 'integer' },
        reference: { type: 'string' },
        counterpartyName: { type: 'string' },
        type: { type: 'string', enum: [...CONTRACT_TYPES] },
        status: { type: 'string', enum: [...CONTRACT_LIFECYCLE] },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        lastRenewalDate: { type: 'string', description: 'YYYY-MM-DD; null clears it', nullable: true },
        value: { type: 'integer', description: 'Whole currency units; null clears it', nullable: true },
        currency: { type: 'string', description: '3-letter code' },
        email: { type: 'string', description: 'null clears it', nullable: true },
        department: { type: 'string', description: 'null clears it', nullable: true },
        notes: { type: 'string', description: 'null clears them', nullable: true },
      },
      required: ['contractId'],
    },
  },
  async handler(args, ctx) {
    const zone = ctx.timeZone;
    const id = reqId(args, 'contractId', 'use list_contracts');
    const all = await listContracts();
    const before = all.find((c) => c.id === id);
    if (!before) throw new ToolRefusal(`Contract ${id} was not found. Find it with list_contracts.`);

    const patch: Parameters<typeof updateContract>[1] = {};
    const reference = optText(args, 'reference', { max: 60 });
    if (reference != null) {
      // References are unique: the database would reject a second one.
      if (all.some((c) => c.id !== id && c.reference === reference)) throw new ToolRefusal(`A contract with reference "${reference}" already exists.`);
      patch.reference = reference;
    }
    const counterpartyName = optText(args, 'counterpartyName', { max: 200 });
    if (counterpartyName != null) patch.counterpartyName = counterpartyName;
    putText(patch, args, 'email', 160);
    putText(patch, args, 'department', 120);
    putText(patch, args, 'notes', 4000);
    const type = optEnum(args, 'type', CONTRACT_TYPES);
    if (type) patch.type = type;
    const status = optEnum(args, 'status', CONTRACT_LIFECYCLE);
    if (status) patch.status = status;
    const startDate = optDate(args, 'startDate');
    if (startDate) patch.startDate = contractDay(startDate);
    const endDate = optDate(args, 'endDate');
    if (endDate) patch.endDate = contractDay(endDate);
    const lastRenewalDate = optDate(args, 'lastRenewalDate');
    if (lastRenewalDate !== undefined) patch.lastRenewalDate = lastRenewalDate ? contractDay(lastRenewalDate) : null;
    if (args.value === null) patch.value = null;
    else {
      const value = optAmount(args, 'value', { min: 0, max: MAX_INT, integer: true });
      if (value !== undefined) patch.value = value;
    }
    const currency = optCurrency(args);
    if (currency) patch.currency = currency;
    requireSomething(patch, 'contract');

    const start = (patch.startDate ?? new Date(before.startDate)).getTime();
    const end = (patch.endDate ?? new Date(before.endDate)).getTime();
    if (end < start) throw new ToolRefusal('The end date would be before the start date.');

    const after = await attempt(() => updateContract(id, patch));
    if (!after) throw new ToolRefusal(`Contract ${id} was not found.`);
    const changed = changedFields(contractFacts(before, zone), contractFacts(after, zone), CONTRACT_FIELDS);
    requireChange(changed, `contract ${before.reference}`);
    if (changed.notes) changed.notes = { from: clip(before.notes, 120), to: clip(after.notes, 120) };
    await audit({
      action: 'ai.contract.update', entityType: 'Contract', entityId: String(id),
      actorUserId: ctx.userId, metadata: { reference: after.reference, fields: Object.keys(changed) }, request: ctx.request,
    });
    return {
      id,
      reference: after.reference,
      status: after.status,
      changed,
      href: contractHref(id),
      summary: `Updated contract ${after.reference}: ${Object.keys(changed).join(', ')}`,
    };
  },
};

// --- Handovers --------------------------------------------------------------

const HANDOVER_MODULE = 'handover';
const HANDOVER_HREF = '/modules/handover';
const HANDOVER_PAGE = 10;

const shiftLabel = (h: Pick<HandoverDetail, 'shiftDate' | 'shiftPeriod' | 'post'>, zone: string) =>
  `${h.shiftPeriod} shift of ${localDate(h.shiftDate, zone)}${h.post ? ` (${h.post})` : ''}`;

const handoverView = (h: HandoverDetail, zone: string, full: boolean) =>
  compact({
    id: h.id,
    shiftDate: localDate(h.shiftDate, zone),
    shiftPeriod: h.shiftPeriod,
    post: h.post,
    status: h.status,
    summary: full ? h.summary : clip(plainText(h.summary), 400),
    incidents: full ? h.incidents : clip(plainText(h.incidents), 240),
    watchItems: full ? h.watchItems : clip(plainText(h.watchItems), 240),
    writtenBy: h.createdBy?.name ?? null,
    written: localStamp(h.createdAt, zone),
    acknowledgedBy: h.acknowledgedBy?.name ?? null,
    acknowledgedAt: localStamp(h.acknowledgedAt, zone),
    awaitingAcknowledgement: h.acknowledgedBy ? null : true,
  });

const listHandoversTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: HANDOVER_MODULE,
  functionDeclaration: {
    name: 'list_handovers',
    description:
      `Shift handovers, newest first: summary, incidents, watch items, who wrote them, who acknowledged them and when. ${HANDOVER_PAGE} per page; get_handover gives one in full.`,
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Words in the post, summary, incidents, watch items, or the name of who wrote it' },
        status: { type: 'string', enum: [...HANDOVER_STATUSES] },
        awaiting: { type: 'boolean', description: 'true: only those nobody has acknowledged yet' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const status = optEnum(args, 'status', HANDOVER_STATUSES);
    const awaiting = optFlag(args, 'awaiting');
    const all = await listHandovers();
    const rows = all.filter(
      (h) =>
        (!status || h.status === status) &&
        (awaiting === undefined || Boolean(h.acknowledgedBy) !== awaiting) &&
        matches(q, h.post, h.shiftPeriod, plainText(h.summary), plainText(h.incidents), plainText(h.watchItems), h.createdBy?.name),
    );
    const page = pageOf(rows, args, HANDOVER_PAGE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      awaitingAcknowledgement: all.filter((h) => !h.acknowledgedBy).length,
      handovers: page.rows.map((h) => handoverView(h, ctx.timeZone, false)),
      href: HANDOVER_HREF,
    };
  },
};

const getHandoverTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: HANDOVER_MODULE,
  functionDeclaration: {
    name: 'get_handover',
    description: 'Open one shift handover in full: summary, incidents, watch items, who wrote and who acknowledged it.',
    parameters: { type: 'object', properties: { handoverId: { type: 'integer' } }, required: ['handoverId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'handoverId', 'use list_handovers');
    const handover = await getHandover(id);
    if (!handover) throw new ToolRefusal(`Handover ${id} was not found. Find it with list_handovers.`);
    return { ...handoverView(handover, ctx.timeZone, true), href: HANDOVER_HREF };
  },
};

const createHandoverTool: ToolDefinition = {
  destructive: true,
  requiredModule: HANDOVER_MODULE,
  confirmLabel: (args) =>
    `Write a ${asString(args.shiftPeriod) ? `${asString(args.shiftPeriod)} shift ` : ''}handover${asString(args.post) ? ` for ${asString(args.post)}` : ''} in your name and notify the incoming shift`,
  functionDeclaration: {
    name: 'create_handover',
    description:
      "Write a shift handover in the user's name. The incoming shift is notified at once, so the user confirms first. Use the user's own words for the summary.",
    parameters: {
      type: 'object',
      properties: {
        shiftPeriod: { type: 'string', enum: [...SHIFT_PERIODS] },
        shiftDate: { type: 'string', description: 'YYYY-MM-DD, default today' },
        post: { type: 'string', description: 'The post or desk, e.g. Control Room' },
        status: { type: 'string', enum: [...HANDOVER_STATUSES], description: 'Default Normal' },
        summary: { type: 'string', description: 'What the incoming shift needs to know' },
        incidents: { type: 'string' },
        watchItems: { type: 'string', description: 'Things to keep an eye on' },
      },
      required: ['shiftPeriod', 'summary'],
    },
  },
  async handler(args, ctx) {
    const shiftPeriod = optEnum(args, 'shiftPeriod', SHIFT_PERIODS);
    if (!shiftPeriod) throw new ToolRefusal(`shiftPeriod is required: ${SHIFT_PERIODS.join(', ')}.`);
    const input = {
      userId: ctx.userId,
      shiftDate: optDate(args, 'shiftDate') ?? todayIn(ctx.timeZone),
      shiftPeriod,
      post: optText(args, 'post', { max: 120 }) ?? null,
      status: optEnum(args, 'status', HANDOVER_STATUSES),
      summary: reqText(args, 'summary', { max: 10000 }),
      incidents: optText(args, 'incidents', { max: 10000 }) ?? null,
      watchItems: optText(args, 'watchItems', { max: 10000 }) ?? null,
    };
    const handover = await attempt(() => createHandover(input));
    // The incoming shift is told at once, as when it is written on the page; it reports nobody rather than failing.
    const notified = await notifyIncomingShift({ handover, writer: { id: ctx.userId, name: ctx.userName } });
    await audit({
      action: 'ai.handover.create', entityType: 'Handover', entityId: String(handover.id),
      actorUserId: ctx.userId, metadata: { notified: notified.names.length }, request: ctx.request,
    });
    return {
      id: handover.id,
      shiftDate: localDate(handover.shiftDate, ctx.timeZone),
      shiftPeriod: handover.shiftPeriod,
      post: handover.post,
      status: handover.status,
      notified: notified.names,
      ...(notified.names.length === 0 ? { note: 'Nobody was notified: no incoming shift or group could be worked out for this user.' } : {}),
      href: HANDOVER_HREF,
      summary: `Wrote the ${shiftLabel(handover, ctx.timeZone)} handover and notified ${notified.names.length === 0 ? 'nobody' : notified.names.join(', ')}`,
    };
  },
};

const acknowledgeHandoverTool: ToolDefinition = {
  // Signs the handover off as received, in the user's name: they confirm it themselves.
  destructive: true,
  requiredModule: HANDOVER_MODULE,
  confirmLabel: (args) =>
    `Acknowledge the handover ${asString(args.shift) ?? `#${args.handoverId}`} in your name (it is signed off as received by you)`,
  functionDeclaration: {
    name: 'acknowledge_handover',
    description:
      "Acknowledge a shift handover as received, in the user's name. Not possible for a handover the user wrote, or one already acknowledged.",
    parameters: {
      type: 'object',
      properties: {
        handoverId: { type: 'integer' },
        shift: { type: 'string', description: 'Which handover, e.g. "Night shift of 2026-11-23 (Control Room)", shown to the user when they confirm' },
      },
      required: ['handoverId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'handoverId', 'use list_handovers');
    const before = await getHandover(id);
    if (!before) throw new ToolRefusal('Handover not found');
    if (before.acknowledgedBy) {
      throw new ToolRefusal(
        `This handover has already been acknowledged (by ${before.acknowledgedBy.name}${before.acknowledgedAt ? ` on ${localStamp(before.acknowledgedAt, ctx.timeZone)}` : ''}).`,
      );
    }
    if (before.createdBy?.id === ctx.userId) throw new ToolRefusal('You cannot acknowledge your own handover');

    const result = await attempt(() => acknowledgeHandover(id, ctx.userId));
    if (!result) throw new ToolRefusal('Handover not found');
    // Received: it leaves the bell of everyone else it was sent to. The acknowledgement is already saved.
    try {
      await settleHandoverNotifications(id);
    } catch (error) {
      console.error('[assistant] handover notifications were not settled:', error);
    }
    await audit({
      action: 'ai.handover.acknowledge', entityType: 'Handover', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return {
      id: result.id,
      acknowledgedBy: result.acknowledgedBy?.name ?? ctx.userName,
      acknowledgedAt: localStamp(result.acknowledgedAt, ctx.timeZone),
      href: HANDOVER_HREF,
      summary: `Acknowledged the ${shiftLabel(result, ctx.timeZone)} handover${result.createdBy ? ` from ${result.createdBy.name}` : ''}`,
    };
  },
};

export const noteTools: ToolDefinition[] = [listNotesTool, createNoteTool, updateNoteTool, deleteNoteTool];
export const contactTools: ToolDefinition[] = [listContactsTool, createContactTool, updateContactTool, deleteContactTool];
export const fileTools: ToolDefinition[] = [listFilesTool];
export const dueDateTools: ToolDefinition[] = [listDueDatesTool];
export const personnelTools: ToolDefinition[] = [listPersonnelTool, getPersonTool];
export const contractTools: ToolDefinition[] = [listContractsTool, createContractTool, updateContractTool];
export const handoverTools: ToolDefinition[] = [listHandoversTool, getHandoverTool, createHandoverTool, acknowledgeHandoverTool];
