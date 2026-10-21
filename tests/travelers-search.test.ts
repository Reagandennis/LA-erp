import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { findMany, count } = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock('../lib/prisma', () => ({ prisma: { traveler: { findMany, count } } }));

import { searchTravelers, travelerStats } from '../lib/travelers';

const row = {
  id: 1,
  name: 'Jane Doe',
  email: null,
  phone: null,
  nationality: 'Kenyan',
  passportExpiry: new Date('2027-01-01T00:00:00Z'),
  status: 'Active',
  riskLevel: 'High',
  photoName: 'jane.jpg',
  customer: { id: 2, name: 'Acme', company: null },
  _count: { trips: 4 },
};

describe('searchTravelers', () => {
  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
    findMany.mockResolvedValue([row]);
    count.mockResolvedValue(1);
  });

  it('filters, searches case-insensitively and pages in the database', async () => {
    const result = await searchTravelers({ q: ' jane ', risk: 'High', status: 'Active', page: 3, pageSize: 20 });

    const args = findMany.mock.calls[0][0];
    expect(args.skip).toBe(40);
    expect(args.take).toBe(20);
    expect(args.where.AND).toEqual([
      { riskLevel: 'High' },
      { status: 'Active' },
      {
        OR: [
          { name: { contains: 'jane', mode: 'insensitive' } },
          { email: { contains: 'jane', mode: 'insensitive' } },
          { phone: { contains: 'jane', mode: 'insensitive' } },
          { nationality: { contains: 'jane', mode: 'insensitive' } },
          { customer: { is: { name: { contains: 'jane', mode: 'insensitive' } } } },
          { customer: { is: { company: { contains: 'jane', mode: 'insensitive' } } } },
        ],
      },
    ]);
    // The same filter counts the total, so "N more" on the client is exact.
    expect(count).toHaveBeenCalledWith({ where: args.where });
    expect(result).toEqual({
      items: [
        {
          id: 1,
          name: 'Jane Doe',
          email: null,
          phone: null,
          nationality: 'Kenyan',
          passportExpiry: '2027-01-01T00:00:00.000Z',
          status: 'Active',
          riskLevel: 'High',
          hasPhoto: true,
          customer: { id: 2, name: 'Acme', company: null },
          tripCount: 4,
        },
      ],
      total: 1,
      page: 3,
      pageSize: 20,
    });
  });

  it('ignores unknown filter values and clamps the page size', async () => {
    await searchTravelers({ risk: 'Astronaut', status: 'Whatever', page: 0, pageSize: 5000 });

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({});
    expect(args.skip).toBe(0);
    expect(args.take).toBe(200);
  });

  it('never selects the long text fields for a list row', async () => {
    await searchTravelers();

    const select = findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('medicalNotes');
    expect(select).not.toHaveProperty('notes');
    expect(select).not.toHaveProperty('passportNumber');
    expect(select).not.toHaveProperty('dateOfBirth');
  });
});

describe('travelerStats', () => {
  it('counts the tiles in the database, with a 180-day passport window', async () => {
    count.mockReset();
    count.mockResolvedValueOnce(10).mockResolvedValueOnce(8).mockResolvedValueOnce(2).mockResolvedValueOnce(3);

    const stats = await travelerStats(new Date('2026-01-01T00:00:00Z'));

    expect(stats).toEqual({ total: 10, active: 8, elevatedRisk: 2, passportExpiring: 3 });
    expect(count).toHaveBeenNthCalledWith(2, { where: { status: 'Active' } });
    expect(count).toHaveBeenNthCalledWith(3, { where: { riskLevel: { not: 'Standard' } } });
    expect(count).toHaveBeenNthCalledWith(4, { where: { passportExpiry: { lte: new Date('2026-06-30T00:00:00Z') } } });
  });
});
