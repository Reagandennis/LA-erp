import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

export interface OrganizationSummary {
  companyName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  defaultCurrency: string;
  defaultTaxRate: number;
  taxLabel: string;
  /** Users told when a trip log entry is escalated (lib/trip-escalations). */
  escalationRecipientIds: number[];
  hasLogo: boolean;
  logoMimeType: string | null;
  updatedAt: string;
}

interface OrganizationRecord {
  id: number;
  companyName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  defaultCurrency: string;
  defaultTaxRate: Prisma.Decimal;
  taxLabel: string;
  escalationRecipientIds: number[];
  logo: Buffer | null;
  logoMimeType: string | null;
  updatedById: number | null;
  updatedAt: Date;
}

type OrganizationCollectionClient = {
  findUnique: (args: { where: { id: number } }) => Promise<OrganizationRecord | null>;
  upsert: (args: {
    where: { id: number };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<OrganizationRecord>;
  update: (args: {
    where: { id: number };
    data: Record<string, unknown>;
  }) => Promise<OrganizationRecord>;
};

function getOrganizationClient(): OrganizationCollectionClient {
  return (prisma as unknown as { organizationSettings: OrganizationCollectionClient }).organizationSettings;
}

function toNumber(value: Prisma.Decimal | number): number {
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function serialize(record: OrganizationRecord): OrganizationSummary {
  return {
    companyName: record.companyName,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    city: record.city,
    region: record.region,
    postalCode: record.postalCode,
    country: record.country,
    email: record.email,
    phone: record.phone,
    website: record.website,
    defaultCurrency: record.defaultCurrency,
    defaultTaxRate: toNumber(record.defaultTaxRate),
    taxLabel: record.taxLabel,
    escalationRecipientIds: record.escalationRecipientIds ?? [],
    hasLogo: record.logo !== null,
    logoMimeType: record.logoMimeType,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function getOrganizationSettings(): Promise<OrganizationSummary> {
  const record = await getOrganizationClient().upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  return serialize(record);
}

export interface OrganizationWriteInput {
  companyName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  defaultCurrency?: string;
  defaultTaxRate?: number;
  taxLabel?: string;
  escalationRecipientIds?: number[];
}

export async function updateOrganizationSettings(
  input: OrganizationWriteInput,
  updatedById: number,
): Promise<OrganizationSummary> {
  const data: Record<string, unknown> = { updatedById };
  if (input.companyName !== undefined) data.companyName = input.companyName;
  if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
  if (input.addressLine2 !== undefined) data.addressLine2 = input.addressLine2;
  if (input.city !== undefined) data.city = input.city;
  if (input.region !== undefined) data.region = input.region;
  if (input.postalCode !== undefined) data.postalCode = input.postalCode;
  if (input.country !== undefined) data.country = input.country;
  if (input.email !== undefined) data.email = input.email;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.website !== undefined) data.website = input.website;
  if (input.defaultCurrency !== undefined) data.defaultCurrency = input.defaultCurrency;
  if (input.defaultTaxRate !== undefined)
    data.defaultTaxRate = new Prisma.Decimal(input.defaultTaxRate);
  if (input.taxLabel !== undefined) data.taxLabel = input.taxLabel;
  if (input.escalationRecipientIds !== undefined) data.escalationRecipientIds = [...new Set(input.escalationRecipientIds)];

  const updated = await getOrganizationClient().upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
  return serialize(updated);
}

export async function setOrganizationLogo(
  buffer: Buffer,
  mimeType: string,
  updatedById: number,
): Promise<OrganizationSummary> {
  const updated = await getOrganizationClient().upsert({
    where: { id: 1 },
    create: { id: 1, logo: buffer, logoMimeType: mimeType, updatedById },
    update: { logo: buffer, logoMimeType: mimeType, updatedById },
  });
  return serialize(updated);
}

export async function clearOrganizationLogo(updatedById: number): Promise<OrganizationSummary> {
  const updated = await getOrganizationClient().upsert({
    where: { id: 1 },
    create: { id: 1, updatedById },
    update: { logo: null, logoMimeType: null, updatedById },
  });
  return serialize(updated);
}

export async function getOrganizationLogo(): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const record = await getOrganizationClient().findUnique({ where: { id: 1 } });
  if (!record || !record.logo || !record.logoMimeType) return null;
  return { buffer: record.logo, mimeType: record.logoMimeType };
}
