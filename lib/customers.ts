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
};

const customerClient = (
  prisma as unknown as { customer: CustomerCollectionClient }
).customer;

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
  const records = await customerClient.findMany({
    orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
  });
  return records.map(serializeCustomer);
}

export async function getCustomerById(id: number) {
  const record = await customerClient.findUnique({ where: { id } });
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
  const created = await customerClient.create({
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
