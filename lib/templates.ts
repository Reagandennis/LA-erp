import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';
import type { DiscountType } from './quotes';

export interface TemplateLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxable: boolean;
  discountType: DiscountType;
  discountValue: number;
  productId: number | null;
}

export interface QuoteTemplateSummary {
  id: number;
  name: string;
  description: string | null;
  taxRate: number;
  currency: string;
  terms: string | null;
  notes: string | null;
  discountType: DiscountType;
  discountValue: number;
  items: TemplateLineItem[];
  createdById: number;
  createdAt: string;
  updatedAt: string;
}

interface TemplateRecord {
  id: number;
  name: string;
  description: string | null;
  taxRate: Prisma.Decimal;
  currency: string;
  terms: string | null;
  notes: string | null;
  discountType: string;
  discountValue: Prisma.Decimal;
  items: Prisma.JsonValue;
  createdById: number;
  createdAt: Date;
  updatedAt: Date;
}

type TemplateCollectionClient = {
  findMany: (args: { orderBy: Array<{ name: 'asc' | 'desc' }> }) => Promise<TemplateRecord[]>;
  findUnique: (args: { where: { id: number } }) => Promise<TemplateRecord | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<TemplateRecord>;
  update: (args: {
    where: { id: number };
    data: Record<string, unknown>;
  }) => Promise<TemplateRecord>;
  delete: (args: { where: { id: number } }) => Promise<TemplateRecord>;
};

function getTemplateClient(): TemplateCollectionClient {
  return (prisma as unknown as { quoteTemplate: TemplateCollectionClient }).quoteTemplate;
}

function toNumber(value: Prisma.Decimal | number): number {
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function normaliseItems(raw: Prisma.JsonValue): TemplateLineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      const description = typeof item.description === 'string' ? item.description : '';
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      if (!description || !Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return null;
      return {
        description,
        quantity,
        unitPrice,
        taxable: item.taxable !== false,
        discountType: (item.discountType as DiscountType) ?? 'none',
        discountValue: Number.isFinite(Number(item.discountValue))
          ? Number(item.discountValue)
          : 0,
        productId:
          typeof item.productId === 'number' && Number.isInteger(item.productId)
            ? item.productId
            : null,
      } satisfies TemplateLineItem;
    })
    .filter((value): value is TemplateLineItem => value !== null);
}

function serialize(record: TemplateRecord): QuoteTemplateSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    taxRate: toNumber(record.taxRate),
    currency: record.currency,
    terms: record.terms,
    notes: record.notes,
    discountType: record.discountType as DiscountType,
    discountValue: toNumber(record.discountValue),
    items: normaliseItems(record.items),
    createdById: record.createdById,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function listTemplates(): Promise<QuoteTemplateSummary[]> {
  const records = await getTemplateClient().findMany({ orderBy: [{ name: 'asc' }] });
  return records.map(serialize);
}

export async function getTemplate(id: number) {
  const record = await getTemplateClient().findUnique({ where: { id } });
  return record ? serialize(record) : null;
}

export interface TemplateWriteInput {
  name: string;
  description: string | null;
  taxRate: number;
  currency: string;
  terms: string | null;
  notes: string | null;
  discountType: DiscountType;
  discountValue: number;
  items: TemplateLineItem[];
}

export async function createTemplate(input: TemplateWriteInput & { createdById: number }) {
  const created = await getTemplateClient().create({
    data: {
      name: input.name,
      description: input.description,
      taxRate: new Prisma.Decimal(input.taxRate),
      currency: input.currency,
      terms: input.terms,
      notes: input.notes,
      discountType: input.discountType,
      discountValue: new Prisma.Decimal(input.discountValue),
      items: input.items as unknown as Prisma.InputJsonValue,
      createdById: input.createdById,
    },
  });
  return serialize(created);
}

export async function updateTemplate(id: number, input: Partial<TemplateWriteInput>) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.taxRate !== undefined) data.taxRate = new Prisma.Decimal(input.taxRate);
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.terms !== undefined) data.terms = input.terms;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.discountType !== undefined) data.discountType = input.discountType;
  if (input.discountValue !== undefined)
    data.discountValue = new Prisma.Decimal(input.discountValue);
  if (input.items !== undefined) data.items = input.items as unknown as Prisma.InputJsonValue;
  const updated = await getTemplateClient().update({ where: { id }, data });
  return serialize(updated);
}

export async function deleteTemplate(id: number) {
  await getTemplateClient().delete({ where: { id } });
}
