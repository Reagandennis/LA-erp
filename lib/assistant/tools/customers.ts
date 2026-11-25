import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import { CUSTOMER_ENTITIES, DEFAULT_ENTITY, listCrmCustomers, listDeals, updateCrmCustomer, type CrmCustomer } from '@/lib/crm';
import { createCustomer, deleteCustomer } from '@/lib/customers';
import { listInvoices } from '@/lib/invoices';
import { prisma } from '@/lib/prisma';
import { listQuotesForUser } from '@/lib/quotes';
import { customerCreateSchema, emailSchema } from '@/lib/validation';

import { asString, type ToolContext, type ToolDefinition, ToolRefusal } from '../types';
import { audit, changedFields, matches, optEnum, optText, pageOf, parseWith, reqId, reqText, requireChange } from './_shared';
import { dateOf, settle } from './quotes';

const PAGE_SIZE = 20;
/** Clients are picked in the quote and invoice builders and managed in the CRM. */
const READ = API_ACCESS.quoteCustomers;
/** Editing a client is the CRM page's: its route is the one that saves. */
const EDIT = API_ACCESS.crm;

const customerHref = (id: number) => `/modules/customers?open=${id}`;

/** Whether this person holds one of these modules (admins hold them all). */
const holds = (ctx: ToolContext, modules: readonly string[]) =>
  ctx.isAdmin || ctx.user.modules.some((module) => modules.includes(module.slug));

async function loadCustomer(id: number, ctx: ToolContext): Promise<CrmCustomer> {
  const customer = (await listCrmCustomers(ctx.userId)).find((row) => row.id === id);
  if (!customer) throw new ToolRefusal(`Client ${id} was not found. Find the client with list_customers.`);
  return customer;
}

const listCustomersTool: ToolDefinition = {
  destructive: false,
  requiredModule: READ,
  functionDeclaration: {
    name: 'list_customers',
    description: 'Find clients by name, company, email or phone, in name order. Returns the client id other tools need. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Part of a name, company, email or phone number' },
        entity: { type: 'string', enum: [...CUSTOMER_ENTITIES] },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const entity = optEnum(args, 'entity', CUSTOMER_ENTITIES);
    const rows = (await listCrmCustomers(ctx.userId)).filter(
      (customer) => (!entity || customer.entity === entity) && matches(q, customer.name, customer.company, customer.email, customer.phone),
    );
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      customers: page.rows.map((customer) => ({
        id: customer.id,
        name: customer.name,
        company: customer.company,
        email: customer.email,
        phone: customer.phone,
        entity: customer.entity,
        href: customerHref(customer.id),
      })),
    };
  },
};

const OPEN_QUOTES = ['Draft', 'Submitted', 'Approved', 'Sent'];
const SHOWN = 10;

