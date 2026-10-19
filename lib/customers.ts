import 'server-only';

import { prisma } from './prisma';

export interface CustomerSummary {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  billingAddress: string | null;
  createdById: number;
  createdAt: string;
  updatedAt: string;
}

type CustomerRecord = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  billingAddress: string | null;
  createdById: number;
  createdAt: Date;
  updatedAt: Date;
};

type CustomerCollectionClient = {
  findMany: (args: {
    orderBy: Array<{ name?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' }>;
  }) => Promise<CustomerRecord[]>;
  findUnique: (args: { where: { id: number } }) => Promise<CustomerRecord | null>;
  create: (args: {
    data: {
      name: string;
      email: string | null;
      phone: string | null;
      company: string | null;
      address: string | null;
      billingAddress: string | null;
      createdById: number;
    };
  }) => Promise<CustomerRecord>;
  update: (args: {
    where: { id: number };
    data: Partial<{
      name: string;
      email: string | null;
      phone: string | null;
      company: string | null;
      address: string | null;
      billingAddress: string | null;
    }>;
  }) => Promise<CustomerRecord>;
  delete: (args: { where: { id: number } }) => Promise<CustomerRecord>;
};

function getCustomerClient(): CustomerCollectionClient {
  return (prisma as unknown as { customer: CustomerCollectionClient }).customer;
}

function serializeCustomer(record: CustomerRecord): CustomerSummary {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    company: record.company,
    address: record.address,
    billingAddress: record.billingAddress,
    createdById: record.createdById,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function listCustomers(): Promise<CustomerSummary[]> {
  const records = await getCustomerClient().findMany({
    orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
  });
  return records.map(serializeCustomer);
}

export async function getCustomerById(id: number) {
  const record = await getCustomerClient().findUnique({ where: { id } });
  return record ? serializeCustomer(record) : null;
}

export interface CreateCustomerInput {
  name: string;
  email: string | null;
  phone?: string | null;
  company?: string | null;
  address?: string | null;
  billingAddress?: string | null;
  createdById: number;
}

export async function createCustomer(input: CreateCustomerInput) {
  const created = await getCustomerClient().create({
    data: {
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      company: input.company ?? null,
      address: input.address ?? null,
      billingAddress: input.billingAddress ?? null,
      createdById: input.createdById,
    },
  });
  return serializeCustomer(created);
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  address?: string | null;
  billingAddress?: string | null;
}

export async function updateCustomer(id: number, patch: UpdateCustomerInput): Promise<CustomerSummary | null> {
  const existing = await getCustomerClient().findUnique({ where: { id } });
  if (!existing) return null;

  const data: UpdateCustomerInput = {};
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (v) data.name = v;
  }
  if (patch.email !== undefined) data.email = patch.email?.trim() || null;
  if (patch.phone !== undefined) data.phone = patch.phone?.trim() || null;
  if (patch.company !== undefined) data.company = patch.company?.trim() || null;
  if (patch.address !== undefined) data.address = patch.address?.trim() || null;
  if (patch.billingAddress !== undefined) data.billingAddress = patch.billingAddress?.trim() || null;

  const updated = await getCustomerClient().update({ where: { id }, data });
  return serializeCustomer(updated);
}

export async function deleteCustomer(id: number): Promise<true | { error: string }> {
  const existing = await getCustomerClient().findUnique({ where: { id } });
  if (!existing) return { error: 'Client not found' };
  try {
    await getCustomerClient().delete({ where: { id } });
    return true;
  } catch {
    // Foreign-key restriction: the customer is referenced by quotes/invoices/trips.
    return { error: 'This client cannot be deleted because it has related quotes, invoices, or trips.' };
  }
}
