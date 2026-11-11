import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';
import { SERVICE_COUNTRIES } from './service-catalog';
import { type ResourceKind, type VendorStatus, VENDOR_STATUSES, resourceKind } from './trip-resource-model';

/**
 * The vendor register: who supplies our services, vehicles and people. Our
 * own fleet and staff sit under an `internal` vendor, so a trip stages its
 * resources the same way whoever provides them. A vendor's catalog is the
 * exact Products & Services it supplies; only approved vendors reach a trip.
 */

export interface VendorDto {
  id: number;
  name: string;
  internal: boolean;
  status: VendorStatus;
  countries: string[];
  contactName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** Its catalog: ids into Products & Services. */
  serviceIds: number[];
  /** Trips with one of its services staged. */
  tripCount: number;
  updatedAt: string;
}

/** A fleet vehicle, and the vendor it is tagged to. */
export interface VendorVehicleRef {
  id: number;
  registration: string;
  make: string | null;
  model: string | null;
  type: string;
  vendorId: number | null;
}

/** Someone in the personnel register, and the vendor they work under. */
export interface VendorPersonRef {
  id: number;
  name: string;
  roles: string[];
  engagement: string;
  status: string;
  vendorId: number | null;
}

export interface VendorRegister {
  vendors: VendorDto[];
  vehicles: VendorVehicleRef[];
  people: VendorPersonRef[];
}

/** A service as the vendor screens list it. */
export interface CatalogService {
  id: number;
  name: string;
  code: string | null;
  category: string | null;
  serviceClass: string | null;
  country: string | null;
  unitOfMeasure: string | null;
}

export type VendorWriteResult = { register: VendorRegister; vendor: VendorDto | null } | { error: string; status: number };

/** What a vendor's kind makes its vehicles (Vehicle.ownership). */
function ownershipOf(internal: boolean): 'Internal' | 'External' {
  return internal ? 'Internal' : 'External';
}

function asStatus(value: string): VendorStatus {
  return (VENDOR_STATUSES as readonly string[]).includes(value) ? (value as VendorStatus) : 'Pending';
}

const vendorSelect = {
  id: true,
  name: true,
  internal: true,
  status: true,
  countries: true,
  contactName: true,
  email: true,
  phone: true,
  notes: true,
  updatedAt: true,
  services: { select: { productId: true } },
  tripResources: { select: { tripId: true } },
} as const;

type VendorRow = Prisma.VendorGetPayload<{ select: typeof vendorSelect }>;

function serializeVendor(row: VendorRow): VendorDto {
  return {
    id: row.id,
    name: row.name,
    internal: row.internal,
    status: asStatus(row.status),
    // The master's order, whatever order they were ticked in.
    countries: SERVICE_COUNTRIES.filter((country) => row.countries.includes(country)),
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    serviceIds: row.services.map((link) => link.productId),
    tripCount: new Set(row.tripResources.map((resource) => resource.tripId)).size,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getVendorRegister(): Promise<VendorRegister> {
  const [vendors, vehicles, people] = await Promise.all([
    prisma.vendor.findMany({ select: vendorSelect, orderBy: [{ internal: 'desc' }, { name: 'asc' }] }),
    prisma.vehicle.findMany({
      select: { id: true, registration: true, make: true, model: true, type: true, vendorId: true },
      orderBy: [{ registration: 'asc' }],
    }),
    prisma.personnel.findMany({
      where: { status: { not: 'Terminated' } },
      select: { id: true, name: true, roles: true, engagement: true, status: true, vendorId: true },
      orderBy: [{ name: 'asc' }],
    }),
  ]);
  return { vendors: vendors.map(serializeVendor), vehicles, people };
}

/** The active catalog, for building a vendor's list of services. */
export async function listCatalogServices(): Promise<CatalogService[]> {
  const rows = await prisma.product.findMany({
    where: { archived: false },
    select: { id: true, name: true, sku: true, category: true, serviceClass: true, country: true, unitOfMeasure: true },
    orderBy: [{ name: 'asc' }],
  });
  return rows.map(({ sku, ...row }) => ({ ...row, code: sku }));
}

async function result(vendorId: number | null): Promise<{ register: VendorRegister; vendor: VendorDto | null }> {
  const register = await getVendorRegister();
  return { register, vendor: register.vendors.find((vendor) => vendor.id === vendorId) ?? null };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export interface VendorInput {
  name: string;
  internal: boolean;
  status: VendorStatus;
  countries: string[];
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

function vendorData(input: Partial<VendorInput>) {
  const text = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null);
  return {
    name: input.name?.trim(),
    internal: input.internal,
    status: input.status,
    countries: input.countries ? [...new Set(input.countries)] : undefined,
    contactName: text(input.contactName),
    email: text(input.email),
    phone: text(input.phone),
    notes: text(input.notes),
  };
}

export async function createVendor(userId: number, input: VendorInput): Promise<VendorWriteResult> {
  try {
    const created = await prisma.vendor.create({
      data: { ...vendorData(input), name: input.name.trim(), createdById: userId },
      select: { id: true },
    });
    return result(created.id);
  } catch (error) {
    if (isUniqueViolation(error)) return { error: 'A vendor with that name already exists', status: 409 };
    throw error;
  }
}

export async function updateVendor(id: number, input: Partial<VendorInput>): Promise<VendorWriteResult> {
  const existing = await prisma.vendor.findUnique({ where: { id }, select: { id: true, internal: true } });
  if (!existing) return { error: 'Vendor not found', status: 404 };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id }, data: vendorData(input) });
      // Its vehicles are internal or external because it is.
      if (input.internal !== undefined && input.internal !== existing.internal) {
        await tx.vehicle.updateMany({ where: { vendorId: id }, data: { ownership: ownershipOf(input.internal) } });
      }
    });
    return result(id);
  } catch (error) {
    if (isUniqueViolation(error)) return { error: 'A vendor with that name already exists', status: 409 };
    throw error;
  }
}

