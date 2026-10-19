import 'server-only';

import { recordAuditEvent } from '@/lib/audit';
import {
  createQuote,
  decideQuote,
  deleteQuote,
  duplicateQuote,
  listQuotesForUser,
  submitQuote,
  updateDraftQuote,
  type QuoteUpdateInput,
} from '@/lib/quotes';

import { asInt, asNullableString, asString, type ToolDefinition } from '../types';
import { dateIso, lineItemsSchema, parseLineItems, todayIso } from './_shared';

const listQuotesTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'list_quotes',
    description: 'List quotes the user can access (newest first). Use to find a quote ID.',
    parameters: { type: 'object', properties: {} },
  },
  async handler(_args, ctx) {
    const rows = await listQuotesForUser({ userId: ctx.userId, isAdmin: ctx.isAdmin });
    return rows.slice(0, 30).map((q) => ({
      id: q.id,
      reference: q.reference,
      subject: q.subject,
      status: q.status,
      total: q.total,
      customer: q.customer?.name,
    }));
  },
};

const createQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'create_quote',
    description:
      'Create a draft quote for a client. Find the client ID with list_customers first. Dates are YYYY-MM-DD; defaults: issue=today, expiry=+14 days.',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        subject: { type: 'string' },
        items: lineItemsSchema,
        issueDate: { type: 'string', description: 'YYYY-MM-DD' },
        expiryDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string', description: '3-letter code, default USD' },
        taxRate: { type: 'number', description: 'Decimal 0-1, e.g. 0.16 for 16%' },
        notes: { type: 'string' },
      },
      required: ['customerId', 'subject', 'items'],
    },
  },
  async handler(args, ctx) {
    const customerId = asInt(args.customerId);
    const subject = asString(args.subject);
    const items = parseLineItems(args.items);
    if (!customerId) return { error: 'A valid customerId is required (use list_customers).' };
    if (!subject) return { error: 'A subject is required.' };
    if (items.length === 0) return { error: 'At least one line item is required.' };

    const issueDate = dateIso(args.issueDate, todayIso())!;
    const defaultExpiry = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const expiryDate = dateIso(args.expiryDate, defaultExpiry)!;
    const taxRate = typeof args.taxRate === 'number' ? args.taxRate : 0;

    const quote = await createQuote({
      customerId,
      approverId: null,
      brandProfileId: null,
      subject,
      issueDate,
      expiryDate,
      currency: asString(args.currency) ?? 'USD',
      taxRate,
      discountType: 'none',
      discountValue: 0,
      notes: asNullableString(args.notes),
      terms: null,
      items,
      createdById: ctx.userId,
    });
    await recordAuditEvent({
      action: 'ai.quote.create',
      entityType: 'Quote',
      entityId: String(quote.id),
      actorUserId: ctx.userId,
      metadata: { reference: quote.reference },
      request: ctx.request,
    });
    return { id: quote.id, reference: quote.reference, total: quote.total, status: quote.status };
  },
};

const submitQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'submit_quote',
    description: 'Submit a draft quote for approval.',
    parameters: {
      type: 'object',
      properties: { quoteId: { type: 'integer' } },
      required: ['quoteId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.quoteId);
    if (!id) return { error: 'A valid quoteId is required.' };
    const result = await submitQuote({ id, userId: ctx.userId, isAdmin: ctx.isAdmin });
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.quote.submit',
      entityType: 'Quote',
      entityId: String(id),
      actorUserId: ctx.userId,
      request: ctx.request,
    });
    return { id: result.id, status: result.status };
  },
};

const deleteQuoteTool: ToolDefinition = {
  destructive: true,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'delete_quote',
    description: 'Delete a draft or declined quote. Sent/approved quotes cannot be deleted.',
    parameters: {
      type: 'object',
      properties: { quoteId: { type: 'integer' } },
      required: ['quoteId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.quoteId);
    if (!id) return { error: 'A valid quoteId is required.' };
    const result = await deleteQuote({ id, userId: ctx.userId, isAdmin: ctx.isAdmin });
    if (result !== true) return result;
    await recordAuditEvent({
      action: 'ai.quote.delete',
      entityType: 'Quote',
      entityId: String(id),
      actorUserId: ctx.userId,
      request: ctx.request,
    });
    return { deleted: true, quoteId: id };
  },
};

const updateQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'update_quote',
    description:
      'Update a draft quote — change subject, dates, currency, tax rate, notes, or replace its line items. Provide only the fields to change.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'integer' },
        subject: { type: 'string' },
        expiryDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string' },
        taxRate: { type: 'number', description: 'Decimal 0-1' },
        notes: { type: 'string' },
        items: lineItemsSchema,
      },
      required: ['quoteId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.quoteId);
    if (!id) return { error: 'A valid quoteId is required.' };
    const input: QuoteUpdateInput = {};
    if (args.subject !== undefined) input.subject = asString(args.subject);
    if (args.expiryDate !== undefined) input.expiryDate = asString(args.expiryDate);
    if (args.currency !== undefined) input.currency = asString(args.currency);
    if (typeof args.taxRate === 'number') input.taxRate = args.taxRate;
    if (args.notes !== undefined) input.notes = asNullableString(args.notes);
    if (Array.isArray(args.items)) input.items = parseLineItems(args.items);
    if (Object.keys(input).length === 0) return { error: 'Provide at least one field to update.' };

    const result = await updateDraftQuote({ id, userId: ctx.userId, isAdmin: ctx.isAdmin, input });
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.quote.update', entityType: 'Quote', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { id: result.id, reference: result.reference, total: result.total, status: result.status };
  },
};

const decideQuoteTool: ToolDefinition = {
  destructive: true,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'decide_quote',
    description: 'Approve or decline a submitted quote.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'integer' },
        decision: { type: 'string', enum: ['approved', 'declined'] },
        note: { type: 'string' },
      },
      required: ['quoteId', 'decision'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.quoteId);
    const decision = asString(args.decision);
    if (!id) return { error: 'A valid quoteId is required.' };
    if (decision !== 'approved' && decision !== 'declined') return { error: 'decision must be "approved" or "declined".' };
    const result = await decideQuote({ id, userId: ctx.userId, isAdmin: ctx.isAdmin, decision, note: asNullableString(args.note) });
    if ('error' in result) return result;
    await recordAuditEvent({
      action: `ai.quote.${decision}`, entityType: 'Quote', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { id: result.id, status: result.status };
  },
};

const duplicateQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'duplicate_quote',
    description: 'Create a new draft quote that is a copy of an existing one.',
    parameters: {
      type: 'object',
      properties: { quoteId: { type: 'integer' } },
      required: ['quoteId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.quoteId);
    if (!id) return { error: 'A valid quoteId is required.' };
    const result = await duplicateQuote({ id, userId: ctx.userId, isAdmin: ctx.isAdmin });
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.quote.duplicate', entityType: 'Quote', entityId: String(result.id),
      actorUserId: ctx.userId, metadata: { from: id }, request: ctx.request,
    });
    return { id: result.id, reference: result.reference, status: result.status };
  },
};

export const quoteTools: ToolDefinition[] = [
  listQuotesTool,
  createQuoteTool,
  updateQuoteTool,
  submitQuoteTool,
  decideQuoteTool,
  duplicateQuoteTool,
  deleteQuoteTool,
];
