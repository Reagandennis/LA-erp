import 'server-only';

import { recordAuditEvent } from '@/lib/audit';
import { createContact, listContacts } from '@/lib/contacts';
import { createContract, listContracts } from '@/lib/contracts';
import { computeBuckets, listUpcomingDueDates } from '@/lib/due-dates';
import { listFiles } from '@/lib/files';
import { acknowledgeHandover, listHandovers } from '@/lib/handover';
import { createNote, listNotes } from '@/lib/notes';
import { listPersonnel } from '@/lib/personnel';

import { asBool, asInt, asNullableString, asNumber, asString, type ToolDefinition } from '../types';
import { dateIso } from './_shared';

// --- Notes (personal) -------------------------------------------------------

const listNotesTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'notes',
  functionDeclaration: {
    name: 'list_notes',
    description: "List the requester's personal notes.",
    parameters: { type: 'object', properties: {} },
  },
  async handler(_args, ctx) {
    const rows = await listNotes(ctx.userId);
    return rows.slice(0, 40).map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content.slice(0, 300),
      category: n.category,
      pinned: n.pinned,
    }));
  },
};

const createNoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'notes',
  functionDeclaration: {
    name: 'create_note',
    description: 'Create a personal note for the requester.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        pinned: { type: 'boolean' },
      },
      required: ['title'],
    },
  },
  async handler(args, ctx) {
    const title = asString(args.title);
    if (!title) return { error: 'A note title is required.' };
    const note = await createNote({
      userId: ctx.userId,
      title,
      content: asString(args.content),
      pinned: asBool(args.pinned),
    });
    return { id: note.id, title: note.title };
  },
};

// --- Contacts ---------------------------------------------------------------

const listContactsTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'contact-list',
  functionDeclaration: {
    name: 'list_contacts',
    description: 'List operational contacts (name, job title, category, email, phone, linked customer).',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Filter by name/company/email substring' } },
    },
  },
  async handler(args) {
    const q = (asString(args.query) ?? '').toLowerCase();
    const rows = await listContacts();
    return rows
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.email?.toLowerCase().includes(q) ?? false) ||
          (c.customer?.name.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 40)
      .map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        category: c.category,
        email: c.email,
        phone: c.phone,
        customer: c.customer?.name ?? null,
      }));
  },
};

const createContactTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'contact-list',
  functionDeclaration: {
    name: 'create_contact',
    description: 'Add a contact. Optionally link it to a customer (find the ID with list_customers).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        role: { type: 'string', description: 'Job title' },
        email: { type: 'string' },
        phone: { type: 'string' },
        category: { type: 'string', description: 'e.g. Client, Vendor, Partner (default Client)' },
        customerId: { type: 'integer' },
      },
      required: ['name'],
    },
  },
  async handler(args, ctx) {
    const name = asString(args.name);
    if (!name) return { error: 'A contact name is required.' };
    try {
      const contact = await createContact({
        userId: ctx.userId,
        name,
        role: asNullableString(args.role),
        email: asNullableString(args.email),
        phone: asNullableString(args.phone),
        category: asString(args.category),
        customerId: asInt(args.customerId) ?? null,
      });
      await recordAuditEvent({
        action: 'ai.contact.create', entityType: 'Contact', entityId: String(contact.id),
        actorUserId: ctx.userId, request: ctx.request,
      });
      return { id: contact.id, name: contact.name, role: contact.role };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not create the contact.' };
    }
  },
};

// --- Files ------------------------------------------------------------------

const listFilesTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'file-upload',
  functionDeclaration: {
    name: 'list_my_files',
    description: "List the requester's uploaded files and files shared with them (name, size, tags, owner).",
    parameters: { type: 'object', properties: {} },
  },
  async handler(_args, ctx) {
    const rows = await listFiles(ctx.userId);
    return rows.slice(0, 40).map((f) => ({
      id: f.id,
      name: f.name,
      sizeBytes: f.size,
      mimeType: f.mimeType,
      tags: f.tags,
      owner: f.uploadedBy.name,
      mine: f.isOwner,
    }));
  },
};

// --- Due dates (Notification Center) ---------------------------------------

const listDueDatesTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'notification-center',
  functionDeclaration: {
    name: 'list_upcoming_due_dates',
    description:
      'Cross-platform deadlines for the requester: invoices, quotes, licences, contracts, SOP reviews, trips, calendar. Includes overdue counts.',
    parameters: { type: 'object', properties: {} },
  },
  async handler(_args, ctx) {
    const items = await listUpcomingDueDates(ctx.userId);
    const buckets = computeBuckets(items);
    return {
      overdue: buckets.overdue,
      dueThisWeek: buckets.dueThisWeek,
      dueThisMonth: buckets.dueThisMonth,
      items: items.slice(0, 30).map((i) => ({
        title: i.title,
        source: i.sourceLabel,
        date: i.date.slice(0, 10),
        daysRemaining: i.daysRemaining,
        amount: i.amount,
      })),
    };
  },
};