const getCustomerTool: ToolDefinition = {
  destructive: false,
  requiredModule: READ,
  functionDeclaration: {
    name: 'get_customer',
    description:
      "Open one client: contact details, addresses, entity and, where this user has those areas, the client's contacts, deals, open quotes and unpaid invoices.",
    parameters: { type: 'object', properties: { customerId: { type: 'integer' } }, required: ['customerId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'customerId', 'use list_customers');
    const customer = await loadCustomer(id, ctx);
    const out: Record<string, unknown> = {
      id: customer.id,
      name: customer.name,
      company: customer.company,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      billingAddress: customer.billingAddress,
      entity: customer.entity,
      href: customerHref(id),
    };
    if (holds(ctx, API_ACCESS.crm)) {
      out.contacts = customer.contacts.map((contact) => ({
        contactId: contact.id,
        name: contact.name,
        role: contact.role,
        email: contact.email,
        phone: contact.phone,
      }));
      out.deals = (await listDeals())
        .filter((deal) => deal.customer.id === id)
        .map((deal) => ({ dealId: deal.id, title: deal.title, stage: deal.stage, value: deal.value, currency: deal.currency }));
    }
    if (holds(ctx, API_ACCESS.quotes)) {
      const quotes = (await listQuotesForUser({ userId: ctx.userId, isAdmin: ctx.isAdmin })).filter(
        (quote) => quote.customer.id === id && OPEN_QUOTES.includes(quote.status),
      );
      out.openQuotes = {
        total: quotes.length,
        quotes: quotes.slice(0, SHOWN).map((quote) => ({
          quoteId: quote.id,
          reference: quote.reference,
          subject: quote.subject,
          status: quote.status,
          total: quote.total,
          currency: quote.currency,
        })),
      };
    }
    if (holds(ctx, ['invoices-review'])) {
      const invoices = (await listInvoices()).filter(
        (invoice) => invoice.customer.id === id && invoice.balanceDue > 0 && ['Approved', 'Sent', 'Partial'].includes(invoice.status),
      );
      out.unpaidInvoices = {
        total: invoices.length,
        invoices: invoices.slice(0, SHOWN).map((invoice) => ({
          invoiceId: invoice.id,
          number: invoice.number,
          status: invoice.status,
          ...(invoice.isOverdue ? { overdue: true } : {}),
          balanceDue: invoice.balanceDue,
          currency: invoice.currency,
          dueDate: dateOf(invoice.dueDate, ctx.timeZone),
        })),
      };
    }
    return out;
  },
};

const createCustomerTool: ToolDefinition = {
  destructive: false,
  requiredModule: READ,
  functionDeclaration: {
    name: 'create_customer',
    description: 'Create a client. Check with list_customers first that it is not there already.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The client: a company or a person' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company: { type: 'string' },
        address: { type: 'string' },
        billingAddress: { type: 'string' },
        entity: { type: 'string', enum: [...CUSTOMER_ENTITIES], description: `Which business the client belongs to (default ${DEFAULT_ENTITY})` },
      },
      required: ['name'],
    },
  },
  async handler(args, ctx) {
    const entity = optEnum(args, 'entity', CUSTOMER_ENTITIES);
    // The entity is set through the CRM, as it is from the client form.
    if (entity && entity !== DEFAULT_ENTITY && !holds(ctx, EDIT)) {
      throw new ToolRefusal(`Putting a client under ${entity} needs access to Clients (the CRM). Ask IT for permission, or leave entity out.`);
    }
    const data = parseWith(customerCreateSchema, {
      name: reqText(args, 'name'),
      email: optText(args, 'email') ?? undefined,
      phone: optText(args, 'phone') ?? null,
      company: optText(args, 'company') ?? null,
      address: optText(args, 'address') ?? null,
      billingAddress: optText(args, 'billingAddress') ?? null,
    });
    const created = await createCustomer({
      name: data.name,
      email: data.email,
      phone: data.phone ?? null,
      company: data.company ?? null,
      address: data.address ?? null,
      billingAddress: data.billingAddress ?? null,
      createdById: ctx.userId,
    });
    await audit({
      action: 'customer.created',
      entityType: 'customer',
      entityId: String(created.id),
      actorUserId: ctx.userId,
      metadata: { name: created.name, via: 'assistant' },
      request: ctx.request,
    });

    let saved: string = DEFAULT_ENTITY;
    let entityProblem: string | null = null;
    if (entity && entity !== DEFAULT_ENTITY) {
      const result = await updateCrmCustomer(created.id, { entity }, ctx.userId);
      if (result && !('error' in result)) saved = result.entity;
      else entityProblem = `The client was created, but could not be put under ${entity}: it is under ${DEFAULT_ENTITY}.`;
    }
    return {
      id: created.id,
      name: created.name,
      email: created.email,
      phone: created.phone,
      company: created.company,
      billingAddress: created.billingAddress,
      entity: saved,
      ...(entityProblem ? { note: entityProblem } : {}),
      href: customerHref(created.id),
      summary: `Created client ${created.name}`,
    };
  },
};

const customerFacts = (customer: CrmCustomer): Record<string, unknown> => ({
  name: customer.name,
  email: customer.email,
  phone: customer.phone,
  company: customer.company,
  address: customer.address,
  billingAddress: customer.billingAddress,
  entity: customer.entity,
});

const CUSTOMER_FIELDS = Object.keys({ name: 1, email: 1, phone: 1, company: 1, address: 1, billingAddress: 1, entity: 1 });

