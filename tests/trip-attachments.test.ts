import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirstItem, createMany, deleteMany, findFirstAttachment, getTripForUser } = vi.hoisted(() => ({
  findFirstItem: vi.fn(),
  createMany: vi.fn(),
  deleteMany: vi.fn(),
  findFirstAttachment: vi.fn(),
  getTripForUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({
  prisma: {
    tripItineraryItem: { findFirst: findFirstItem },
    tripItemAttachment: { createMany, deleteMany, findFirst: findFirstAttachment },
  },
}));
vi.mock('../lib/upload-limits', () => ({
  getUploadLimitMb: async (key: string) => (key === 'photoMb' ? 1 : 5),
  mbToBytes: (mb: number) => mb * 1024 * 1024,
}));
vi.mock('../lib/trips', () => ({
  getTripForUser,
  canEditTrip: (trip: { status: string; createdById: number; ownerId: number | null }, userId: number) =>
    trip.status !== 'Cancelled' && (trip.createdById === userId || trip.ownerId === userId),
}));

import { resolveAttachmentType } from '../lib/attachment-types';
import {
  addTripItemAttachments,
  deleteTripItemAttachment,
  getTripItemAttachmentFile,
} from '../lib/trip-attachments';

function item(overrides: { status?: string; count?: number; createdById?: number } = {}) {
  return {
    id: 5,
    trip: { status: overrides.status ?? 'Planned', ownerId: null, createdById: overrides.createdById ?? 1 },
    _count: { attachments: overrides.count ?? 0 },
  };
}

const base = { tripId: 2, itemId: 5, userId: 1, isAdmin: false };

describe('resolveAttachmentType', () => {
  it('takes photos and office documents', () => {
    expect(resolveAttachmentType({ name: 'pass.png', type: 'image/png' })).toBe('image/png');
    expect(resolveAttachmentType({ name: 'ticket.pdf', type: 'application/pdf' })).toBe('application/pdf');
    // Browsers often say nothing useful about office files; the extension decides.
    expect(resolveAttachmentType({ name: 'manifest.docx', type: '' })).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(resolveAttachmentType({ name: 'rooms.xlsx', type: 'application/octet-stream' })).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('refuses anything that can run, whatever it is called', () => {
    expect(resolveAttachmentType({ name: 'logo.svg', type: 'image/svg+xml' })).toBeNull();
    expect(resolveAttachmentType({ name: 'page.html', type: 'text/html' })).toBeNull();
    expect(resolveAttachmentType({ name: 'ticket.pdf', type: 'text/html' })).toBeNull();
    expect(resolveAttachmentType({ name: 'setup.exe', type: '' })).toBeNull();
  });
});

describe('addTripItemAttachments', () => {
  beforeEach(() => {
    for (const fn of [findFirstItem, createMany, deleteMany, findFirstAttachment, getTripForUser]) fn.mockReset();
    getTripForUser.mockResolvedValue({ id: 2, reference: 'TR-2026-0002', items: [] });
  });

  it("hides another trip's items entirely", async () => {
    findFirstItem.mockResolvedValue(item({ createdById: 99 }));
    const result = await addTripItemAttachments({ ...base, files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] });
    expect(result).toEqual({ error: 'Item not found', status: 404 });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('refuses changes to a trip that can no longer be edited', async () => {
    findFirstItem.mockResolvedValue(item({ status: 'Cancelled' }));
    const result = await addTripItemAttachments({ ...base, files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] });
    expect(result).toMatchObject({ status: 400 });
  });

  it('caps an event at 20 files', async () => {
    findFirstItem.mockResolvedValue(item({ count: 19 }));
    const files = [new File(['a'], 'a.pdf', { type: 'application/pdf' }), new File(['b'], 'b.pdf', { type: 'application/pdf' })];
    expect(await addTripItemAttachments({ ...base, files })).toMatchObject({ status: 400 });
  });

  it('stores nothing when any file in the batch is unacceptable', async () => {
    findFirstItem.mockResolvedValue(item());
    const files = [
      new File(['%PDF'], 'ok.pdf', { type: 'application/pdf' }),
      new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' }),
    ];
    const result = await addTripItemAttachments({ ...base, files });
    expect(result).toMatchObject({ status: 400, error: expect.stringContaining('bad.svg') });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('holds photos to the photo limit', async () => {
    findFirstItem.mockResolvedValue(item());
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'huge.jpg', { type: 'image/jpeg' });
    expect(await addTripItemAttachments({ ...base, files: [big] })).toMatchObject({
      status: 400,
      error: '"huge.jpg" exceeds the 1 MB limit',
    });
  });

  it('saves photos with a WebP preview and documents without one', async () => {
    findFirstItem.mockResolvedValue(item());
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#0ea5e9' } })
      .png()
      .toBuffer();
    const files = [
      new File([new Uint8Array(png)], 'arrivals.png', { type: 'image/png' }),
      new File(['%PDF-1.4'], 'eticket.pdf', { type: 'application/pdf' }),
    ];

    const result = await addTripItemAttachments({ ...base, files });

    expect(result).toEqual({ id: 2, reference: 'TR-2026-0002', items: [] });
    const rows = createMany.mock.calls[0]![0].data as Array<{ filename: string; mimeType: string; thumbnail: Buffer | null; uploadedById: number }>;
    expect(rows.map((r) => [r.filename, r.mimeType, r.uploadedById])).toEqual([
      ['arrivals.png', 'image/png', 1],
      ['eticket.pdf', 'application/pdf', 1],
    ]);
    const meta = await sharp(rows[0]!.thumbnail!).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width!, meta.height!)).toBe(480);
    expect(rows[1]!.thumbnail).toBeNull();
  });
});

describe('deleteTripItemAttachment / getTripItemAttachmentFile', () => {
  beforeEach(() => {
    for (const fn of [findFirstItem, deleteMany, findFirstAttachment, getTripForUser]) fn.mockReset();
    getTripForUser.mockResolvedValue({ id: 2, items: [] });
  });

  it("only deletes the item's own attachment", async () => {
    findFirstItem.mockResolvedValue(item());
    deleteMany.mockResolvedValue({ count: 0 });
    expect(await deleteTripItemAttachment({ ...base, attachmentId: 77 })).toEqual({
      error: 'Attachment not found',
      status: 404,
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 77, itemId: 5 } });
  });

  it('serves the preview, falling back to the original when there is none', async () => {
    findFirstItem.mockResolvedValue(item());
    findFirstAttachment
      .mockResolvedValueOnce({ filename: 'a.png', thumbnail: null })
      .mockResolvedValueOnce({ filename: 'a.png', mimeType: 'image/png', content: new Uint8Array([1, 2]) });

    const file = await getTripItemAttachmentFile({ ...base, attachmentId: 3, thumbnail: true });
    expect(file).toEqual({ content: new Uint8Array([1, 2]), mime: 'image/png', name: 'a.png' });
  });

  it('serves nothing to someone outside the trip', async () => {
    findFirstItem.mockResolvedValue(item({ createdById: 99 }));
    expect(await getTripItemAttachmentFile({ ...base, attachmentId: 3, thumbnail: false })).toBeNull();
    expect(findFirstAttachment).not.toHaveBeenCalled();
  });
});