// --- Personnel --------------------------------------------------------------

const listPersonnelTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'personnel',
  functionDeclaration: {
    name: 'list_personnel',
    description: 'List team/workforce records (name, role, department, status, location, manager).',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Filter by name/role/department substring' } },
    },
  },
  async handler(args) {
    const q = (asString(args.query) ?? '').toLowerCase();
    const rows = await listPersonnel();
    return rows
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.role?.toLowerCase().includes(q) ?? false) ||
          p.department.toLowerCase().includes(q),
      )
      .slice(0, 50)
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        department: p.department,
        status: p.status,
        location: p.location,
        manager: p.manager,
      }));
  },
};

// --- Contracts --------------------------------------------------------------

const listContractsTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'contract-renewal',
  functionDeclaration: {
    name: 'list_contracts',
    description: 'List contracts/NDAs with status, end date, days remaining, and value. Use to find a contract ID.',
    parameters: { type: 'object', properties: {} },
  },
  async handler() {
    const rows = await listContracts();
    return rows.slice(0, 40).map((c) => ({
      id: c.id,
      reference: c.reference,
      counterparty: c.counterpartyName,
      type: c.type,
      status: c.status,
      endDate: c.endDate.slice(0, 10),
      daysRemaining: c.daysRemaining,
      value: c.value,
      currency: c.currency,
    }));
  },
};

const createContractTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'contract-renewal',
  functionDeclaration: {
    name: 'create_contract',
    description: 'Record a contract or NDA. Dates YYYY-MM-DD.',
    parameters: {
      type: 'object',
      properties: {
        reference: { type: 'string', description: 'e.g. CTR-9901' },
        counterpartyName: { type: 'string' },
        type: { type: 'string', description: 'Fixed Term | Retainer | Project Based' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        value: { type: 'number' },
        currency: { type: 'string', description: 'Default USD' },
        notes: { type: 'string' },
      },
      required: ['reference', 'counterpartyName', 'startDate', 'endDate'],
    },
  },
  async handler(args, ctx) {
    const startDate = dateIso(args.startDate, null);
    const endDate = dateIso(args.endDate, null);
    if (!startDate || !endDate) return { error: 'Valid startDate and endDate (YYYY-MM-DD) are required.' };
    try {
      const contract = await createContract({
        userId: ctx.userId,
        reference: asString(args.reference) ?? '',
        counterpartyName: asString(args.counterpartyName) ?? '',
        type: asString(args.type),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        value: asNumber(args.value) ?? null,
        currency: asString(args.currency),
        notes: asNullableString(args.notes),
      });
      await recordAuditEvent({
        action: 'ai.contract.create', entityType: 'Contract', entityId: String(contract.id),
        actorUserId: ctx.userId, request: ctx.request,
      });
      return { id: contract.id, reference: contract.reference, status: contract.status };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not create the contract.' };
    }
  },
};

// --- Handovers --------------------------------------------------------------

const listHandoversTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'handover',
  functionDeclaration: {
    name: 'list_handovers',
    description: 'List shift handovers (summary, status, who wrote and who acknowledged them). Use to find a handover ID.',
    parameters: { type: 'object', properties: {} },
  },
  async handler() {
    const rows = await listHandovers();
    return rows.slice(0, 20).map((h) => ({
      id: h.id,
      shiftDate: h.shiftDate.slice(0, 10),
      shiftPeriod: h.shiftPeriod,
      post: h.post,
      status: h.status,
      summary: h.summary.slice(0, 240),
      createdBy: h.createdBy?.name ?? null,
      acknowledgedBy: h.acknowledgedBy?.name ?? null,
    }));
  },
};

const acknowledgeHandoverTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'handover',
  functionDeclaration: {
    name: 'acknowledge_handover',
    description: 'Acknowledge receipt of a shift handover on behalf of the requester.',
    parameters: {
      type: 'object',
      properties: { handoverId: { type: 'integer' } },
      required: ['handoverId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.handoverId);
    if (!id) return { error: 'A valid handoverId is required.' };
    const result = await acknowledgeHandover(id, ctx.userId);
    if (!result) return { error: 'Handover not found' };
    await recordAuditEvent({
      action: 'ai.handover.acknowledge', entityType: 'Handover', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { id: result.id, status: result.status, acknowledgedBy: result.acknowledgedBy?.name };
  },
};

export const workspaceTools: ToolDefinition[] = [
  listNotesTool,
  createNoteTool,
  listContactsTool,
  createContactTool,
  listFilesTool,
  listDueDatesTool,
  listPersonnelTool,
  listContractsTool,
  createContractTool,
  listHandoversTool,
  acknowledgeHandoverTool,
];
