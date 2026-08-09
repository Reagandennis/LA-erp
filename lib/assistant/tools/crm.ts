import 'server-only';

import { recordAuditEvent } from '@/lib/audit';
import {
  ACTIVITY_TYPES,
  CUSTOMER_ENTITIES,
  DEAL_STAGE_KEYS,
  createActivity,
  createDeal,
  deleteDeal,
  listCrmCustomers,
  listDeals,
  updateCrmCustomer,
  updateDeal,
} from '@/lib/crm';

import { asInt, asNullableString, asNumber, asString, type ToolDefinition } from '../types';

const MODULE = 'customers';

const listDealsTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_deals',
    description:
      'List CRM pipeline deals (newest stage change first). Stages: lead, onboarding (Contract/NDA), proposal, won, execution, invoiced, closed, lost. Deals invoiced 30+ days unpaid are flagged outstanding.',
    parameters: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: [...DEAL_STAGE_KEYS] },
        entity: { type: 'string', enum: [...CUSTOMER_ENTITIES], description: 'Filter by business entity' },
      },
    },
  },
  async handler(args) {
    const stage = asString(args.stage);
    const entity = asString(args.entity);
    const rows = await listDeals();
    return rows
      .filter((d) => (!stage || d.stage === stage) && (!entity || d.customer.entity === entity))
      .slice(0, 40)
      .map((d) => ({
        id: d.id,
        title: d.title,
        stage: d.stage,
        isOutstanding: d.isOutstanding,
        value: d.value,
        currency: d.currency,
        customer: d.customer.name,
        entity: d.customer.entity,
        quote: d.quote?.reference ?? null,
        daysInStage: d.daysInStage,
      }));
  },
};

const createDealTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_deal',
    description: 'Create a CRM deal for a customer (find the customer ID with list_crm_customers or list_customers).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        customerId: { type: 'integer' },
        stage: { type: 'string', enum: [...DEAL_STAGE_KEYS], description: 'Default lead' },
        value: { type: 'number' },
        currency: { type: 'string', description: 'Default USD' },
        expectedCloseDate: { type: 'string', description: 'YYYY-MM-DD' },
        notes: { type: 'string' },
      },
      required: ['title', 'customerId'],
    },
  },
  async handler(args, ctx) {
    const customerId = asInt(args.customerId);
    const title = asString(args.title);
    if (!title) return { error: 'A deal title is required.' };
    if (!customerId) return { error: 'A valid customerId is required.' };
    const result = await createDeal(ctx.userId, {
      title,
      customerId,
      stage: asString(args.stage),
      value: asNumber(args.value),
      currency: asString(args.currency),
      expectedCloseDate: asNullableString(args.expectedCloseDate),
      notes: asNullableString(args.notes),
    });
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.deal.create', entityType: 'Deal', entityId: String(result.id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { id: result.id, title: result.title, stage: result.stage, customer: result.customer.name };
  },
};

const moveDealTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'move_deal_stage',
    description: 'Move a deal to another pipeline stage (find the deal ID with list_deals).',
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'integer' },
        stage: { type: 'string', enum: [...DEAL_STAGE_KEYS] },
      },
      required: ['dealId', 'stage'],
    },
  },
  async handler(args, ctx) {
    const dealId = asInt(args.dealId);
    const stage = asString(args.stage);
    if (!dealId) return { error: 'A valid dealId is required.' };
    if (!stage) return { error: 'A target stage is required.' };
    const result = await updateDeal(dealId, { stage });
    if (result === null) return { error: 'Deal not found' };
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.deal.move', entityType: 'Deal', entityId: String(dealId),
      actorUserId: ctx.userId, metadata: { stage }, request: ctx.request,
    });
    return { id: result.id, title: result.title, stage: result.stage };
  },
};

const updateDealTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_deal',
    description: 'Update a deal — title, value, notes, expected close date, e-signature status, or lost reason.',
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'integer' },
        title: { type: 'string' },
        value: { type: 'number' },
        signatureStatus: { type: 'string', enum: ['none', 'sent', 'signed', 'declined'] },
        expectedCloseDate: { type: 'string', description: 'YYYY-MM-DD' },
        lostReason: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['dealId'],
    },
  },
  async handler(args, ctx) {
    const dealId = asInt(args.dealId);
    if (!dealId) return { error: 'A valid dealId is required.' };
    const patch: Parameters<typeof updateDeal>[1] = {};
    if (args.title !== undefined) patch.title = asString(args.title);
    if (args.value !== undefined) patch.value = asNumber(args.value);
    if (args.signatureStatus !== undefined) patch.signatureStatus = asString(args.signatureStatus);
    if (args.expectedCloseDate !== undefined) patch.expectedCloseDate = asNullableString(args.expectedCloseDate);
    if (args.lostReason !== undefined) patch.lostReason = asNullableString(args.lostReason);
    if (args.notes !== undefined) patch.notes = asNullableString(args.notes);
    if (Object.keys(patch).length === 0) return { error: 'Provide at least one field to update.' };
    const result = await updateDeal(dealId, patch);
    if (result === null) return { error: 'Deal not found' };
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.deal.update', entityType: 'Deal', entityId: String(dealId),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { id: result.id, title: result.title, stage: result.stage, value: result.value };
  },
};

const deleteDealTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'delete_deal',
    description: 'Delete a CRM deal (cannot be undone).',
    parameters: {
      type: 'object',
      properties: { dealId: { type: 'integer' } },
      required: ['dealId'],
    },
  },
  async handler(args, ctx) {
    const dealId = asInt(args.dealId);
    if (!dealId) return { error: 'A valid dealId is required.' };
    const deleted = await deleteDeal(dealId);
    if (!deleted) return { error: 'Deal not found' };
    await recordAuditEvent({
      action: 'ai.deal.delete', entityType: 'Deal', entityId: String(dealId),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { deleted: true, dealId };
  },
};

const logActivityTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'log_crm_activity',
    description: 'Log a call, email, meeting, or note against a customer (and optionally a specific deal).',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        type: { type: 'string', enum: [...ACTIVITY_TYPES] },
        summary: { type: 'string' },
        dealId: { type: 'integer' },
      },
      required: ['customerId', 'type', 'summary'],
    },
  },
  async handler(args, ctx) {
    const customerId = asInt(args.customerId);
    const summary = asString(args.summary);
    const type = asString(args.type) ?? 'note';
    if (!customerId) return { error: 'A valid customerId is required.' };
    if (!summary) return { error: 'A summary is required.' };
    const result = await createActivity(ctx.userId, {
      customerId,
      type,
      summary,
      dealId: asInt(args.dealId) ?? null,
    });
    if ('error' in result) return result;
    return { id: result.id, type: result.type, summary: result.summary };
  },
};

const listCrmCustomersTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_crm_customers',
    description: 'List customer accounts with their business entity (LADYASKARI, LIONESS, STARLLWART), contacts, and deal counts.',
    parameters: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: [...CUSTOMER_ENTITIES] },
      },
    },
  },
  async handler(args) {
    const entity = asString(args.entity);
    const rows = await listCrmCustomers();
    return rows
      .filter((c) => !entity || c.entity === entity)
      .slice(0, 50)
      .map((c) => ({
        id: c.id,
        name: c.name,
        entity: c.entity,
        company: c.company,
        email: c.email,
        contacts: c.contacts.map((p) => ({ id: p.id, name: p.name, role: p.role })),
        dealCount: c.dealCount,
      }));
  },
};

const setEntityTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'set_customer_entity',
    description: 'Assign a customer to a business entity (LADYASKARI, LIONESS, or STARLLWART).',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        entity: { type: 'string', enum: [...CUSTOMER_ENTITIES] },
      },
      required: ['customerId', 'entity'],
    },
  },
  async handler(args, ctx) {
    const customerId = asInt(args.customerId);
    const entity = asString(args.entity);
    if (!customerId) return { error: 'A valid customerId is required.' };
    if (!entity) return { error: 'An entity is required.' };
    const result = await updateCrmCustomer(customerId, { entity });
    if (result === null) return { error: 'Customer not found' };
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.customer.entity', entityType: 'Customer', entityId: String(customerId),
      actorUserId: ctx.userId, metadata: { entity }, request: ctx.request,
    });
    return { id: result.id, name: result.name, entity: result.entity };
  },
};

export const crmTools: ToolDefinition[] = [
  listDealsTool,
  createDealTool,
  moveDealTool,
  updateDealTool,
  logActivityTool,
  listCrmCustomersTool,
  setEntityTool,
  deleteDealTool,
];
