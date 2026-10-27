import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@prisma/client';

/** One row of the Standardized Naming Master, as prisma/data/standard-services.json holds it. */
export interface StandardService {
  code: string;
  name: string;
  quickbooksName?: string;
  category: string;
  subCategory?: string;
  serviceClass?: string;
  tier?: string;
  country: string;
  location?: string;
  airportCode?: string;
  coverageScope?: string;
  vehicleExamples?: string;
  unitOfMeasure?: string;
  description?: string;
  terms?: string;
  notes?: string;
  /** Awaiting confirmation in the master: added archived, so it can't be quoted yet. */
  proposed: boolean;
}

export interface StandardCatalog {
  source: string;
  title: string;
  version: string;
  services: StandardService[];
}

export const PROPOSED_NOTE = 'PROPOSED in the Standardized Naming Master — confirm or strike before selling.';

export function loadStandardCatalog(): StandardCatalog {
  return JSON.parse(readFileSync(join(__dirname, 'data', 'standard-services.json'), 'utf8')) as StandardCatalog;
}

/** The product rows for the services whose codes aren't in the catalog yet. */
export function standardServicesToCreate(
  catalog: StandardCatalog,
  existingCodes: ReadonlySet<string>,
  defaults: { currency: string; createdById: number },
) {
  return catalog.services
    .filter((service) => !existingCodes.has(service.code))
    .map((service) => ({
      name: service.name,
      sku: service.code,
      description: service.description ?? null,
      quickbooksName: service.quickbooksName ?? null,
      category: service.category,
      subCategory: service.subCategory ?? null,
      serviceClass: service.serviceClass ?? null,
      tier: service.tier ?? null,
      country: service.country,
      location: service.location ?? null,
      airportCode: service.airportCode ?? null,
      coverageScope: service.coverageScope ?? null,
      vehicleExamples: service.vehicleExamples ?? null,
      unitOfMeasure: service.unitOfMeasure ?? null,
      terms: service.terms ?? null,
      notes: service.proposed ? [PROPOSED_NOTE, service.notes].filter(Boolean).join(' ') : (service.notes ?? null),
      // The master leaves pricing to a later phase.
      defaultUnitPrice: 0,
      currency: defaults.currency,
      taxable: true,
      archived: service.proposed,
      createdById: defaults.createdById,
    }));
}

/**
 * Adds the master's services to Products & Services. Each catalog version
 * loads once: a service someone deleted or renamed afterwards is left alone,
 * and a code that is already in the catalog is never added twice.
 */
export async function seedStandardServices(prisma: PrismaClient, createdById: number) {
  const catalog = loadStandardCatalog();
  const version = `${catalog.source} ${catalog.version}`;
  if (await prisma.serviceCatalogImport.findUnique({ where: { version } })) return;

  const organization = await prisma.organizationSettings.findUnique({ where: { id: 1 } });
  const existing = await prisma.product.findMany({
    where: { sku: { in: catalog.services.map((service) => service.code) } },
    select: { sku: true },
  });
  const rows = standardServicesToCreate(catalog, new Set(existing.map((product) => product.sku ?? '')), {
    currency: organization?.defaultCurrency ?? 'USD',
    createdById,
  });

  await prisma.$transaction([
    prisma.product.createMany({ data: rows }),
    prisma.serviceCatalogImport.create({ data: { version, created: rows.length } }),
  ]);
  console.log(`Standard services: added ${rows.length} from ${version}.`);
}
