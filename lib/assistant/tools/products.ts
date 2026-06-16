import 'server-only';

import { recordAuditEvent } from '@/lib/audit';
import { createProduct, deleteProduct, listProducts, updateProduct } from '@/lib/products';

import { asBool, asInt, asNullableString, asNumber, asString, type ToolDefinition } from '../types';

const MODULE = 'products-services';

const listProductsTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_products',
    description: 'List products / services in the catalogue.',
    parameters: { type: 'object', properties: {} },
  },
  async handler() {
    const rows = await listProducts();
    return rows.slice(0, 50).map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: p.defaultUnitPrice,
      currency: p.currency,
    }));
  },
};

const createProductTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_product',
    description: 'Add a product or service to the catalogue.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        defaultUnitPrice: { type: 'number' },
        currency: { type: 'string', description: '3-letter code, default USD' },
        sku: { type: 'string' },
        description: { type: 'string' },
        taxable: { type: 'boolean' },
      },
      required: ['name', 'defaultUnitPrice'],
    },
  },
  async handler(args, ctx) {
    const name = asString(args.name);
    const price = asNumber(args.defaultUnitPrice);
    if (!name) return { error: 'A product name is required.' };
    if (price == null || price < 0) return { error: 'A valid unit price is required.' };
    const p = await createProduct({
      name,
      description: asNullableString(args.description),
      sku: asNullableString(args.sku),
      defaultUnitPrice: price,
      currency: asString(args.currency) ?? 'USD',
      taxable: asBool(args.taxable) ?? true,
      createdById: ctx.userId,
    });
    await recordAuditEvent({
      action: 'ai.product.create', entityType: 'Product', entityId: String(p.id),
      actorUserId: ctx.userId, metadata: { name: p.name }, request: ctx.request,
    });
    return { id: p.id, name: p.name, price: p.defaultUnitPrice, currency: p.currency };
  },
};

const updateProductTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_product',
    description: 'Update a product/service — name, price, currency, sku, description, taxable, or archived. Provide only fields to change.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'integer' },
        name: { type: 'string' },
        defaultUnitPrice: { type: 'number' },
        currency: { type: 'string' },
        sku: { type: 'string' },
        description: { type: 'string' },
        taxable: { type: 'boolean' },
        archived: { type: 'boolean' },
      },
      required: ['productId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.productId);
    if (!id) return { error: 'A valid productId is required.' };
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = asString(args.name);
    if (typeof args.defaultUnitPrice === 'number') patch.defaultUnitPrice = args.defaultUnitPrice;
    if (args.currency !== undefined) patch.currency = asString(args.currency);
    if (args.sku !== undefined) patch.sku = asNullableString(args.sku);
    if (args.description !== undefined) patch.description = asNullableString(args.description);
    if (args.taxable !== undefined) patch.taxable = asBool(args.taxable);
    if (args.archived !== undefined) patch.archived = asBool(args.archived);
    if (Object.keys(patch).length === 0) return { error: 'Provide at least one field to update.' };
    try {
      const p = await updateProduct(id, patch);
      await recordAuditEvent({ action: 'ai.product.update', entityType: 'Product', entityId: String(id), actorUserId: ctx.userId, request: ctx.request });
      return { id: p.id, name: p.name, price: p.defaultUnitPrice };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Could not update product.' };
    }
  },
};

const deleteProductTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'delete_product',
    description: 'Delete a product/service from the catalogue.',
    parameters: { type: 'object', properties: { productId: { type: 'integer' } }, required: ['productId'] },
  },
  async handler(args, ctx) {
    const id = asInt(args.productId);
    if (!id) return { error: 'A valid productId is required.' };
    try {
      await deleteProduct(id);
      await recordAuditEvent({ action: 'ai.product.delete', entityType: 'Product', entityId: String(id), actorUserId: ctx.userId, request: ctx.request });
      return { deleted: true, productId: id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Could not delete product (it may be in use).' };
    }
  },
};

export const productTools: ToolDefinition[] = [listProductsTool, createProductTool, updateProductTool, deleteProductTool];
