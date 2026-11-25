import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import {
  SERVICE_DETAIL_KEYS,
  createProduct,
  deleteProduct,
  findProductWithSku,
  getProductById,
  listProducts,
  updateProduct,
  type ProductSummary,
} from '@/lib/products';
import { productCreateSchema, productUpdateSchema } from '@/lib/validation';

import { asString, type ToolDefinition, ToolRefusal } from '../types';
import {
  audit,
  changedFields,
  matches,
  optAmount,
  optCurrency,
  optFlag,
  optText,
  pageOf,
  parseWith,
  reqId,
  reqText,
  requireChange,
} from './_shared';

/** The catalogue is managed in Products & Services and picked from in the quote and invoice builders. */
const MODULE = API_ACCESS.quoteProducts;
const PAGE_SIZE = 20;
const MAX_PRICE = 100_000_000;
const HREF = '/modules/products-services';

async function loadProduct(id: number): Promise<ProductSummary> {
  const product = await getProductById(id);
  if (!product) throw new ToolRefusal(`Product ${id} was not found. Find it with list_products.`);
  return product;
}

/** A service code belongs to one product; the catalogue page refuses a second with the same one. */
async function requireFreeSku(sku: string | null | undefined, exceptId?: number): Promise<void> {
  if (!sku) return;
  const clash = await findProductWithSku(sku, exceptId);
  if (clash) throw new ToolRefusal(`Service code ${sku} is already used by "${clash.name}" (product ${clash.id}). Nothing was saved.`);
}

const listProductsTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_products',
    description:
      'Find products and services in the catalogue by name, service code, category or country, in name order. Archived ones are left out unless includeArchived is true. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Part of a name, service code (SKU), category, country or location' },
        includeArchived: { type: 'boolean' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args) {
    const q = asString(args.q);
    const includeArchived = optFlag(args, 'includeArchived') === true;
    const rows = (await listProducts({ includeArchived })).filter((product) =>
      matches(q, product.name, product.sku, product.category, product.subCategory, product.country, product.location, product.description),
    );
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      products: page.rows.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        price: product.defaultUnitPrice,
        currency: product.currency,
        ...(product.unitOfMeasure ? { unit: product.unitOfMeasure } : {}),
        ...(product.country ? { country: product.country } : {}),
        ...(product.taxable ? {} : { taxable: false }),
        ...(product.archived ? { archived: true } : {}),
      })),
      href: HREF,
    };
  },
};

const getProductTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'get_product',
    description: 'Open one product or service: price, service code, description, tax, whether it is archived, and its catalogue details.',
    parameters: { type: 'object', properties: { productId: { type: 'integer' } }, required: ['productId'] },
  },
  async handler(args) {
    const product = await loadProduct(reqId(args, 'productId', 'use list_products'));
    const details = Object.fromEntries(SERVICE_DETAIL_KEYS.filter((key) => product[key]).map((key) => [key, product[key]]));
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      description: product.description,
      price: product.defaultUnitPrice,
      currency: product.currency,
      taxable: product.taxable,
      archived: product.archived,
      ...(Object.keys(details).length > 0 ? { details } : {}),
      href: HREF,
    };
  },
};

const createProductTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_product',
    description: 'Add a product or service to the catalogue. Its other catalogue details (category, tier, country and so on) are filled in on the page.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        defaultUnitPrice: { type: 'number', description: '0 or more' },
        currency: { type: 'string', description: '3-letter code, default USD' },
        sku: { type: 'string', description: 'Service code; must not be in use' },
        description: { type: 'string' },
        taxable: { type: 'boolean', description: 'Default true' },
      },
      required: ['name', 'defaultUnitPrice'],
    },
  },
  async handler(args, ctx) {
    const price = optAmount(args, 'defaultUnitPrice', { min: 0, max: MAX_PRICE });
    if (price === undefined) throw new ToolRefusal('defaultUnitPrice is required.');
    const input: Record<string, unknown> = {
      name: reqText(args, 'name'),
      defaultUnitPrice: price,
      description: optText(args, 'description') ?? null,
      sku: optText(args, 'sku') ?? null,
    };
    const currency = optCurrency(args);
    if (currency) input.currency = currency;
    const taxable = optFlag(args, 'taxable');
    if (taxable !== undefined) input.taxable = taxable;
    const data = parseWith(productCreateSchema, input);

    const sku = data.sku || null;
    await requireFreeSku(sku);
    const product = await createProduct({
      name: data.name,
      description: data.description ?? null,
      sku,
      defaultUnitPrice: data.defaultUnitPrice,
      currency: data.currency,
      taxable: data.taxable,
      ...Object.fromEntries(SERVICE_DETAIL_KEYS.map((key) => [key, data[key] ?? null])),
      createdById: ctx.userId,
    });
    await audit({
      action: 'quote.product.created',
      entityType: 'product',
      entityId: String(product.id),
      actorUserId: ctx.userId,
      metadata: { name: product.name, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: product.defaultUnitPrice,
      currency: product.currency,
      taxable: product.taxable,
      href: HREF,
      summary: `Added "${product.name}" to the catalogue at ${product.currency} ${product.defaultUnitPrice}`,
    };
  },
};

const productFacts = (product: ProductSummary): Record<string, unknown> => ({
  name: product.name,
  defaultUnitPrice: product.defaultUnitPrice,
  currency: product.currency,
  sku: product.sku,
  description: product.description,
  taxable: product.taxable,
  archived: product.archived,
});

const PRODUCT_FIELDS = Object.keys({ name: 1, defaultUnitPrice: 1, currency: 1, sku: 1, description: 1, taxable: 1, archived: 1 });

const updateProductTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_product',
    description:
      'Change a product or service. Send only what should change. archived: true takes it out of the pickers without deleting it; false brings it back.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'integer' },
        name: { type: 'string' },
        defaultUnitPrice: { type: 'number', description: '0 or more' },
        currency: { type: 'string', description: '3-letter code' },
        sku: { type: 'string', description: 'Service code; null clears', nullable: true },
        description: { type: 'string', description: 'null clears', nullable: true },
        taxable: { type: 'boolean' },
        archived: { type: 'boolean' },
      },
      required: ['productId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'productId', 'use list_products');
    const patch: Record<string, unknown> = {};
    const name = optText(args, 'name');
    if (name != null) patch.name = name;
    const price = optAmount(args, 'defaultUnitPrice', { min: 0, max: MAX_PRICE });
    if (price !== undefined) patch.defaultUnitPrice = price;
    const currency = optCurrency(args);
    if (currency) patch.currency = currency;
    for (const key of ['sku', 'description'] as const) {
      const value = optText(args, key);
      if (value !== undefined) patch[key] = value;
    }
    for (const key of ['taxable', 'archived'] as const) {
      const value = optFlag(args, key);
      if (value !== undefined) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) throw new ToolRefusal('Say what to change on the product.');
    const data = parseWith(productUpdateSchema, patch);

    const before = await loadProduct(id);
    const sku = data.sku === undefined ? undefined : data.sku || null;
    await requireFreeSku(sku, id);
    // A field left out stays as it is; null clears it.
    const after = await updateProduct(id, {
      name: data.name,
      description: data.description,
      sku,
      defaultUnitPrice: data.defaultUnitPrice,
      currency: data.currency,
      taxable: data.taxable,
      archived: data.archived,
    });

    const changed = changedFields(productFacts(before), productFacts(after), PRODUCT_FIELDS);
    requireChange(changed, `"${before.name}"`);
    await audit({
      action: 'quote.product.updated',
      entityType: 'product',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { name: after.name, fields: Object.keys(changed), via: 'assistant' },
      request: ctx.request,
    });
    return {
      id,
      name: after.name,
      changed,
      href: HREF,
      summary: `Updated "${after.name}" in the catalogue: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const deleteProductTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) =>
    `Delete ${asString(args.name) ? `"${asString(args.name)}"` : `product #${args.productId}`} from the catalogue for good. Quote and invoice lines that use it keep their text and price but lose the link, and it is removed from every vendor's catalogue`,
  functionDeclaration: {
    name: 'delete_product',
    description:
      'Delete a product or service for good: quote and invoice lines keep their text but lose the link, and vendors lose it from their catalogues. To retire one and keep the links, archive it with update_product instead.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'integer' },
        name: { type: 'string', description: "The product's name, shown to the user when they confirm" },
      },
      required: ['productId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'productId', 'use list_products');
    const product = await loadProduct(id);
    const named = asString(args.name);
    if (named && named.toLowerCase() !== product.name.toLowerCase()) {
      throw new ToolRefusal(`Product ${id} is "${product.name}", not "${named}". Nothing was deleted: check which product is meant.`);
    }
    try {
      await deleteProduct(id);
    } catch (error) {
      console.error('[assistant] delete_product failed:', error);
      throw new ToolRefusal(`"${product.name}" could not be deleted: something still depends on it. Archive it instead (update_product, archived: true).`);
    }
    await audit({
      action: 'quote.product.deleted',
      entityType: 'product',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { name: product.name, via: 'assistant' },
      request: ctx.request,
    });
    return { deleted: true, productId: id, name: product.name, summary: `Deleted "${product.name}" from the catalogue` };
  },
};

export const productTools: ToolDefinition[] = [listProductsTool, getProductTool, createProductTool, updateProductTool, deleteProductTool];
