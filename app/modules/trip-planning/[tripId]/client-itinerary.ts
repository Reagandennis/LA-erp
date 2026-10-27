/**
 * What a client sees of their trip. One shape feeds the share page, the PDF
 * and the email, so they can't disagree about what leaves the building.
 *
 * Always left out: costs, the operations log, the trip's own notes, and empty
 * runs (our vehicles moving without the client). Crew names and phones,
 * vehicles and item notes only go out when the planner includes them: notes
 * often name passengers and security staff. Photos and documents go out unless
 * the planner leaves them off.
 *
 * Pure: the public page and the server-side PDF both import it.
 */
import { APP_LOCALE } from '@/lib/locale';
import { isValidTimeZone } from '@/lib/zoned-time';

import type { TripDetail, TripItineraryItemSummary } from '../types';
import { type TripItemCategory, categoryMeta, isTripItemCategory } from './categories';
import { isEmptyRun } from './empty-run';
import { dayLabel, groupItemsByDay } from './itinerary-model';

export interface ClientItineraryAttachment {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  /** Has a preview image (see lib/trip-attachments). */
  isImage: boolean;
}

export interface ClientItineraryItem {
  id: number;
  category: TripItemCategory;
  categoryLabel: string;
  /** "7:00 AM – 8:30 AM · Pick-up", or "" when untimed: `time` and `timeLabel` together. */
  when: string;
  /** "7:00 AM – 8:30 AM", or "". */
  time: string;
  /** "Pick-up", or "". */
  timeLabel: string;
  /** ISO; lets a live page point at what's next. */
  startsAt: string | null;
  title: string;
  subtitle: string | null;
  /** Who it's for, lead first; empty when it's the whole party. */
  travelers: string[];
  place: string | null;
  address: string | null;
  phone: string | null;
  /** http(s) only. */
  bookingUrl: string | null;
  provider: { label: string; name: string } | null;
  /** `key` is the category field's, so a page can lay out e.g. a flight's airports. */
  details: Array<{ key: string; label: string; value: string }>;
  confirmationCode: string | null;
  notes: string | null;
  crew: Array<{ role: string; name: string; phone: string | null }>;
  vehicle: string | null;
  attachments: ClientItineraryAttachment[];
  done: boolean;
}

export interface ClientItineraryDay {
  id: number;
  dayNumber: number;
  title: string | null;
  /** "Day 2 · Safari" */
  heading: string;
  /** "Tuesday, May 13", or "" while the trip has no dates. */
  date: string;
  /** "YYYY-MM-DD", or null while the trip has no dates. */
  dateKey: string | null;
  summary: string | null;
  items: ClientItineraryItem[];
}

export interface ClientItinerary {
  reference: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  customer: { name: string; company: string | null };
  /** Lead first. */
  travelers: string[];
  days: ClientItineraryDay[];
  /** On no day yet. */
  unscheduled: ClientItineraryItem[];
  includeCrew: boolean;
  includeAttachments: boolean;
}

export interface ClientItineraryOptions {
  includeCrew: boolean;
  includeAttachments: boolean;
}

/** Whether a client sees this item at all. The share link's file route asks the same question. */
export function isClientVisible(item: { category: string; timeLabel: string | null }): boolean {
  return !isEmptyRun(item);
}

/** Fields that are ours, not the client's, and only go out with the crew. */
const CREW_DETAIL_KEYS = new Set(['driverName', 'driverPhone', 'vehicle']);