const updateCustomerTool: ToolDefinition = {
  destructive: false,
  requiredModule: EDIT,
  functionDeclaration: {
    name: 'update_customer',
    description: "Change a client's details. Send only what should change; null clears a field that can be empty.",
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        name: { type: 'string' },
        email: { type: 'string', description: 'null clears', nullable: true },
        phone: { type: 'string', description: 'null clears', nullable: true },
        company: { type: 'string', description: 'null clears', nullable: true },
        address: { type: 'string', description: 'null clears', nullable: true },
        billingAddress: { type: 'string', description: 'null clears', nullable: true },
        entity: { type: 'string', enum: [...CUSTOMER_ENTITIES] },
      },
      required: ['customerId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'customerId', 'use list_customers');
    const patch: Parameters<typeof updateCrmCustomer>[1] = {};
    const name = optText(args, 'name', { max: 120 });
    if (name != null) patch.name = name;
    const email = optText(args, 'email', { max: 160 });
    if (email !== undefined) patch.email = email === null ? null : parseWith(emailSchema, email);
    for (const [key, max] of [['phone', 40], ['company', 160], ['address', 400], ['billingAddress', 400]] as const) {
      const value = optText(args, key, { max });
      if (value !== undefined) patch[key] = value;
    }
    const entity = optEnum(args, 'entity', CUSTOMER_ENTITIES);
    if (entity) patch.entity = entity;
    if (Object.keys(patch).length === 0) throw new ToolRefusal('Say what to change on the client.');

    const before = await loadCustomer(id, ctx);
    const after = settle(await updateCrmCustomer(id, patch, ctx.userId));
    if (!after) throw new ToolRefusal(`Client ${id} was not found.`);
    const changed = changedFields(customerFacts(before), customerFacts(after), CUSTOMER_FIELDS);
    requireChange(changed, `client ${before.name}`);
    await audit({
      action: 'ai.customer.update',
      entityType: 'Customer',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { name: after.name, fields: Object.keys(changed) },
      request: ctx.request,
    });
    return {
      id,
      name: after.name,
      changed,
      href: customerHref(id),
      summary: `Updated client ${after.name}: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Only the assistant can delete a client: no page does. So it is an admin's
 * action, and the Confirm card says what goes with the client.
 */
const deleteCustomerTool: ToolDefinition = {
  destructive: true,
  requiredRole: 'admin',
  confirmLabel: (args) =>
    `Delete client ${asString(args.name) ?? `#${args.customerId}`} for good, together with every deal and CRM activity logged for them. Their contacts and travellers are kept but no longer linked to a client`,
  functionDeclaration: {
    name: 'delete_customer',
    description:
      "Admins only. Delete a client that has no quotes, invoices or trips. The client's deals and CRM activity log are deleted with it; its contacts and travellers are kept, unlinked. Cannot be undone.",
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        name: { type: 'string', description: "The client's name, shown to the user when they confirm" },
      },
      required: ['customerId'],
    },
  },
  async handler(args, ctx) {
    if (!ctx.isAdmin) throw new ToolRefusal('Only an administrator can delete a client.');
    const id = reqId(args, 'customerId', 'use list_customers');
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: {
        name: true,
        _count: { select: { quotes: true, invoices: true, trips: true, deals: true, crmActivities: true, contacts: true, travelers: true } },
      },
    });
    if (!customer) throw new ToolRefusal(`Client ${id} was not found.`);
    const named = asString(args.name);
    if (named && named.toLowerCase() !== customer.name.toLowerCase()) {
      throw new ToolRefusal(`Client ${id} is "${customer.name}", not "${named}". Nothing was deleted: check which client is meant.`);
    }

    // The database refuses these; saying which, rather than the lib's one message for every failure.
    const has = customer._count;
    const blocking = [
      has.quotes ? count(has.quotes, 'quote') : null,
      has.invoices ? count(has.invoices, 'invoice') : null,
      has.trips ? count(has.trips, 'trip') : null,
    ].filter(Boolean);
    if (blocking.length > 0) {
      throw new ToolRefusal(
        `${customer.name} cannot be deleted: it has ${blocking.join(', ')}. A client with quotes, invoices or trips stays on record. Nothing was deleted.`,
      );
    }

    const result = await deleteCustomer(id);
    if (result !== true) {
      throw new ToolRefusal(
        result.error === 'Client not found'
          ? `Client ${id} was not found.`
          : `${customer.name} could not be deleted: another record still refers to this client. Nothing was deleted.`,
      );
    }
    await audit({
      action: 'ai.customer.delete',
      entityType: 'Customer',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { name: customer.name, deals: has.deals, activities: has.crmActivities, contactsUnlinked: has.contacts, travelersUnlinked: has.travelers },
      request: ctx.request,
    });
    return {
      deleted: true,
      customerId: id,
      name: customer.name,
      deletedWithIt: { deals: has.deals, activities: has.crmActivities },
      unlinked: { contacts: has.contacts, travellers: has.travelers },
      summary: `Deleted client ${customer.name}, with ${count(has.deals, 'deal')} and ${count(has.crmActivities, 'CRM activity', 'CRM activities')}`,
    };
  },
};

export const customerTools: ToolDefinition[] = [
  listCustomersTool,
  getCustomerTool,
  createCustomerTool,
  updateCustomerTool,
  deleteCustomerTool,
];
