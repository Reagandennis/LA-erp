import { writeFileSync } from 'fs';

import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../lib/prisma', () => ({ prisma: { tripItemAttachment: { findMany } } }));

import type { ClientItinerary, ClientItineraryAttachment } from '../app/modules/trip-planning/[tripId]/client-itinerary';
import { loadPdfPhotos } from '../lib/trip-attachments';
import { PDF_PHOTOS_PER_ITEM, pdfPhotoIds, renderTripItineraryPdf } from '../lib/trip-pdf';

const itinerary: ClientItinerary = {
  reference: 'TR-2026-0001',
  title: 'Nairobi visit',
  status: 'Active',
  startDate: '2026-10-20T00:00:00.000Z',
  endDate: '2026-10-22T00:00:00.000Z',
  customer: { name: 'Acme', company: 'Acme Ltd' },
  travelers: ['Lead Person'],
  includeCrew: true,
  includeAttachments: false,
  days: [
    {
      id: 1,
      dayNumber: 1,
      title: 'Arrival',
      heading: 'Day 1 · Arrival',
      date: 'Tuesday, Oct 20',
      dateKey: '2026-10-20',
      summary: 'Arrive and settle in.',
      items: [
        {
          id: 1,
          category: 'transportation',
          categoryLabel: 'Transport',
          when: '10:40 AM – 10:57 AM · Pick-up',
          time: '10:40 AM – 10:57 AM',
          timeLabel: 'Pick-up',
          startsAt: '2026-10-20T07:40:00.000Z',
          // Helvetica has no arrow; the renderer swaps it for one it has.
          title: '179 Runda Drive → JW Marriott',
          subtitle: null,
          place: 'JKIA T1A',
          address: null,
          phone: '+254 700 000000',
          bookingUrl: 'https://example.test/booking',
          provider: { label: 'Company', name: 'Fleet Co' },
          details: [{ key: 'mode', label: 'Mode', value: 'Private transfer' }],
          confirmationCode: 'ABC123',
          notes: 'Meet at arrivals.',
          crew: [{ role: 'Driver', name: 'A Driver', phone: '+254 711 000000' }],
          vehicle: 'Toyota Land Cruiser KDA 123X',
          attachments: [],
          done: true,
        },
      ],
    },
  ],
  unscheduled: [],
};

const brand = {
  companyName: 'Example Co',
  addressLine1: null,
  addressLine2: null,
  city: null,
  region: null,
  postalCode: null,
  country: null,
  email: 'ops@example.test',
  phone: '+254 700 111222',
  website: null,
  primaryColor: '#03458f',
};

function photo(id: number): ClientItineraryAttachment {
  return { id, filename: `photo-${id}.jpg`, mimeType: 'image/jpeg', size: 1000, isImage: true };
}

const solid = (format: 'webp' | 'jpeg') =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: '#3366cc' } })[format]().toBuffer();

describe('renderTripItineraryPdf', () => {
  it('renders the client itinerary to a PDF', async () => {
    const pdf = await renderTripItineraryPdf({ itinerary, brand, logo: null });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    // Set to look at the result by eye.
    if (process.env.TRIP_PDF_OUT) writeFileSync(process.env.TRIP_PDF_OUT, pdf);
  });

  it('draws the stops’ photos it is given', async () => {
    const jpeg = `data:image/jpeg;base64,${(await solid('jpeg')).toString('base64')}`;
    const withPhotos: ClientItinerary = {
      ...itinerary,
      includeAttachments: true,
      days: itinerary.days.map((day) => ({
        ...day,
        items: day.items.map((item) => ({ ...item, attachments: [photo(1), photo(2)] })),
      })),
    };
    const plain = await renderTripItineraryPdf({ itinerary: withPhotos, brand, logo: null });
    const pdf = await renderTripItineraryPdf({
      itinerary: withPhotos,
      brand,
      logo: null,
      photos: new Map([[1, jpeg], [2, jpeg]]),
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.toString('latin1')).toContain('/Subtype /Image');
    expect(plain.toString('latin1')).not.toContain('/Subtype /Image');
  });
});

describe('pdfPhotoIds', () => {
  it('asks for at most a row of photos per stop, and never documents', () => {
    const files = [
      { id: 90, filename: 'ticket.pdf', mimeType: 'application/pdf', size: 1, isImage: false },
      ...Array.from({ length: 7 }, (_, i) => photo(i + 1)),
    ];
    const ids = pdfPhotoIds({
      ...itinerary,
      days: [{ ...itinerary.days[0]!, items: [{ ...itinerary.days[0]!.items[0]!, attachments: files }] }],
    });
    expect(ids).toEqual([1, 2, 3, 4].slice(0, PDF_PHOTOS_PER_ITEM));
  });
});

describe('loadPdfPhotos', () => {
  it('turns stored WebP previews into JPEG, skipping those without one', async () => {
    findMany.mockResolvedValue([
      { id: 1, thumbnail: await solid('webp') },
      { id: 2, thumbnail: null },
    ]);
    const photos = await loadPdfPhotos([1, 2]);
    expect([...photos.keys()]).toEqual([1]);
    expect(photos.get(1)).toMatch(/^data:image\/jpeg;base64,/);
    expect(await loadPdfPhotos([])).toEqual(new Map());
  });
});
