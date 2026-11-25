import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import {
  ACTIVITY_TYPES,
  CUSTOMER_ENTITIES,
  DEAL_STAGE_KEYS,
  SIGNATURE_STATUSES,
  createActivity,
  createDeal,
  deleteDeal,
  listContractOptions,
  listCrmActivities,
  listCrmCustomers,
  listDeals,
  listQuoteOptions,
  updateCrmCustomer,
  updateDeal,
  type CrmCustomer,
  type DealSummary,
} from '@/lib/crm';

import { asString, type ToolContext, type ToolDefinition, ToolRefusal } from '../types';
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
  optTime,
  pageOf,
  reqId,
  reqText,
  requireChange,
  todayIn,
  toUtc,
} from './_shared';
import { clip, dateOf, settle } from './quotes';

const MODULE = API_ACCESS.crm;
const PAGE_SIZE = 20;
/** The most a deal's value column holds. */
const MAX_VALUE = 999_999_999_999;

/** Deals and activities live on the client's page in the CRM. */
const clientHref = (customerId: number) => `/modules/customers?open=${customerId}`;

async function loadDeal(id: number): Promise<DealSummary> {
  const deal = (await listDeals()).find((row) => row.id === id);
  if (!deal) throw new ToolRefusal(`Deal ${id} was not found. Find it with list_deals.`);
  return deal;
}

async function loadClient(id: number, ctx: ToolContext): Promise<CrmCustomer> {
  const client = (await listCrmCustomers(ctx.userId)).find((row) => row.id === id);
  if (!client) throw new ToolRefusal(`Client ${id} was not found. Find the client with list_crm_customers.`);
  return client;
}

/** A quote can be linked to a deal when the CRM offers it: one of the client's own. */
async function requireQuote(quoteId: number, customerId: number): Promise<void> {
  const quote = (await listQuoteOptions()).find((row) => row.id === quoteId);
  if (!quote) throw new ToolRefusal(`Quote ${quoteId} was not found among the quotes that can be linked to a deal.`);
  if (quote.customerId !== customerId) throw new ToolRefusal(`Quote ${quote.reference} belongs to another client, so it cannot be linked to this deal.`);
}

async function requireContract(contractId: number): Promise<void> {
  const contract = (await listContractOptions()).find((row) => row.id === contractId);
  if (!contract) throw new ToolRefusal(`Contract ${contractId} was not found among the contracts that can be linked to a deal.`);
}

function dealRow(deal: DealSummary, timeZone: string) {
  return {
    id: deal.id,
    title: deal.title,
    stage: deal.stage,
    ...(deal.isOutstanding ? { outstanding: true } : {}),
    value: deal.value,
    currency: deal.currency,
    client: deal.customer.name,
    customerId: deal.customer.id,
    entity: deal.customer.entity,
    expectedClose: dateOf(deal.expectedCloseDate, timeZone),
    daysInStage: deal.daysInStage,
    ...(deal.signatureStatus !== 'none' ? { signature: deal.signatureStatus } : {}),
    ...(deal.quote ? { quote: deal.quote.reference } : {}),
    ...(deal.contract ? { contract: deal.contract.reference } : {}),
    ...(deal.lostReason ? { lostReason: deal.lostReason } : {}),
  };
}

const STAGES =
  'Stages in order: lead, onboarding (contract/NDA), proposal, won, execution, invoiced, closed, lost.';

// --- Deals ---------------------------------------------------------------------------

const listDealsTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_deals',
    description: `Find pipeline deals, most recently moved first, with what the matches are worth by currency. ${STAGES} 20 per page.`,
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Part of a deal title or client name' },
        stage: { type: 'string', enum: [...DEAL_STAGE_KEYS] },
        entity: { type: 'string', enum: [...CUSTOMER_ENTITIES] },
        customerId: { type: 'integer' },
        outstanding: { type: 'boolean', description: 'Invoiced more than 30 days ago and still unpaid' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const stage = optEnum(args, 'stage', DEAL_STAGE_KEYS);
    const entity = optEnum(args, 'entity', CUSTOMER_ENTITIES);
    const customerId = optId(args, 'customerId');
    const outstanding = optFlag(args, 'outstanding') === true;
    const rows = (await listDeals()).filter(
      (deal) =>
        (!stage || deal.stage === stage) &&
        (!entity || deal.customer.entity === entity) &&
        (!customerId || deal.customer.id === customerId) &&
        (!outstanding || deal.isOutstanding) &&
        matches(q, deal.title, deal.customer.name),
    );
    const value: Record<string, number> = {};
    for (const deal of rows) value[deal.currency] = Math.round(((value[deal.currency] ?? 0) + deal.value) * 100) / 100;
    const page = pageOf(rows, args, PAGE_SIZE);
    return { total: page.total, page: page.page, more: page.more, value, deals: page.rows.map((deal) => dealRow(deal, ctx.timeZone)) };
  },
};

const getDealTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'get_deal',
    description: 'Open one deal: stage, value, client, linked quote and contract, signature status, notes, and the latest activity logged on it.',
    parameters: { type: 'object', properties: { dealId: { type: 'integer' } }, required: ['dealId'] },
  },
  async handler(args, ctx) {
    const deal = await loadDeal(reqId(args, 'dealId', 'use list_deals'));
    const activities = (await listCrmActivities(ctx.userId)).filter((activity) => activity.dealId === deal.id);
    return {
      ...dealRow(deal, ctx.timeZone),
      signature: deal.signatureStatus,
      quote: deal.quote ? { id: deal.quote.id, reference: deal.quote.reference, status: deal.quote.status, total: deal.quote.total } : null,
      contract: deal.contract ? { id: deal.contract.id, reference: deal.contract.reference, status: deal.contract.status } : null,
      notes: clip(deal.notes, 1000),
      created: dateOf(deal.createdAt, ctx.timeZone),
      activities: activities.slice(0, 10).map((activity) => ({
        type: activity.type,
        text: clip(activity.summary, 240),
        when: localStamp(activity.occurredAt, ctx.timeZone),
        by: activity.createdBy,
      })),
      href: clientHref(deal.customer.id),
    };
  },
};

const createDealTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_deal',
    description: `Add a deal to the pipeline for a client. ${STAGES}`,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        customerId: { type: 'integer' },
        stage: { type: 'string', enum: [...DEAL_STAGE_KEYS], description: 'Default lead' },
        value: { type: 'number', description: 'A plain number, e.g. 5000' },
        currency: { type: 'string', description: '3-letter code, default USD' },
        quoteId: { type: 'integer', description: "One of this client's quotes" },
        contractId: { type: 'integer' },
        expectedCloseDate: { type: 'string', description: 'YYYY-MM-DD' },
        notes: { type: 'string' },
      },
      required: ['title', 'customerId'],
    },
  },
  async handler(args, ctx) {
    const customerId = reqId(args, 'customerId', 'use list_crm_customers');
    const input = {
      title: reqText(args, 'title', { max: 200 }),
      customerId,
      stage: optEnum(args, 'stage', DEAL_STAGE_KEYS),
      value: optAmount(args, 'value', { min: 0, max: MAX_VALUE }),
      currency: optCurrency(args),
      quoteId: optId(args, 'quoteId') ?? null,
      contractId: optId(args, 'contractId') ?? null,
      expectedCloseDate: optDate(args, 'expectedCloseDate') ?? null,
      notes: optText(args, 'notes', { max: 4000 }) ?? null,
    };
    if (input.quoteId) await requireQuote(input.quoteId, customerId);
    if (input.contractId) await requireContract(input.contractId);

    const deal = settle(await createDeal(ctx.userId, input));
    await audit({
      action: 'ai.deal.create',
      entityType: 'Deal',
      entityId: String(deal.id),
      actorUserId: ctx.userId,
      metadata: { title: deal.title, customerId },
      request: ctx.request,
    });
    return {
      ...dealRow(deal, ctx.timeZone),
      href: clientHref(deal.customer.id),
      summary: `Created deal "${deal.title}" for ${deal.customer.name} in ${deal.stage}`,
    };
  },
};

const moveDealTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'move_deal_stage',
    description: `Move a deal to another pipeline stage. ${STAGES}`,
    parameters: {
      type: 'object',
      properties: { dealId: { type: 'integer' }, stage: { type: 'string', enum: [...DEAL_STAGE_KEYS] } },
      required: ['dealId', 'stage'],
    },
  },
  async handler(args, ctx) {
    const dealId = reqId(args, 'dealId', 'use list_deals');
    const stage = optEnum(args, 'stage', DEAL_STAGE_KEYS);
    if (!stage) throw new ToolRefusal('stage is required.');
    const before = await loadDeal(dealId);
    if (before.stage === stage) throw new ToolRefusal(`Nothing to change: "${before.title}" is already in ${stage}.`);
    const after = settle(await updateDeal(dealId, { stage }));
    if (!after) throw new ToolRefusal(`Deal ${dealId} was not found.`);
    await audit({
      action: 'ai.deal.move',
      entityType: 'Deal',
      entityId: String(dealId),
      actorUserId: ctx.userId,
      metadata: { from: before.stage, stage: after.stage },
      request: ctx.request,
    });
    return {
      id: dealId,
      title: after.title,
      changed: { stage: { from: before.stage, to: after.stage } },
      href: clientHref(after.customer.id),
      summary: `Moved deal "${after.title}" from ${before.stage} to ${after.stage}`,
    };
  },
};

