import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  linkFindUnique,
  linkUpdate,
  fileFindFirst,
  fileFindUnique,
  getTripDetail,
  getTripForUser,
  requireRequestAuth,
  recordAuditEvent,
} = vi.hoisted(
  () => ({
    linkFindUnique: vi.fn(),
    linkUpdate: vi.fn(),
    fileFindFirst: vi.fn(),
    fileFindUnique: vi.fn(),
    getTripDetail: vi.fn(),
    getTripForUser: vi.fn(),
    requireRequestAuth: vi.fn(),
    recordAuditEvent: vi.fn(),
  }),
);

vi.mock('../lib/prisma', () => ({
  prisma: {
    tripShareLink: { findUnique: linkFindUnique, update: linkUpdate, create: linkUpdate },
    tripItemAttachment: { findFirst: fileFindFirst, findUnique: fileFindUnique },
    quote: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock('../lib/trips', () => ({ getTripDetail, getTripForUser }));
vi.mock('../lib/document-pdf', () => ({ buildTripItineraryPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF')) }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../lib/request-auth', () => ({
  // Module access has its own tests (request-auth-module); these cover the routes themselves.
  requireModuleRequest: (request: unknown) => requireRequestAuth(request),
}));
vi.mock('../lib/audit', () => ({ recordAuditEvent }));
vi.mock('../lib/user', () => ({ userHasRole: () => false }));

import { GET as publicPdf } from '../app/api/share/trip/[token]/pdf/route';
import { PUT as saveShare } from '../app/api/trips/[tripId]/share/route';
import { buildClientItinerary } from '../app/modules/trip-planning/[tripId]/client-itinerary';
import type { TripDetail, TripItineraryItemSummary } from '../app/modules/trip-planning/types';
import { getSharedAttachment, openSharedTrip } from '../lib/trip-share';

const TOKEN = 'a'.repeat(32);

function item(id: number, extra: Partial<TripItineraryItemSummary> = {}): TripItineraryItemSummary {
  return {
    id,
    dayId: 1,
    position: id,
    itemType: 'activity',
    category: 'activity',
    body: null,
    timeLabel: null,
    providerName: null,
    bookingUrl: null,
    phone: null,
    placeName: null,
    address: null,
    details: null,
    description: `Item ${id}`,
    subtitle: null,
    quantity: 1,
    unitPrice: 500,
    completedAt: null,
    sourceQuoteItemId: null,
    scheduledAt: null,
    endsAt: null,
    durationMinutes: null,
    reminderMinutesBefore: null,
    reminderAt: null,
    imageUrl: null,
    confirmationCode: null,
    attachments: [],
    driver: null,
    officer: null,
    vehicle: null,
    travelers: [],
    ...extra,
  };
}

function trip(status: string, items: TripItineraryItemSummary[]): TripDetail {
  return {
    id: 9,
    reference: 'TR-2026-0009',
    trackingCode: 'LA-9',
    title: 'Nairobi visit',
    description: 'Internal description',
    status: status as TripDetail['status'],
    currency: 'USD',
    startDate: '2026-10-20T00:00:00.000Z',
    endDate: '2026-10-22T00:00:00.000Z',
    notes: 'Internal resource summary',
    createdAt: '',
    updatedAt: '',
    customer: { id: 1, name: 'Acme', company: 'Acme Ltd', email: 'ops@acme.test' },
    travelers: [{ id: 1, name: 'Lead Person', isPrimary: true }],
    createdBy: { id: 5, name: 'Planner', email: 'p@x.test' },
    owner: null,
    sourceQuote: null,
    itemCount: items.length,
    assignmentCount: 0,
    logCount: 0,
    items,
    days: [{ id: 1, dateKey: '2026-10-20', dayNumber: 1, title: 'Arrival', summary: null }],
  };
}

const transfer = item(1, {
  category: 'transportation',
  timeLabel: 'PICK-UP',
  scheduledAt: '2026-10-20T07:00:00.000Z',
  body: 'Security: Named Officer',
  details: { pickupLocation: 'JKIA T1A', driverName: 'Typed Driver', driverPhone: '+254700000000' },
  driver: { id: 1, name: 'Linked Driver', phone: '+254711111111' },
  officer: { id: 2, name: 'Officer One', callSign: 'Alpha', grade: 'A', phone: '+254722222222' },
  vehicle: { id: 3, registration: 'KDA 123X', make: 'Toyota', model: 'Land Cruiser', type: 'SUV' },
});
const emptyRun = item(2, { category: 'transportation', timeLabel: 'EMPTY RUN', description: 'Empty run · Base → JKIA' });
const info = item(3, { category: 'information', description: 'Visas', body: 'Bring your passport.' });
const booking = item(4, {
  category: 'booking',
  bookingUrl: 'javascript:alert(1)',
  confirmationCode: 'ABC123',
  attachments: [
    { id: 70, filename: 'ticket.pdf', mimeType: 'application/pdf', size: 1000, createdAt: '', url: '/x', thumbnailUrl: null },
    { id: 71, filename: 'venue.jpg', mimeType: 'image/jpeg', size: 2000, createdAt: '', url: '/y', thumbnailUrl: '/y?thumb=1' },
  ],
});

describe('buildClientItinerary', () => {
  const itinerary = buildClientItinerary(trip('Active', [transfer, emptyRun, info, booking]), { includeCrew: false, includeAttachments: true });
  const items = itinerary.days[0]!.items;

  it('leaves out empty runs, costs and internal trip notes', () => {
    expect(items.map((i) => i.title)).toEqual(['Item 1', 'Visas', 'Item 4']);
    const text = JSON.stringify(itinerary);
    expect(text).not.toContain('500');
    expect(text).not.toContain('Internal');
  });

  it('keeps crew, vehicles and notes back unless asked', () => {
    const [shared] = items;
    expect(shared!.crew).toEqual([]);
    expect(shared!.vehicle).toBeNull();
    expect(shared!.notes).toBeNull();
    expect(shared!.details).toEqual([{ key: 'pickupLocation', label: 'Pick-up', value: 'JKIA T1A' }]);
    expect(JSON.stringify(itinerary)).not.toMatch(/Driver|Officer|KDA|\+254/);
  });

  it('always shows an information item’s text, and only http links', () => {
    expect(items[1]!.notes).toBe('Bring your passport.');
    expect(items[2]!.bookingUrl).toBeNull();
    expect(items[2]!.confirmationCode).toBe('ABC123');
  });

  it('shares photos and documents unless the planner leaves them off', () => {
    expect(items[2]!.attachments).toEqual([
      { id: 70, filename: 'ticket.pdf', mimeType: 'application/pdf', size: 1000, isImage: false },
      { id: 71, filename: 'venue.jpg', mimeType: 'image/jpeg', size: 2000, isImage: true },
    ]);
    const [off] = buildClientItinerary(trip('Active', [booking]), { includeCrew: false, includeAttachments: false })
      .days[0]!.items;
    expect(off!.attachments).toEqual([]);
  });

  it('shares the linked crew when the planner includes them', () => {
    const [withCrew] = buildClientItinerary(trip('Active', [transfer]), { includeCrew: true, includeAttachments: true }).days[0]!.items;
    expect(withCrew!.crew).toEqual([
      { role: 'Driver', name: 'Linked Driver', phone: '+254711111111' },
      { role: 'Close protection', name: 'Officer One (Alpha)', phone: '+254722222222' },
    ]);
    expect(withCrew!.vehicle).toBe('Toyota Land Cruiser KDA 123X');
    expect(withCrew!.notes).toBe('Security: Named Officer');
    // The linked driver replaces the typed-in one.
    expect(withCrew!.details.map((d) => d.label)).toEqual(['Pick-up']);
  });

  it('says who each event is for, and nothing for the whole party', () => {
    const dinner = item(6, { travelers: [{ id: 1, name: 'Lead Person' }, { id: 2, name: 'Second Guest' }] });
    const shown = buildClientItinerary(trip('Active', [dinner, booking]), {
      includeCrew: false,
      includeAttachments: true,
    }).days[0]!.items;
    expect(shown.find((i) => i.id === dinner.id)!.travelers).toEqual(['Lead Person', 'Second Guest']);
    expect(shown.find((i) => i.id === booking.id)!.travelers).toEqual([]);
  });

  it('writes a flight’s time in its airport’s zone', () => {
    const flight = item(5, {
      category: 'flight',
      timeLabel: 'DEPARTURE',
      scheduledAt: '2026-10-20T07:00:00.000Z',
      details: { timezone: 'Africa/Nairobi', flightNumber: 'KQ 100' },
    });
    const [shown] = buildClientItinerary(trip('Active', [flight]), { includeCrew: false, includeAttachments: true }).days[0]!.items;
    expect(shown!.when).toMatch(/^10:00 AM GMT\+3 · Departure$/);
    expect(shown!.details).toEqual([{ key: 'flightNumber', label: 'Flight number', value: 'KQ 100' }]);
  });
});

describe('openSharedTrip', () => {
  beforeEach(() => {
    linkFindUnique.mockReset();
    linkUpdate.mockReset();
    getTripDetail.mockReset();
  });

  it('ignores a malformed token without touching the database', async () => {
    expect(await openSharedTrip('nope')).toBeNull();
    expect(linkFindUnique).not.toHaveBeenCalled();
  });

  it('stops showing the itinerary once the trip is no longer active', async () => {
    linkFindUnique.mockResolvedValue({ id: 1, tripId: 9, includeCrew: true });
    getTripDetail.mockResolvedValue(trip('Completed', [transfer]));
    expect(await openSharedTrip(TOKEN, { recordView: true })).toEqual({ state: 'ended', title: 'Nairobi visit' });
    expect(linkUpdate).not.toHaveBeenCalled();
  });

  it('shows an active trip with the link’s choice of crew, and counts the view', async () => {
    linkFindUnique.mockResolvedValue({ id: 1, tripId: 9, includeCrew: false });
    getTripDetail.mockResolvedValue(trip('Active', [transfer]));
    const shared = await openSharedTrip(TOKEN, { recordView: true });
    expect(shared?.state).toBe('open');
    if (shared?.state !== 'open') return;
    expect(shared.itinerary.days[0]!.items[0]!.crew).toEqual([]);
    expect(shared).not.toHaveProperty('trip');
    expect(linkUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { viewCount: { increment: 1 }, lastViewedAt: expect.any(Date) },
    });
  });
});

describe('share routes', () => {
  beforeEach(() => {
    linkFindUnique.mockReset();
    linkUpdate.mockReset();
    getTripDetail.mockReset();
    getTripForUser.mockReset();
    recordAuditEvent.mockReset();
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 5, roles: [] } }, response: null });
  });

  const put = (body: unknown) =>
    saveShare(new NextRequest('http://localhost/api/trips/9/share', { method: 'PUT', body: JSON.stringify(body) }), {
      params: Promise.resolve({ tripId: '9' }),
    });

  it('only shares an active trip', async () => {
    getTripForUser.mockResolvedValue(trip('Planned', []));
    const r = await put({ includeCrew: false, includeAttachments: true });
    expect(r.status).toBe(400);
    expect(linkUpdate).not.toHaveBeenCalled();
  });

  it('creates a link and keeps the token out of the audit log', async () => {
    getTripForUser.mockResolvedValue(trip('Active', []));
    linkFindUnique.mockResolvedValue(null);
    linkUpdate.mockImplementation(async ({ data }: { data: { token: string; includeCrew: boolean } }) => ({
      token: data.token,
      includeCrew: data.includeCrew,
      createdAt: new Date(),
      viewCount: 0,
      lastViewedAt: null,
      createdBy: { id: 5, name: 'Planner' },
    }));
    const r = await put({ includeCrew: true, includeAttachments: true });
    expect(r.status).toBe(200);
    const { link } = await r.json();
    expect(link.path).toMatch(/^\/share\/trip\/[A-Za-z0-9_-]{32}$/);
    const token = link.path.split('/').pop();
    expect(recordAuditEvent.mock.calls[0]![0].action).toBe('trip.share.created');
    expect(JSON.stringify(recordAuditEvent.mock.calls)).not.toContain(token);
  });

  it('answers the public PDF only while the trip is active', async () => {
    const get = () => publicPdf(new NextRequest(`http://localhost/api/share/trip/${TOKEN}/pdf`), { params: Promise.resolve({ token: TOKEN }) });

    linkFindUnique.mockResolvedValue(null);
    expect((await get()).status).toBe(404);

    linkFindUnique.mockResolvedValue({ id: 1, tripId: 9, includeCrew: false });
    getTripDetail.mockResolvedValue(trip('Completed', []));
    expect((await get()).status).toBe(410);

    getTripDetail.mockResolvedValue(trip('Active', []));
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
  });
});

describe('getSharedAttachment', () => {
  const link = (overrides: { includeAttachments?: boolean; status?: string } = {}) => ({
    tripId: 9,
    includeAttachments: overrides.includeAttachments ?? true,
    trip: { status: overrides.status ?? 'Active' },
  });

  beforeEach(() => {
    linkFindUnique.mockReset();
    fileFindFirst.mockReset();
    fileFindUnique.mockReset();
  });

  it('serves a file on a stop the client sees, from that trip only', async () => {
    linkFindUnique.mockResolvedValue(link());
    fileFindFirst.mockResolvedValue({ filename: 'ticket.pdf', mimeType: 'application/pdf', item: { category: 'booking', timeLabel: null } });
    fileFindUnique.mockResolvedValue({ content: Buffer.from('%PDF') });
    const file = await getSharedAttachment({ token: TOKEN, attachmentId: 70, thumbnail: false });
    expect(file).toMatchObject({ mime: 'application/pdf', name: 'ticket.pdf' });
    expect(fileFindFirst.mock.calls[0]![0].where).toEqual({ id: 70, item: { tripId: 9 } });
  });

  it('falls back to the original when an image has no preview', async () => {
    linkFindUnique.mockResolvedValue(link());
    fileFindFirst.mockResolvedValue({ filename: 'venue.jpg', mimeType: 'image/jpeg', item: { category: 'booking', timeLabel: null } });
    fileFindUnique.mockResolvedValueOnce({ thumbnail: null }).mockResolvedValueOnce({ content: Buffer.from('jpg') });
    expect(await getSharedAttachment({ token: TOKEN, attachmentId: 71, thumbnail: true })).toMatchObject({ mime: 'image/jpeg' });
  });

  it('serves nothing once attachments are off, the trip has ended, or the stop is internal', async () => {
    linkFindUnique.mockResolvedValue(link({ includeAttachments: false }));
    expect(await getSharedAttachment({ token: TOKEN, attachmentId: 70, thumbnail: false })).toBeNull();

    linkFindUnique.mockResolvedValue(link({ status: 'Completed' }));
    expect(await getSharedAttachment({ token: TOKEN, attachmentId: 70, thumbnail: false })).toBeNull();

    linkFindUnique.mockResolvedValue(link());
    fileFindFirst.mockResolvedValue({ filename: 'run.pdf', mimeType: 'application/pdf', item: { category: 'transportation', timeLabel: 'EMPTY RUN' } });
    expect(await getSharedAttachment({ token: TOKEN, attachmentId: 72, thumbnail: false })).toBeNull();
    expect(fileFindUnique).not.toHaveBeenCalled();
  });
});
