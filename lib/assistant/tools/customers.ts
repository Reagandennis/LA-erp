import 'server-only';

import { createCustomer, deleteCustomer, listCustomers, updateCustomer } from '@/lib/customers';
import { recordAuditEvent } from '@/lib/audit';

import { asInt, asNullableString, asString, type ToolDefinition } from '../types';

const listCustomersTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'list_customers',
    description: 'List customers/clients. Use to find a customer ID before creating a quote, invoice, or trip.',
    parameters: { type: 'object', properties: {} },
  },
  async handler() {
    const rows = await listCustomers();
    return rows.slice(0, 50).map((c) => ({ id: c.id, name: c.name, company: c.company, email: c.email }));
  },
};

const createCustomerTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'create_customer',
    description: 'Create a new customer / client record.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Customer or company contact name' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company: { type: 'string' },
        address: { type: 'string' },
      },
      required: ['name'],
    },
  },
  async handler(args, ctx) {
    const name = asString(args.name);
    if (!name) return { error: 'A customer name is required.' };
    const created = await createCustomer({
      name,
      email: asNullableString(args.email),
      phone: asNullableString(args.phone),
      company: asNullableString(args.company),
      address: asNullableString(args.address),
      createdById: ctx.userId,
    });
    await recordAuditEvent({
      action: 'ai.customer.create',
      entityType: 'Customer',
      entityId: String(created.id),
      actorUserId: ctx.userId,
      metadata: { name: created.name },
      request: ctx.request,
    });
    return { id: created.id, name: created.name };
  },
};

const updateCustomerTool: ToolDefinition = {
  destructive: false,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'update_customer',
    description:
      "Update an existing customer's details (email, phone, company, address, or name). Find the customer ID with list_customers first. Only provide the fields you want to change.",
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company: { type: 'string' },
        address: { type: 'string' },
      },
      required: ['customerId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.customerId);
    if (!id) return { error: 'A valid customerId is required (use list_customers).' };

    const patch: {
      name?: string;
      email?: string | null;
      phone?: string | null;
      company?: string | null;
      address?: string | null;
    } = {};
    if (args.name !== undefined) patch.name = asString(args.name);
    if (args.email !== undefined) patch.email = asNullableString(args.email);
    if (args.phone !== undefined) patch.phone = asNullableString(args.phone);
    if (args.company !== undefined) patch.company = asNullableString(args.company);
    if (args.address !== undefined) patch.address = asNullableString(args.address);
    if (Object.keys(patch).length === 0) return { error: 'Provide at least one field to update.' };

    const updated = await updateCustomer(id, patch);
    if (!updated) return { error: 'Customer not found.' };
    await recordAuditEvent({
      action: 'ai.customer.update',
      entityType: 'Customer',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { fields: Object.keys(patch) },
      request: ctx.request,
    });
    return { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, company: updated.company };
  },
};

const deleteCustomerTool: ToolDefinition = {
  destructive: true,
  requiredModule: 'quotes',
  functionDeclaration: {
    name: 'delete_customer',
    description: 'Delete a customer. Fails if the customer has related quotes, invoices, or trips.',
    parameters: {
      type: 'object',
      properties: { customerId: { type: 'integer' } },
      required: ['customerId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.customerId);
    if (!id) return { error: 'A valid customerId is required.' };
    const result = await deleteCustomer(id);
    if (result !== true) return result;
    await recordAuditEvent({
      action: 'ai.customer.delete',
      entityType: 'Customer',
      entityId: String(id),
      actorUserId: ctx.userId,
      request: ctx.request,
    });
    return { deleted: true, customerId: id };
  },
};

export const customerTools: ToolDefinition[] = [
  listCustomersTool,
  createCustomerTool,
  updateCustomerTool,
  deleteCustomerTool,
];
