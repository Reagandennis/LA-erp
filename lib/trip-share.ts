import 'server-only';

import { randomBytes } from 'crypto';

import {
  type ClientItinerary,
  type ClientItineraryOptions,
  buildClientItinerary,
  isClientVisible,
} from '@/app/modules/trip-planning/[tripId]/client-itinerary';

import { buildTripItineraryPdf } from './document-pdf';
import { prisma } from './prisma';
import { type TripDetail, getTripDetail } from './trips';

/**
 * A client's read-only link to their trip. It's shared while the trip is
 * Active and stops working once it isn't, so an old link can't keep showing
 * where someone is being driven. The PDF is the copy they keep.
 */
export function isShareable(status: string): boolean {
  return status === 'Active';
}

export interface TripShareLinkDto {
  /** "/share/trip/<token>"; the page adds its own origin. */
  path: string;
  includeCrew: boolean;
  includeAttachments: boolean;
  createdAt: string;
  createdBy: { id: number; name: string } | null;
  viewCount: number;
  lastViewedAt: string | null;
}

/** 32 URL-safe characters: 192 random bits, not guessable. */
function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Rules out junk before it reaches the database. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function sharePath(token: string): string {
  return `/share/trip/${token}`;
}

const linkSelect = {
  token: true,
  includeCrew: true,
  includeAttachments: true,
  createdAt: true,
  viewCount: true,
  lastViewedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

function serialize(row: {
  token: string;
  includeCrew: boolean;
  includeAttachments: boolean;
  createdAt: Date;
  viewCount: number;
  lastViewedAt: Date | null;
  createdBy: { id: number; name: string } | null;
}): TripShareLinkDto {
  return {
    path: sharePath(row.token),
    includeCrew: row.includeCrew,
    includeAttachments: row.includeAttachments,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
  };
}

export async function getShareLink(tripId: number): Promise<TripShareLinkDto | null> {
  const row = await prisma.tripShareLink.findUnique({ where: { tripId }, select: linkSelect });
  return row ? serialize(row) : null;
}

/**
 * Creates the trip's link, or changes what it shows. `regenerate` swaps in a
 * new token, so whoever had the old link loses it.
 */
export async function saveShareLink(params: {
  tripId: number;
  userId: number;
  includeCrew: boolean;
  includeAttachments: boolean;
  regenerate?: boolean;
}): Promise<{ link: TripShareLinkDto; action: 'created' | 'regenerated' | 'updated' }> {
  const shows = { includeCrew: params.includeCrew, includeAttachments: params.includeAttachments };
  const existing = await prisma.tripShareLink.findUnique({ where: { tripId: params.tripId }, select: { id: true } });
  if (!existing) {
    const row = await prisma.tripShareLink.create({
      data: { tripId: params.tripId, token: newToken(), ...shows, createdById: params.userId },
      select: linkSelect,
    });
    return { link: serialize(row), action: 'created' };
  }
  const row = await prisma.tripShareLink.update({
    where: { tripId: params.tripId },
    data: params.regenerate
      ? {
          token: newToken(),
          ...shows,
          createdById: params.userId,
          createdAt: new Date(),
          viewCount: 0,
          lastViewedAt: null,
        }
      : shows,
    select: linkSelect,
  });
  return { link: serialize(row), action: params.regenerate ? 'regenerated' : 'updated' };
}

export async function revokeShareLink(tripId: number): Promise<boolean> {
  const { count } = await prisma.tripShareLink.deleteMany({ where: { tripId } });
  return count > 0;
}

/** Only the client's view leaves here: never the trip itself, which carries costs. */
export type SharedTrip =
  | { state: 'open'; linkId: number; itinerary: ClientItinerary; brandProfileId: number | null }
  /** The link is real but the trip is no longer running. */
  | { state: 'ended'; title: string };

/** What a share link shows, or null for a token that isn't (or is no longer) a link. */
export async function openSharedTrip(token: string, options: { recordView?: boolean } = {}): Promise<SharedTrip | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const link = await prisma.tripShareLink.findUnique({
    where: { token },
    select: { id: true, tripId: true, includeCrew: true, includeAttachments: true },
  });
  if (!link) return null;

  const trip = await getTripDetail(link.tripId);
  if (!trip) return null;
  if (!isShareable(trip.status)) return { state: 'ended', title: trip.title };

  if (options.recordView) {
    await prisma.tripShareLink.update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
  }
  return {
    state: 'open',
    linkId: link.id,
    itinerary: buildClientItinerary(trip, {
      includeCrew: link.includeCrew,
      includeAttachments: link.includeAttachments,
    }),
    brandProfileId: await tripBrandProfileId(trip),
  };
}

/** A trip goes out under the brand of the quote it was built from. */
export async function tripBrandProfileId(trip: Pick<TripDetail, 'sourceQuote'>): Promise<number | null> {
  if (!trip.sourceQuote) return null;
  const quote = await prisma.quote.findUnique({ where: { id: trip.sourceQuote.id }, select: { brandProfileId: true } });
  return quote?.brandProfileId ?? null;
}

/** With attachments, the PDF shows the photos; documents stay on the live link. */
export async function tripItineraryPdf(trip: TripDetail, options: ClientItineraryOptions): Promise<Buffer> {
  return buildTripItineraryPdf(buildClientItinerary(trip, options), await tripBrandProfileId(trip));
}

/**
 * A photo or document behind a share link, or its preview. Null unless the
 * link is live, shares attachments, and the file is on a stop the client sees.
 * Deliberately lighter than openSharedTrip: a page of photos asks once per image.
 */
export async function getSharedAttachment(params: {
  token: string;
  attachmentId: number;
  thumbnail: boolean;
}): Promise<{ content: Uint8Array; mime: string; name: string } | null> {
  if (!TOKEN_PATTERN.test(params.token)) return null;
  const link = await prisma.tripShareLink.findUnique({
    where: { token: params.token },
    select: { tripId: true, includeAttachments: true, trip: { select: { status: true } } },
  });
  if (!link || !link.includeAttachments || !isShareable(link.trip.status)) return null;

  const meta = await prisma.tripItemAttachment.findFirst({
    where: { id: params.attachmentId, item: { tripId: link.tripId } },
    select: { filename: true, mimeType: true, item: { select: { category: true, timeLabel: true } } },
  });
  if (!meta || !isClientVisible(meta.item)) return null;

  const where = { id: params.attachmentId };
  if (params.thumbnail) {
    const preview = await prisma.tripItemAttachment.findUnique({ where, select: { thumbnail: true } });
    if (preview?.thumbnail) return { content: preview.thumbnail, mime: 'image/webp', name: `${meta.filename}.webp` };
    // No preview was made (an image sharp couldn't read): the original, as the planner's view does.
  }
  const file = await prisma.tripItemAttachment.findUnique({ where, select: { content: true } });
  return file ? { content: file.content, mime: meta.mimeType, name: meta.filename } : null;
}

/** "TR-2026-0042-itinerary.pdf" */
export function itineraryFilename(reference: string): string {
  return `${reference.replace(/[^A-Za-z0-9_-]/g, '-')}-itinerary.pdf`;
}
