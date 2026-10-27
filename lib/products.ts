import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

/** The Standardized Naming Master's columns, beside the name, code and description. */
export const SERVICE_DETAIL_KEYS = [
  'quickbooksName',
  'category',
  'subCategory',
  'serviceClass',
  'tier',
  'country',
  'location',
  'airportCode',
  'coverageScope',
  'vehicleExamples',
  'unitOfMeasure',
  'terms',
  'notes',
] as const;

export type ServiceDetailKey = (typeof SERVICE_DETAIL_KEYS)[number];
export type ServiceDetails = Record<ServiceDetailKey, string | null>;

export interface ProductSummary extends ServiceDetails {
  id: number;
  /** The Standardized Service Name. */
  name: string;
  description: string | null;
  /** The Service Code. */
  sku: string | null;
  defaultUnitPrice: number;
  currency: string;
  taxable: boolean;
  archived: boolean;
  createdById: number;
  createdAt: string;
  updatedAt: string;
}

interface ProductRecord extends ServiceDetails {
  id: number;
  name: string;
  description: string | null;
  sku: string | null;
  defaultUnitPrice: Prisma.Decimal;
  currency: string;
  taxable: boolean;
  archived: boolean;
  createdById: number;
  createdAt: Date;
  updatedAt: Date;
}

type ProductCollectionClient = {
  findMany: (args: {
    where?: { archived?: boolean };
    orderBy?: Array<{ name?: 'asc' | 'desc'; updatedAt?: 'asc' | 'desc' }>;
  }) => Promise<ProductRecord[]>;
  findUnique: (args: { where: { id: number } }) => Promise<ProductRecord | null>;
  findFirst: (args: {
    where: { sku: { equals: string; mode: 'insensitive' }; id?: { not: number } };
    select: { id: true; name: true };
  }) => Promise<{ id: number; name: string } | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<ProductRecord>;
  update: (args: {
    where: { id: number };
    data: Record<string, unknown>;
  }) => Promise<ProductRecord>;
  delete: (args: { where: { id: number } }) => Promise<ProductRecord>;
};

function getProductClient(): ProductCollectionClient {
  return (prisma as unknown as { product: ProductCollectionClient }).product;
}

function toNumber(value: Prisma.Decimal | number): number {
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function serialize(record: ProductRecord): ProductSummary {
  const details = Object.fromEntries(SERVICE_DETAIL_KEYS.map((key) => [key, record[key] ?? null])) as ServiceDetails;
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    sku: record.sku,
    defaultUnitPrice: toNumber(record.defaultUnitPrice),
    currency: record.currency,
    taxable: record.taxable,
    archived: record.archived,
    ...details,
    createdById: record.createdById,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function listProducts(options: { includeArchived?: boolean } = {}): Promise<ProductSummary[]> {
  const records = await getProductClient().findMany({
    where: options.includeArchived ? undefined : { archived: false },
    orderBy: [{ name: 'asc' }],
  });
  return records.map(serialize);
}

/**
 * Active products as the quote and invoice line pickers need them. The full
 * records carry descriptions, terms and notes the pickers never show, which
 * for the standardized catalog's hundreds of services is a heavy page.
 */
export async function listProductOptions() {
  return (await listProducts()).map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    defaultUnitPrice: product.defaultUnitPrice,
    currency: product.currency,
    taxable: product.taxable,
    archived: product.archived,
    unitOfMeasure: product.unitOfMeasure,
    country: product.country,
  }));
}

export async function getProductById(id: number) {
  const record = await getProductClient().findUnique({ where: { id } });
  return record ? serialize(record) : null;
}

/** Service codes are unique and never reused, so a second product can't take one. */
export async function findProductWithSku(sku: string, exceptId?: number) {
  return getProductClient().findFirst({
    where: { sku: { equals: sku, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true },
  });
}

export interface ProductWriteInput extends Partial<ServiceDetails> {
  name: string;
  description: string | null;
  sku: string | null;
  defaultUnitPrice: number;
  currency: string;
  taxable: boolean;
}

function serviceDetailData(input: Partial<ServiceDetails>) {
  const data: Record<string, unknown> = {};
  for (const key of SERVICE_DETAIL_KEYS) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  return data;
}

export async function createProduct(input: ProductWriteInput & { createdById: number }) {
  const created = await getProductClient().create({
    data: {
      name: input.name,
      description: input.description,
      sku: input.sku,
      defaultUnitPrice: new Prisma.Decimal(input.defaultUnitPrice),
      currency: input.currency,
      taxable: input.taxable,
      ...serviceDetailData(input),
      createdById: input.createdById,
    },
  });
  return serialize(created);
}

export async function updateProduct(id: number, input: Partial<ProductWriteInput> & { archived?: boolean }) {
  const data: Record<string, unknown> = serviceDetailData(input);
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.sku !== undefined) data.sku = input.sku;
  if (input.defaultUnitPrice !== undefined)
    data.defaultUnitPrice = new Prisma.Decimal(input.defaultUnitPrice);
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.taxable !== undefined) data.taxable = input.taxable;
  if (input.archived !== undefined) data.archived = input.archived;
  const updated = await getProductClient().update({ where: { id }, data });
  return serialize(updated);
}

export async function deleteProduct(id: number) {
  await getProductClient().delete({ where: { id } });
}