const dealFacts = (deal: DealSummary, timeZone: string): Record<string, unknown> => ({
  title: deal.title,
  value: deal.value,
  currency: deal.currency,
  quote: deal.quote?.reference ?? null,
  contract: deal.contract?.reference ?? null,
  signatureStatus: deal.signatureStatus,
  expectedCloseDate: dateOf(deal.expectedCloseDate, timeZone),
  lostReason: deal.lostReason,
  notes: deal.notes,
});

const DEAL_FIELDS = Object.keys({
  title: 1, value: 1, currency: 1, quote: 1, contract: 1, signatureStatus: 1, expectedCloseDate: 1, lostReason: 1, notes: 1,
});

const updateDealTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_deal',
    description: "Change a deal's details. Send only what should change; null clears a field that can be empty. The stage is moved with move_deal_stage.",
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'integer' },
        title: { type: 'string' },
        value: { type: 'number', description: 'A plain number, e.g. 5000' },
        currency: { type: 'string', description: '3-letter code' },
        quoteId: { type: 'integer', description: "One of the client's quotes; null unlinks", nullable: true },
        contractId: { type: 'integer', description: 'null unlinks', nullable: true },
        signatureStatus: { type: 'string', enum: [...SIGNATURE_STATUSES] },
        expectedCloseDate: { type: 'string', description: 'YYYY-MM-DD; null clears', nullable: true },
        lostReason: { type: 'string', description: 'null clears', nullable: true },
        notes: { type: 'string', description: 'Replaces the notes; null clears', nullable: true },
      },
      required: ['dealId'],
    },
  },
  async handler(args, ctx) {
    const dealId = reqId(args, 'dealId', 'use list_deals');
    const patch: Parameters<typeof updateDeal>[1] = {};
    const title = optText(args, 'title', { max: 200 });
    if (title != null) patch.title = title;
    const value = optAmount(args, 'value', { min: 0, max: MAX_VALUE });
    if (value !== undefined) patch.value = value;
    const currency = optCurrency(args);
    if (currency) patch.currency = currency;
    const quoteId = optId(args, 'quoteId');
    if (quoteId !== undefined) patch.quoteId = quoteId;
    const contractId = optId(args, 'contractId');
    if (contractId !== undefined) patch.contractId = contractId;
    const signatureStatus = optEnum(args, 'signatureStatus', SIGNATURE_STATUSES);
    if (signatureStatus) patch.signatureStatus = signatureStatus;
    const expectedCloseDate = optDate(args, 'expectedCloseDate');
    if (expectedCloseDate !== undefined) patch.expectedCloseDate = expectedCloseDate;
    const lostReason = optText(args, 'lostReason', { max: 1000 });
    if (lostReason !== undefined) patch.lostReason = lostReason;
    const notes = optText(args, 'notes', { max: 4000 });
    if (notes !== undefined) patch.notes = notes;
    if (Object.keys(patch).length === 0) throw new ToolRefusal('Say what to change on the deal.');

    const before = await loadDeal(dealId);
    if (quoteId) await requireQuote(quoteId, before.customer.id);
    if (contractId) await requireContract(contractId);
    const after = settle(await updateDeal(dealId, patch));
    if (!after) throw new ToolRefusal(`Deal ${dealId} was not found.`);

    const changed = changedFields(dealFacts(before, ctx.timeZone), dealFacts(after, ctx.timeZone), DEAL_FIELDS);
    requireChange(changed, `deal "${before.title}"`);
    if (changed.notes) changed.notes = { from: clip(before.notes, 120), to: clip(after.notes, 120) };
    await audit({
      action: 'ai.deal.update',
      entityType: 'Deal',
      entityId: String(dealId),
      actorUserId: ctx.userId,
      metadata: { title: after.title, fields: Object.keys(changed) },
      request: ctx.request,
    });
    return {
      id: dealId,
      title: after.title,
      changed,
      href: clientHref(after.customer.id),
      summary: `Updated deal "${after.title}": ${Object.keys(changed).join(', ')}`,
    };
  },
};

const deleteDealTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) =>
    `Delete the deal ${asString(args.title) ? `"${asString(args.title)}"` : `#${args.dealId}`} for good (activities logged on it stay on the client)`,
  functionDeclaration: {
    name: 'delete_deal',
    description: "Delete a deal from the pipeline. Activities logged on it stay in the client's history. Cannot be undone.",
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'integer' },
        title: { type: 'string', description: "The deal's title, shown to the user when they confirm" },
      },
      required: ['dealId'],
    },
  },
  async handler(args, ctx) {
    const dealId = reqId(args, 'dealId', 'use list_deals');
    const deal = await loadDeal(dealId);
    const named = asString(args.title);
    if (named && named.toLowerCase() !== deal.title.toLowerCase()) {
      throw new ToolRefusal(`Deal ${dealId} is "${deal.title}", not "${named}". Nothing was deleted: check which deal is meant.`);
    }
    if (!(await deleteDeal(dealId))) throw new ToolRefusal(`Deal ${dealId} was not found.`);
    await audit({
      action: 'ai.deal.delete',
      entityType: 'Deal',
      entityId: String(dealId),
      actorUserId: ctx.userId,
      metadata: { title: deal.title, customerId: deal.customer.id },
      request: ctx.request,
    });
    return { deleted: true, dealId, title: deal.title, summary: `Deleted deal "${deal.title}" (${deal.customer.name})` };
  },
};

// --- Activity log --------------------------------------------------------------------

const logActivityTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'log_crm_activity',
    description:
      "Log a call, email, meeting or note in a client's history, optionally on one of that client's deals and with one of its contacts. It is logged as happening now unless a date or time is given.",
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        type: { type: 'string', enum: [...ACTIVITY_TYPES] },
        summary: { type: 'string', description: 'What happened' },
        dealId: { type: 'integer', description: "One of this client's deals" },
        contactId: { type: 'integer', description: "One of this client's contacts (get_customer)" },
        date: { type: 'string', description: 'YYYY-MM-DD it happened' },
        time: { type: 'string', description: "24-hour HH:MM in the user's time zone (12:00 when only a past date is given)" },
      },
      required: ['customerId', 'type', 'summary'],
    },
  },
  async handler(args, ctx) {
    const customerId = reqId(args, 'customerId', 'use list_crm_customers');
    const type = optEnum(args, 'type', ACTIVITY_TYPES);
    if (!type) throw new ToolRefusal('type is required.');
    const summary = reqText(args, 'summary', { max: 2000 });
    const dealId = optId(args, 'dealId') ?? null;
    const contactId = optId(args, 'contactId') ?? null;
    const date = optDate(args, 'date');
    const time = optTime(args, 'time');
    const today = todayIn(ctx.timeZone);
    // Today with no time is "now"; another day with no time sits at midday, so it reads as that day in any zone.
    const occurredAt = time || (date && date !== today) ? toUtc(date ?? today, time ?? '12:00', ctx.timeZone, 'activity time') : null;

    const client = await loadClient(customerId, ctx);
    const contact = contactId ? client.contacts.find((row) => row.id === contactId) : null;
    if (contactId && !contact) {
      throw new ToolRefusal(`Contact ${contactId} is not one of ${client.name}'s contacts. Nothing was logged.`);
    }
    // The database would take any deal id here, another client's included.
    const deal = dealId ? await loadDeal(dealId) : null;
    if (deal && deal.customer.id !== customerId) {
      throw new ToolRefusal(`Deal "${deal.title}" belongs to ${deal.customer.name}, not ${client.name}. Nothing was logged.`);
    }

    const activity = settle(await createActivity(ctx.userId, { customerId, dealId, contactId, type, summary, occurredAt }));
    await audit({
      action: 'ai.activity.create',
      entityType: 'CrmActivity',
      entityId: String(activity.id),
      actorUserId: ctx.userId,
      metadata: { customerId, dealId, type },
      request: ctx.request,
    });
    return {
      id: activity.id,
      type: activity.type,
      text: clip(activity.summary, 240),
      when: localStamp(activity.occurredAt, ctx.timeZone),
      client: client.name,
      ...(deal ? { deal: deal.title } : {}),
      ...(activity.contactName ? { contact: activity.contactName } : {}),
      href: clientHref(customerId),
      summary: `Logged a ${activity.type} for ${client.name}${deal ? ` on deal "${deal.title}"` : ''}`,
    };
  },
};

const listActivitiesTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_crm_activities',
    description: 'The CRM activity log (calls, emails, meetings, notes), newest first, from the latest 500. Filter by client, deal or type, or search the text. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        dealId: { type: 'integer' },
        type: { type: 'string', enum: [...ACTIVITY_TYPES] },
        q: { type: 'string', description: 'Words in the activity, or a contact name' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const customerId = optId(args, 'customerId');
    const dealId = optId(args, 'dealId');
    const type = optEnum(args, 'type', ACTIVITY_TYPES);
    const q = asString(args.q);
    const [activities, clients] = await Promise.all([listCrmActivities(ctx.userId), listCrmCustomers(ctx.userId)]);
    const names = new Map(clients.map((client) => [client.id, client.name]));
    const rows = activities.filter(
      (activity) =>
        (!customerId || activity.customerId === customerId) &&
        (!dealId || activity.dealId === dealId) &&
        (!type || activity.type === type) &&
        matches(q, activity.summary, activity.contactName, names.get(activity.customerId)),
    );
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      timesShownIn: ctx.timeZone,
      activities: page.rows.map((activity) => ({
        id: activity.id,
        type: activity.type,
        text: clip(activity.summary, 240),
        when: localStamp(activity.occurredAt, ctx.timeZone),
        client: names.get(activity.customerId) ?? null,
        customerId: activity.customerId,
        ...(activity.dealId ? { dealId: activity.dealId } : {}),
        ...(activity.contactName ? { contact: activity.contactName } : {}),
        by: activity.createdBy,
      })),
    };
  },
};

// --- Clients, as the CRM sees them ---------------------------------------------------

const CONTACTS_SHOWN = 6;

const listCrmCustomersTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_crm_customers',
    description: 'Find client accounts with their business entity, deal count and contacts (name, role, email, phone), in name order. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Part of a client, company or contact name, an email or a phone number' },
        entity: { type: 'string', enum: [...CUSTOMER_ENTITIES] },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const entity = optEnum(args, 'entity', CUSTOMER_ENTITIES);
    const rows = (await listCrmCustomers(ctx.userId)).filter(
      (client) =>
        (!entity || client.entity === entity) &&
        matches(q, client.name, client.company, client.email, client.phone, ...client.contacts.flatMap((c) => [c.name, c.email, c.phone])),
    );
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      customers: page.rows.map((client) => ({
        id: client.id,
        name: client.name,
        entity: client.entity,
        company: client.company,
        email: client.email,
        phone: client.phone,
        deals: client.dealCount,
        contacts: client.contacts.slice(0, CONTACTS_SHOWN).map((contact) => ({
          contactId: contact.id,
          name: contact.name,
          role: contact.role,
          email: contact.email,
          phone: contact.phone,
        })),
        ...(client.contacts.length > CONTACTS_SHOWN ? { contactsTotal: client.contacts.length } : {}),
        href: clientHref(client.id),
      })),
    };
  },
};

const setEntityTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'set_customer_entity',
    description: 'Put a client under one of the business entities.',
    parameters: {
      type: 'object',
      properties: { customerId: { type: 'integer' }, entity: { type: 'string', enum: [...CUSTOMER_ENTITIES] } },
      required: ['customerId', 'entity'],
    },
  },
  async handler(args, ctx) {
    const customerId = reqId(args, 'customerId', 'use list_crm_customers');
    const entity = optEnum(args, 'entity', CUSTOMER_ENTITIES);
    if (!entity) throw new ToolRefusal('entity is required.');
    const before = await loadClient(customerId, ctx);
    if (before.entity === entity) throw new ToolRefusal(`Nothing to change: ${before.name} is already under ${entity}.`);
    const after = settle(await updateCrmCustomer(customerId, { entity }, ctx.userId));
    if (!after) throw new ToolRefusal(`Client ${customerId} was not found.`);
    await audit({
      action: 'ai.customer.entity',
      entityType: 'Customer',
      entityId: String(customerId),
      actorUserId: ctx.userId,
      metadata: { from: before.entity, entity: after.entity },
      request: ctx.request,
    });
    return {
      id: customerId,
      name: after.name,
      changed: { entity: { from: before.entity, to: after.entity } },
      href: clientHref(customerId),
      summary: `Moved client ${after.name} from ${before.entity} to ${after.entity}`,
    };
  },
};

export const crmTools: ToolDefinition[] = [
  listDealsTool,
  getDealTool,
  createDealTool,
  moveDealTool,
  updateDealTool,
  logActivityTool,
  listActivitiesTool,
  listCrmCustomersTool,
  setEntityTool,
  deleteDealTool,
];
