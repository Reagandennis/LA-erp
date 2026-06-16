import 'server-only';

import { recordAuditEvent } from '@/lib/audit';
import {
  createInvoice,
  createInvoiceFromQuote,
  deleteInvoice,
  listInvoices,
  recordInvoicePayment,
  sendInvoice,
  updateInvoice,
  voidInvoice,
  type InvoiceUpdateInput,
} from '@/lib/invoices';

import { asInt, asNullableString, asNumber, asString, type ToolDefinition } from '../types';
import { dateIso, lineItemsSchema, parseLineItems, todayIso } from './_shared';

const MODULE = 'invoices-review';

const listInvoicesTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_invoices',
    description: 'List invoices (newest first). Use to find an invoice ID.',
    parameters: { type: 'object', properties: {} },
  },
  async handler() {
    const rows = await listInvoices();
    return rows.slice(0, 30).map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      total: i.total,
      balanceDue: i.balanceDue,
      customer: i.customer?.name,
    }));
  },
};

const createInvoiceTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_invoice',
    description:
      'Create a draft invoice for a customer. Find the customer ID with list_customers. Dates YYYY-MM-DD; defaults: issue=today, due=+14 days.',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        items: lineItemsSchema,
        issueDate: { type: 'string', description: 'YYYY-MM-DD' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string', description: '3-letter code, default USD' },
        taxRate: { type: 'number', description: 'Decimal 0-1' },
        notes: { type: 'string' },
      },
      required: ['customerId', 'items'],
    },
  },
  async handler(args, ctx) {
    const customerId = asInt(args.customerId);
    const items = parseLineItems(args.items);
    if (!customerId) return { error: 'A valid customerId is required (use list_customers).' };
    if (items.length === 0) return { error: 'At least one line item is required.' };

    const issueDate = dateIso(args.issueDate, todayIso())!;
    const defaultDue = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const dueDate = dateIso(args.dueDate, defaultDue)!;

    const invoice = await createInvoice({
      customerId,
      brandProfileId: null,
      issueDate,
      dueDate,
      currency: asString(args.currency) ?? 'USD',
      taxRate: typeof args.taxRate === 'number' ? args.taxRate : 0,
      discountType: 'none',
      discountValue: 0,
      notes: asNullableString(args.notes),
      terms: null,
      items,
      createdById: ctx.userId,
    });
    await recordAuditEvent({
      action: 'ai.invoice.create',
      entityType: 'Invoice',
      entityId: String(invoice.id),
      actorUserId: ctx.userId,
      metadata: { number: invoice.number },
      request: ctx.request,
    });
    return { id: invoice.id, number: invoice.number, total: invoice.total, status: invoice.status };
  },
};

const recordPaymentTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'record_invoice_payment',
    description: 'Record a payment against an invoice.',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'integer' },
        amount: { type: 'number' },
        method: { type: 'string', description: 'e.g. Cash, Bank transfer, Card' },
        reference: { type: 'string' },
      },
      required: ['invoiceId', 'amount'],
    },
  },
  async handler(args, ctx) {
    const invoiceId = asInt(args.invoiceId);
    const amount = asNumber(args.amount);
    if (!invoiceId) return { error: 'A valid invoiceId is required.' };
    if (!amount || amount <= 0) return { error: 'A positive amount is required.' };
    const result = await recordInvoicePayment({
      invoiceId,
      userId: ctx.userId,
      input: {
        amount,
        method: asString(args.method) ?? 'Other',
        reference: asNullableString(args.reference),
        note: null,
        paidAt: todayIso(),
      },
    });
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.invoice.payment',
      entityType: 'Invoice',
      entityId: String(invoiceId),
      actorUserId: ctx.userId,
      metadata: { amount },
      request: ctx.request,
    });
    return { id: result.id, status: result.status, balanceDue: result.balanceDue };
  },
};

const voidInvoiceTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'void_invoice',
    description: 'Void an invoice (cannot be undone).',
    parameters: {
      type: 'object',
      properties: { invoiceId: { type: 'integer' } },
      required: ['invoiceId'],
    },
  },
  async handler(args, ctx) {
    const invoiceId = asInt(args.invoiceId);
    if (!invoiceId) return { error: 'A valid invoiceId is required.' };
    const result = await voidInvoice(invoiceId);
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.invoice.void',
      entityType: 'Invoice',
      entityId: String(invoiceId),
      actorUserId: ctx.userId,
      request: ctx.request,
    });
    return { id: result.id, status: result.status };
  },
};

const deleteInvoiceTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'delete_invoice',
    description: 'Delete a draft invoice. Sent invoices must be voided instead.',
    parameters: {
      type: 'object',
      properties: { invoiceId: { type: 'integer' } },
      required: ['invoiceId'],
    },
  },
  async handler(args, ctx) {
    const invoiceId = asInt(args.invoiceId);
    if (!invoiceId) return { error: 'A valid invoiceId is required.' };
    const result = await deleteInvoice(invoiceId);
    if (result !== true) return result;
    await recordAuditEvent({
      action: 'ai.invoice.delete',
      entityType: 'Invoice',
      entityId: String(invoiceId),
      actorUserId: ctx.userId,
      request: ctx.request,
    });
    return { deleted: true, invoiceId };
  },
};

const updateInvoiceTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_invoice',
    description: 'Update a draft invoice — dates, currency, tax rate, notes, or replace line items. Provide only fields to change.',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'integer' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string' },
        taxRate: { type: 'number', description: 'Decimal 0-1' },
        notes: { type: 'string' },
        items: lineItemsSchema,
      },
      required: ['invoiceId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.invoiceId);
    if (!id) return { error: 'A valid invoiceId is required.' };
    const input: InvoiceUpdateInput = {};
    if (args.dueDate !== undefined) input.dueDate = asString(args.dueDate);
    if (args.currency !== undefined) input.currency = asString(args.currency);
    if (typeof args.taxRate === 'number') input.taxRate = args.taxRate;
    if (args.notes !== undefined) input.notes = asNullableString(args.notes);
    if (Array.isArray(args.items)) input.items = parseLineItems(args.items);
    if (Object.keys(input).length === 0) return { error: 'Provide at least one field to update.' };
    const result = await updateInvoice({ id, input });
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.invoice.update', entityType: 'Invoice', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { id: result.id, number: result.number, total: result.total, status: result.status };
  },
};

const sendInvoiceTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'send_invoice',
    description: 'Mark an invoice as sent to the customer.',
    parameters: {
      type: 'object',
      properties: { invoiceId: { type: 'integer' } },
      required: ['invoiceId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.invoiceId);
    if (!id) return { error: 'A valid invoiceId is required.' };
    const result = await sendInvoice(id);
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.invoice.send', entityType: 'Invoice', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { id: result.id, status: result.status };
  },
};

const invoiceFromQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_invoice_from_quote',
    description: 'Generate a draft invoice from an existing approved quote.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'integer' },
        dueInDays: { type: 'integer', description: 'Days until due (default 14)' },
      },
      required: ['quoteId'],
    },
  },
  async handler(args, ctx) {
    const quoteId = asInt(args.quoteId);
    if (!quoteId) return { error: 'A valid quoteId is required.' };
    const result = await createInvoiceFromQuote({ quoteId, userId: ctx.userId, dueInDays: asInt(args.dueInDays) });
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.invoice.from_quote', entityType: 'Invoice', entityId: String(result.id),
      actorUserId: ctx.userId, metadata: { quoteId }, request: ctx.request,
    });
    return { id: result.id, number: result.number, total: result.total, status: result.status };
  },
};

export const invoiceTools: ToolDefinition[] = [
  listInvoicesTool,
  createInvoiceTool,
  updateInvoiceTool,
  recordPaymentTool,
  sendInvoiceTool,
  invoiceFromQuoteTool,
  voidInvoiceTool,
  deleteInvoiceTool,
];