/**
 * A vendor with services staged on a trip stays, so the trip's pool and
 * billing log keep pointing at a real profile: suspend it instead.
 */
export async function deleteVendor(id: number): Promise<VendorWriteResult> {
  const existing = await prisma.vendor.findUnique({
    where: { id },
    select: { tripResources: { select: { tripId: true } } },
  });
  if (!existing) return { error: 'Vendor not found', status: 404 };
  const trips = new Set(existing.tripResources.map((resource) => resource.tripId)).size;
  if (trips > 0) {
    return {
      error: `This vendor has services staged on ${trips} trip${trips === 1 ? '' : 's'}. Suspend it instead of deleting it.`,
      status: 409,
    };
  }
  // Its catalog goes with it; its vehicles and people stay in their registers, untagged.
  await prisma.vendor.delete({ where: { id } });
  return result(null);
}

export interface LinkChange {
  add: number[];
  remove: number[];
}

/** Adds services to, and takes services out of, a vendor's catalog. */
export async function changeVendorServices(id: number, change: LinkChange): Promise<VendorWriteResult> {
  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
  if (!vendor) return { error: 'Vendor not found', status: 404 };
  const add = [...new Set(change.add)];
  if (add.length > 0) {
    const known = await prisma.product.count({ where: { id: { in: add } } });
    if (known !== add.length) return { error: 'One of those services is no longer in Products & Services', status: 400 };
  }
  await prisma.$transaction(async (tx) => {
    if (change.remove.length > 0) {
      await tx.vendorService.deleteMany({ where: { vendorId: id, productId: { in: change.remove } } });
    }
    if (add.length > 0) {
      await tx.vendorService.createMany({ data: add.map((productId) => ({ vendorId: id, productId })), skipDuplicates: true });
    }
  });
  return result(id);
}

/**
 * Tags vehicles to a vendor (moving them from another if need be), or untags
 * its own. A tagged vehicle takes the vendor's kind, internal or external; an
 * untagged one keeps the kind it had.
 */
export async function changeVendorVehicles(id: number, change: LinkChange): Promise<VendorWriteResult> {
  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true, internal: true } });
  if (!vendor) return { error: 'Vendor not found', status: 404 };
  await prisma.$transaction(async (tx) => {
    if (change.remove.length > 0) {
      await tx.vehicle.updateMany({ where: { id: { in: change.remove }, vendorId: id }, data: { vendorId: null } });
    }
    if (change.add.length > 0) {
      await tx.vehicle.updateMany({
        where: { id: { in: change.add } },
        data: { vendorId: id, ownership: ownershipOf(vendor.internal) },
      });
    }
  });
  return result(id);
}

/** Tags people to a vendor, or untags its own. Drivers and CPOs follow their personnel record. */
export async function changeVendorPeople(id: number, change: LinkChange): Promise<VendorWriteResult> {
  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
  if (!vendor) return { error: 'Vendor not found', status: 404 };
  await prisma.$transaction(async (tx) => {
    if (change.remove.length > 0) {
      await tx.personnel.updateMany({ where: { id: { in: change.remove }, vendorId: id }, data: { vendorId: null } });
    }
    if (change.add.length > 0) {
      await tx.personnel.updateMany({ where: { id: { in: change.add } }, data: { vendorId: id } });
    }
  });
  return result(id);
}

// ── What a trip can stage ─────────────────────────────────────────────────

/** A service in an approved vendor's catalog, as the trip's pool offers it. */
export interface PoolServiceOption {
  productId: number;
  name: string;
  code: string | null;
  category: string | null;
  serviceClass: string | null;
  unitOfMeasure: string | null;
  kind: ResourceKind;
}

export interface PoolVendorOption {
  id: number;
  name: string;
  internal: boolean;
  services: PoolServiceOption[];
}

export interface PoolOptions {
  /** Countries with at least one approved vendor, in the master's order. */
  countries: string[];
  /** The approved vendors working in the country asked for, each with its catalog there. */
  vendors: PoolVendorOption[];
}

/**
 * The approved vendors for a country and what each supplies there. A vendor
 * that is pending or suspended, or doesn't work in the country, is never offered.
 */
export async function listPoolOptions(country: string | null): Promise<PoolOptions> {
  const approved = await prisma.vendor.findMany({
    where: { status: 'Approved' },
    select: {
      id: true,
      name: true,
      internal: true,
      countries: true,
      services: {
        where: { product: { archived: false, ...(country ? { OR: [{ country }, { country: null }] } : {}) } },
        select: {
          product: {
            select: { id: true, name: true, sku: true, category: true, serviceClass: true, unitOfMeasure: true },
          },
        },
      },
    },
    orderBy: [{ internal: 'desc' }, { name: 'asc' }],
  });
  const present = new Set(approved.flatMap((vendor) => vendor.countries));
  return {
    countries: SERVICE_COUNTRIES.filter((c) => present.has(c)),
    vendors: country
      ? approved
          .filter((vendor) => vendor.countries.includes(country))
          .map((vendor) => ({
            id: vendor.id,
            name: vendor.name,
            internal: vendor.internal,
            services: vendor.services
              .map(({ product }) => ({
                productId: product.id,
                name: product.name,
                code: product.sku,
                category: product.category,
                serviceClass: product.serviceClass,
                unitOfMeasure: product.unitOfMeasure,
                kind: resourceKind(product.category),
              }))
              .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name)),
          }))
      : [],
  };
}