/** "PICK-UP" → "Pick-up". */
function sentenceCase(label: string): string {
  const lower = label.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function clock(iso: string, timeZone: string | undefined): string {
  return new Date(iso).toLocaleTimeString(APP_LOCALE, { hour: 'numeric', minute: '2-digit', timeZone });
}

function zoneName(iso: string, timeZone: string): string {
  return (
    new Intl.DateTimeFormat(APP_LOCALE, { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date(iso))
      .find((part) => part.type === 'timeZoneName')?.value ?? ''
  );
}

/** A flight's times are local to its airport (as on the flight card); everything else is our local time. */
function timeParts(item: TripItineraryItemSummary): { time: string; timeLabel: string } {
  const timeLabel = item.timeLabel ? sentenceCase(item.timeLabel) : '';
  if (!item.scheduledAt) return { time: '', timeLabel };
  const zone = item.details?.timezone;
  const timeZone = item.category === 'flight' && zone && isValidTimeZone(zone) ? zone : undefined;
  const start = clock(item.scheduledAt, timeZone);
  let time = item.endsAt ? `${start} – ${clock(item.endsAt, timeZone)}` : start;
  if (timeZone) time = `${time} ${zoneName(item.scheduledAt, timeZone)}`;
  return { time, timeLabel };
}

function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

function hiddenDetail(key: string, item: TripItineraryItemSummary, includeCrew: boolean): boolean {
  // Already part of `when`.
  if (key === 'timezone') return true;
  // Ours alone, like the service code (the catalog's internal SKU).
  if (categoryMeta(item.category).fields.some((field) => field.key === key && field.internal)) return true;
  if (!CREW_DETAIL_KEYS.has(key)) return false;
  // Once linked, the crew register's driver and vehicle replace the typed-in ones.
  return !includeCrew || Boolean(key === 'vehicle' ? item.vehicle : item.driver);
}

function clientItem(item: TripItineraryItemSummary, options: ClientItineraryOptions): ClientItineraryItem {
  const { includeCrew } = options;
  const { time, timeLabel } = timeParts(item);
  const meta = categoryMeta(item.category);
  const details = item.details ?? {};
  const crew: ClientItineraryItem['crew'] = [];
  if (includeCrew && item.driver) crew.push({ role: 'Driver', name: item.driver.name, phone: item.driver.phone });
  if (includeCrew && item.officer) {
    const name = item.officer.callSign ? `${item.officer.name} (${item.officer.callSign})` : item.officer.name;
    crew.push({ role: 'Close Protection Officer', name, phone: item.officer.phone });
  }
  const vehicle =
    includeCrew && item.vehicle
      ? [item.vehicle.make, item.vehicle.model, item.vehicle.registration].filter(Boolean).join(' ')
      : null;

  return {
    id: item.id,
    category: isTripItemCategory(item.category) ? item.category : 'activity',
    categoryLabel: meta.label,
    when: [time, timeLabel].filter(Boolean).join(' · '),
    time,
    timeLabel,
    startsAt: item.scheduledAt,
    title: item.description,
    subtitle: item.subtitle,
    travelers: item.travelers.map((traveler) => traveler.name),
    place: item.placeName,
    address: item.address && item.address !== item.placeName ? item.address : null,
    phone: item.phone,
    bookingUrl: safeUrl(item.bookingUrl),
    provider: meta.providerLabel && item.providerName ? { label: meta.providerLabel, name: item.providerName } : null,
    details: meta.fields
      .filter((field) => !hiddenDetail(field.key, item, includeCrew))
      .map((field) => ({ key: field.key, label: field.label, value: details[field.key] }))
      .filter((detail): detail is { key: string; label: string; value: string } => Boolean(detail.value)),
    confirmationCode: item.confirmationCode,
    // An information item's text is the information itself.
    notes: includeCrew || item.category === 'information' ? item.body : null,
    crew,
    vehicle,
    attachments: options.includeAttachments
      ? item.attachments.map((file) => ({
          id: file.id,
          filename: file.filename,
          mimeType: file.mimeType,
          size: file.size,
          isImage: file.thumbnailUrl !== null,
        }))
      : [],
    done: item.completedAt !== null,
  };
}

export function buildClientItinerary(trip: TripDetail, options: ClientItineraryOptions): ClientItinerary {
  const forClient = (items: TripItineraryItemSummary[]) =>
    items.filter(isClientVisible).map((item) => clientItem(item, options));
  const { groups, unscheduled } = groupItemsByDay(trip.days, trip.items);

  const days = groups
    .map(({ day, items }) => {
      const label = dayLabel(day);
      return {
        id: day.id,
        dayNumber: day.dayNumber,
        title: day.title,
        heading: day.title ? `Day ${day.dayNumber} · ${day.title}` : `Day ${day.dayNumber}`,
        date: label.weekday ? `${label.weekday}, ${label.short}` : '',
        dateKey: day.dateKey,
        summary: day.summary,
        items: forClient(items),
      };
    })
    .filter((day) => day.items.length > 0 || day.summary);

  return {
    reference: trip.reference,
    title: trip.title,
    status: trip.status,
    startDate: trip.startDate,
    endDate: trip.endDate,
    customer: { name: trip.customer.name, company: trip.customer.company },
    travelers: trip.travelers.map((traveler) => traveler.name),
    days,
    unscheduled: forClient(unscheduled),
    includeCrew: options.includeCrew,
    includeAttachments: options.includeAttachments,
  };
}
