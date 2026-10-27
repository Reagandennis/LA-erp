import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { db, requireModuleRequest, recordAuditEvent } = vi.hoisted(() => ({
  db: {
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  requireModuleRequest: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/request-auth', () => ({ requireModuleRequest }));
vi.mock('../lib/audit', () => ({ recordAuditEvent }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => ({ allowed: true })) }));

import { POST as createProduct } from '../app/api/quotes/products/route';
import { PATCH as updateProduct } from '../app/api/quotes/products/[productId]/route';
import { GET as listServices } from '../app/api/trips/services/route';

const row = {
  id: 5,
  name: 'Airport Transfer - SUV Executive - Nairobi (NBO)',
  description: 'One-way transfer between JKIA and a city address.',
  sku: 'KEN-TRF-SUV-EXE-NBO',
  defaultUnitPrice: new Prisma.Decimal(85),
  currency: 'USD',
  taxable: true,
  archived: false,
  quickbooksName: 'Transfers:Airport Transfer:SUV Executive:Nairobi (NBO)',
  category: 'Transfers',
  subCategory: 'Airport Transfer',
  serviceClass: 'SUV',
  tier: 'Executive',
  country: 'Kenya',
  location: 'Nairobi',
  airportCode: 'NBO',
  coverageScope: 'Airport <> City',
  vehicleExamples: 'Land Cruiser V8, Lexus',
  unitOfMeasure: 'Per one-way transfer',
  terms: null,
  notes: null,
  createdById: 1,
  createdAt: new Date('2026-10-27T08:00:00Z'),
  updatedAt: new Date('2026-10-27T08:00:00Z'),
};

const user = (modules: string[]) => ({ id: 7, roles: [], modules: modules.map((slug) => ({ slug })) });
const json = (method: string, url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body) });

beforeEach(() => {
  for (const fn of Object.values(db.product)) fn.mockReset();
  requireModuleRequest.mockReset();
  recordAuditEvent.mockReset();
  requireModuleRequest.mockResolvedValue({ auth: { user: user(['products-services']) }, response: null });
  db.product.findFirst.mockResolvedValue(null);
  db.product.findUnique.mockResolvedValue(row);
  db.product.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data, id: 6 }));
  db.product.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
  db.product.findMany.mockResolvedValue([row]);
});

describe('products & services routes', () => {
  it('saves the master columns with a new service', async () => {
    const res = await createProduct(
      json('POST', '/api/quotes/products', {
        name: 'Mi-Fi Device - Kenya',
        sku: 'KEN-ADD-MIFI',
        defaultUnitPrice: 0,
        category: 'Add-Ons',
        subCategory: 'Communications',
        country: 'Kenya',
        unitOfMeasure: 'Per day',
        tier: '',
      }),
    );
    expect(res.status).toBe(201);
    expect(db.product.create.mock.calls[0]![0].data).toMatchObject({
      name: 'Mi-Fi Device - Kenya',
      sku: 'KEN-ADD-MIFI',
      category: 'Add-Ons',
      subCategory: 'Communications',
      unitOfMeasure: 'Per day',
      tier: null,
    });
  });

  it('refuses a service code another service already has', async () => {
    db.product.findFirst.mockResolvedValue({ id: 5, name: row.name });
    const res = await createProduct(
      json('POST', '/api/quotes/products', { name: 'Copy', sku: 'ken-trf-suv-exe-nbo', defaultUnitPrice: 0 }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain(row.name);
    expect(db.product.findFirst.mock.calls[0]![0].where).toEqual({
      sku: { equals: 'ken-trf-suv-exe-nbo', mode: 'insensitive' },
    });
    expect(db.product.create).not.toHaveBeenCalled();
  });

  it('lets a service keep its own code, and changes only what an update sends', async () => {
    const res = await updateProduct(json('PATCH', '/api/quotes/products/5', { archived: true, sku: 'KEN-TRF-SUV-EXE-NBO' }), {
      params: Promise.resolve({ productId: '5' }),
    });
    expect(res.status).toBe(200);
    expect(db.product.findFirst.mock.calls[0]![0].where.id).toEqual({ not: 5 });
    expect(db.product.update.mock.calls[0]![0].data).toEqual({ archived: true, sku: 'KEN-TRF-SUV-EXE-NBO' });
  });
});

describe('GET /api/trips/services', () => {
  it('offers the active services for trip events', async () => {
    requireModuleRequest.mockResolvedValue({ auth: { user: user(['trip-planning']) }, response: null });
    const res = await listServices(new NextRequest('http://localhost/api/trips/services'));
    expect(requireModuleRequest.mock.calls[0]!.slice(1)).toEqual(['trip-planning']);
    expect(db.product.findMany.mock.calls[0]![0].where).toEqual({ archived: false });
    const { services } = await res.json();
    expect(services).toEqual([
      {
        id: 5,
        code: 'KEN-TRF-SUV-EXE-NBO',
        name: 'Airport Transfer - SUV Executive - Nairobi (NBO)',
        category: 'Transfers',
        subCategory: 'Airport Transfer',
        serviceClass: 'SUV',
        tier: 'Executive',
        country: 'Kenya',
        location: 'Nairobi',
        unitOfMeasure: 'Per one-way transfer',
      },
    ]);
  });

  it('includes prices only for people who see trip costs', async () => {
    requireModuleRequest.mockResolvedValue({ auth: { user: user(['trip-planning', 'quotes']) }, response: null });
    const { services } = await (await listServices(new NextRequest('http://localhost/api/trips/services'))).json();
    expect(services[0]).toMatchObject({ defaultUnitPrice: 85, currency: 'USD' });
  });
});
