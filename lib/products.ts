import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

export interface ProductSummary {
  id: number;
  name: string;
  description: string | null;
  sku: string | null;
  defaultUnitPrice: number;
  currency: string;
  taxable: boolean;
  archived: boolean;
  createdById: number;
  createdAt: string;
  updatedAt: string;
}

interface ProductRecord {
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
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    sku: record.sku,
    defaultUnitPrice: toNumber(record.defaultUnitPrice),
    currency: record.currency,
    taxable: record.taxable,
    archived: record.archived,
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

export async function getProductById(id: number) {
  const record = await getProductClient().findUnique({ where: { id } });
  return record ? serialize(record) : null;
}

export interface ProductWriteInput {
  name: string;
  description: string | null;
  sku: string | null;
  defaultUnitPrice: number;
  currency: string;
  taxable: boolean;
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
      createdById: input.createdById,
    },
  });
  return serialize(created);
}

export async function updateProduct(id: number, input: Partial<ProductWriteInput> & { archived?: boolean }) {
  const data: Record<string, unknown> = {};
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
