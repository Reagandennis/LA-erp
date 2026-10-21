import 'server-only';

import sharp from 'sharp';

import { MAX_ATTACHMENTS_PER_ITEM, isPreviewableImage, resolveAttachmentType } from './attachment-types';
import { prisma } from './prisma';
import { canEditTrip, getTripForUser, type TripDetail } from './trips';
import { getUploadLimitMb, mbToBytes } from './upload-limits';

type AttachmentError = { error: string; status: number };

async function loadItem(tripId: number, itemId: number, userId: number, isAdmin: boolean) {
  const item = await prisma.tripItineraryItem.findFirst({
    where: { id: itemId, tripId },
    select: {
      id: true,
      trip: { select: { status: true, ownerId: true, createdById: true } },
      _count: { select: { attachments: true } },
    },
  });
  // Someone outside the trip learns nothing, not even that the item exists.
  if (!item || !(isAdmin || item.trip.createdById === userId || item.trip.ownerId === userId)) {
    return null;
  }
  return item;
}

async function makeThumbnail(content: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(content, { failOn: 'none' })
      .rotate()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
  } catch {
    // A preview is a nicety; the original is still served.
    return null;
  }
}

export async function addTripItemAttachments(params: {
  tripId: number;
  itemId: number;
  userId: number;
  isAdmin: boolean;
  files: File[];
}): Promise<TripDetail | AttachmentError> {
  const item = await loadItem(params.tripId, params.itemId, params.userId, params.isAdmin);
  if (!item) return { error: 'Item not found', status: 404 };
  if (!canEditTrip(item.trip, params.userId, params.isAdmin)) {
    return { error: `Cannot edit a trip in status "${item.trip.status}"`, status: 400 };
  }
  if (params.files.length === 0) return { error: 'No files uploaded', status: 400 };
  if (item._count.attachments + params.files.length > MAX_ATTACHMENTS_PER_ITEM) {
    return {
      error: `An event can hold at most ${MAX_ATTACHMENTS_PER_ITEM} photos and documents`,
      status: 400,
    };
  }

  const [photoMb, documentMb] = await Promise.all([
    getUploadLimitMb('photoMb'),
    getUploadLimitMb('documentMb'),
  ]);

  // Check every file before storing any, so a bad one doesn't leave half a batch.
  const accepted: Array<{ file: File; mimeType: string }> = [];
  for (const file of params.files) {
    const mimeType = resolveAttachmentType(file);
    if (!mimeType) {
      return { error: `"${file.name}" isn't a photo or document type we accept`, status: 400 };
    }
    const limitMb = mimeType.startsWith('image/') ? photoMb : documentMb;
    if (file.size > mbToBytes(limitMb)) {
      return { error: `"${file.name}" exceeds the ${limitMb} MB limit`, status: 400 };
    }
    if (file.size === 0) return { error: `"${file.name}" is empty`, status: 400 };
    accepted.push({ file, mimeType });
  }

  const rows = await Promise.all(
    accepted.map(async ({ file, mimeType }) => {
      const content = Buffer.from(await file.arrayBuffer());
      return {
        itemId: params.itemId,
        filename: file.name.slice(0, 255) || 'file',
        mimeType,
        size: file.size,
        content,
        thumbnail: isPreviewableImage(mimeType) ? await makeThumbnail(content) : null,
        uploadedById: params.userId,
      };
    }),
  );
  await prisma.tripItemAttachment.createMany({ data: rows });

  return (await getTripForUser({ id: params.tripId, userId: params.userId, isAdmin: params.isAdmin }))!;
}

export async function deleteTripItemAttachment(params: {
  tripId: number;
  itemId: number;
  attachmentId: number;
  userId: number;
  isAdmin: boolean;
}): Promise<TripDetail | AttachmentError> {
  const item = await loadItem(params.tripId, params.itemId, params.userId, params.isAdmin);
  if (!item) return { error: 'Item not found', status: 404 };
  if (!canEditTrip(item.trip, params.userId, params.isAdmin)) {
    return { error: `Cannot edit a trip in status "${item.trip.status}"`, status: 400 };
  }
  const { count } = await prisma.tripItemAttachment.deleteMany({
    where: { id: params.attachmentId, itemId: params.itemId },
  });
  if (count === 0) return { error: 'Attachment not found', status: 404 };

  return (await getTripForUser({ id: params.tripId, userId: params.userId, isAdmin: params.isAdmin }))!;
}

/** The file itself, or its preview. Null when it isn't there or isn't theirs to see. */
export async function getTripItemAttachmentFile(params: {
  tripId: number;
  itemId: number;
  attachmentId: number;
  userId: number;
  isAdmin: boolean;
  thumbnail: boolean;
}): Promise<{ content: Uint8Array; mime: string; name: string } | null> {
  const item = await loadItem(params.tripId, params.itemId, params.userId, params.isAdmin);
  if (!item) return null;

  const where = { id: params.attachmentId, itemId: params.itemId };
  if (params.thumbnail) {
    const row = await prisma.tripItemAttachment.findFirst({
      where,
      select: { filename: true, thumbnail: true },
    });
    if (!row) return null;
    if (row.thumbnail) {
      return { content: row.thumbnail, mime: 'image/webp', name: `${row.filename}.webp` };
    }
    // No preview was made (e.g. an image sharp couldn't read): fall through to the original.
  }
  const row = await prisma.tripItemAttachment.findFirst({
    where,
    select: { filename: true, mimeType: true, content: true },
  });
  return row ? { content: row.content, mime: row.mimeType, name: row.filename } : null;
}

/**
 * The stored previews as JPEG data URIs for the itinerary PDF, which can't
 * draw WebP. Callers pass ids from a trip they already have access to.
 */
export async function loadPdfPhotos(ids: number[]): Promise<Map<number, string>> {
  const photos = new Map<number, string>();
  if (ids.length === 0) return photos;
  const rows = await prisma.tripItemAttachment.findMany({
    where: { id: { in: ids } },
    select: { id: true, thumbnail: true },
  });
  await Promise.all(
    rows.map(async (row) => {
      if (!row.thumbnail) return;
      try {
        const jpeg = await sharp(row.thumbnail)
          // Sharp enough for a 1.4-inch tile in print, small enough to email.
          .resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 78 })
          .toBuffer();
        photos.set(row.id, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
      } catch {
        // A preview sharp can't read is left out rather than failing the PDF.
      }
    }),
  );
  return photos;
}
