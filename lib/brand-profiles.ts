import 'server-only';

import { prisma } from './prisma';

export interface BrandProfileSummary {
  id: number;
  name: string;
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
  primaryColor: string;
  isDefault: boolean;
  archived: boolean;
  hasLogo: boolean;
  logoMimeType: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandProfileWriteInput {
  name?: string;
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
  primaryColor?: string;
  isDefault?: boolean;
  archived?: boolean;
}

interface BrandProfileRecord {
  id: number;
  name: string;
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
  logo: Buffer | null;
  logoMimeType: string | null;
  primaryColor: string;
  isDefault: boolean;
  archived: boolean;
  createdById: number;
  createdAt: Date;
  updatedAt: Date;
}

function serialize(record: BrandProfileRecord): BrandProfileSummary {
  return {
    id: record.id,
    name: record.name,
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
    primaryColor: record.primaryColor,
    isDefault: record.isDefault,
    archived: record.archived,
    hasLogo: record.logo !== null,
    logoMimeType: record.logoMimeType,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function brandClient() {
  return prisma['brandProfile' as keyof typeof prisma] as unknown as {
    findUnique: (args: { where: { id: number } }) => Promise<BrandProfileRecord | null>;
    findFirst: (args: { where: Record<string, unknown>; orderBy?: unknown }) => Promise<BrandProfileRecord | null>;
    findMany: (args: { where?: Record<string, unknown>; orderBy?: unknown }) => Promise<BrandProfileRecord[]>;
    create: (args: { data: Record<string, unknown> }) => Promise<BrandProfileRecord>;
    update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<BrandProfileRecord>;
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
    delete: (args: { where: { id: number } }) => Promise<BrandProfileRecord>;
    count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
  };
}

export async function listBrandProfiles(opts: { includeArchived?: boolean } = {}): Promise<BrandProfileSummary[]> {
  const where = opts.includeArchived ? {} : { archived: false };
  const records = await brandClient().findMany({
    where,
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
  return records.map(serialize);
}

export async function getBrandProfile(id: number): Promise<BrandProfileSummary | null> {
  const record = await brandClient().findUnique({ where: { id } });
  return record ? serialize(record) : null;
}

export async function getDefaultBrandProfile(): Promise<BrandProfileSummary | null> {
  const record = await brandClient().findFirst({
    where: { isDefault: true, archived: false },
  });
  return record ? serialize(record) : null;
}

export async function createBrandProfile(
  input: BrandProfileWriteInput & { name: string },
  createdById: number,
): Promise<BrandProfileSummary> {
  return prisma.$transaction(async (tx) => {
    const txClient = (tx as unknown as { brandProfile: ReturnType<typeof brandClient> }).brandProfile;
    const data: Record<string, unknown> = {
      name: input.name,
      companyName: input.companyName ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      website: input.website ?? null,
      primaryColor: input.primaryColor ?? '#059669',
      isDefault: input.isDefault ?? false,
      archived: input.archived ?? false,
      createdById,
    };
    if (data.isDefault) {
      await txClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    } else {
      const existing = await txClient.count({ where: { archived: false } });
      if (existing === 0) data.isDefault = true;
    }
    const created = await txClient.create({ data });
    return serialize(created);
  });
}

export async function updateBrandProfile(
  id: number,
  input: BrandProfileWriteInput,
): Promise<BrandProfileSummary> {
  return prisma.$transaction(async (tx) => {
    const txClient = (tx as unknown as { brandProfile: ReturnType<typeof brandClient> }).brandProfile;
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
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
    if (input.primaryColor !== undefined) data.primaryColor = input.primaryColor;
    if (input.archived !== undefined) data.archived = input.archived;
    if (input.isDefault === true) {
      await txClient.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
      data.isDefault = true;
    } else if (input.isDefault === false) {
      const current = await txClient.findUnique({ where: { id } });
      if (current?.isDefault) {
        throw new Error('Cannot unset the default brand profile directly; set another profile as default instead.');
      }
    }
    const updated = await txClient.update({ where: { id }, data });
    return serialize(updated);
  });
}

export async function deleteBrandProfile(id: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const txClient = (tx as unknown as { brandProfile: ReturnType<typeof brandClient> }).brandProfile;
    const current = await txClient.findUnique({ where: { id } });
    if (!current) return;
    if (current.isDefault) {
      const replacement = await txClient.findFirst({
        where: { archived: false, id: { not: id } },
        orderBy: { name: 'asc' },
      });
      if (replacement) {
        await txClient.update({ where: { id: replacement.id }, data: { isDefault: true } });
      }
    }
    await txClient.delete({ where: { id } });
  });
}

export async function setBrandProfileLogo(
  id: number,
  buffer: Buffer,
  mimeType: string,
): Promise<BrandProfileSummary> {
  const updated = await brandClient().update({
    where: { id },
    data: { logo: buffer, logoMimeType: mimeType },
  });
  return serialize(updated);
}

export async function clearBrandProfileLogo(id: number): Promise<BrandProfileSummary> {
  const updated = await brandClient().update({
    where: { id },
    data: { logo: null, logoMimeType: null },
  });
  return serialize(updated);
}

export async function getBrandProfileLogo(
  id: number,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const record = await brandClient().findUnique({ where: { id } });
  if (!record || !record.logo || !record.logoMimeType) return null;
  return { buffer: record.logo, mimeType: record.logoMimeType };
}
