'use client';

import { APP_LOCALE } from '@/lib/locale';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  REMINDER_OPTIONS,
  type CrewOptions,
  type TravelerOption,
  type TripDaySummary,
  type TripFormOptions,
  type TripDetail,
  type TripItemType,
  type TripItineraryItemSummary,
  type TripStatus,
} from '../types';
import { SILENT_BANNER_HEADER } from '@/app/ui/banner';
import TripBuilder from '../trip-builder';
import { formatDuration } from '@/lib/flight-status';
import { isValidTimeZone, localTimeZone, utcToZoned, zonedToUtcIso } from '@/lib/zoned-time';

import {
  applyReorder,
  dayHeading,
  dayLabel,
  dayTypeChips,
  groupItemsByDay,
  reorderPayload,
} from './itinerary-model';
import { AttachmentPicker } from './_components/attachment-picker';
import { AttachmentStrip } from './_components/attachment-strip';
import { CrewRow } from './_components/crew-row';
import { EventTravelerFields, TravelerRow, type TravelerChoices } from './_components/event-travelers';
import { ShareDialog } from './_components/share-dialog';
import FlightCard from './_components/flight-card';
import FlightFields from './_components/flight-fields';
import TransportFields from './_components/transport-fields';
import type { EditorState } from './editor-state';
import { EMPTY_RUN, emptyRunFor, emptyRunTitle, isEmptyRun } from './empty-run';
import TripLogPanel from './trip-log-panel';
import { useItineraryDrag, type DragTarget } from './_components/use-itinerary-drag';
import {
  CATEGORY_ICON_PATHS,
  CATEGORY_META,
  TRIP_ITEM_CATEGORIES,
  categoryMeta,
  isTripItemCategory,
  mapLegacyItemType,
  pruneDetails,
  type TripItemCategory,
} from './categories';

interface ItineraryPageClientProps {
  trip: TripDetail;
  /** Task Assignment's drivers, CPOs and vehicles, for event crews. */
  crewOptions: CrewOptions;
  /** The client's travellers, for adding someone to an event who isn't on the trip yet. */
  clientTravelers: TravelerOption[];
  currentUser: { id: number; name: string; email: string };
  isAdmin: boolean;
}

interface ItemPayload {
  itemType: TripItemType;
  category: TripItemCategory;
  body: string | null;
  timeLabel: string | null;
  providerName: string | null;
  bookingUrl: string | null;
  phone: string | null;
  placeName: string | null;
  address: string | null;
  details: Record<string, string> | null;
  description: string;
  subtitle: string | null;
  scheduledAt: string | null;
  endsAt: string | null;
  durationMinutes: number | null;
  reminderMinutesBefore: number | null;
  imageUrl: string | null;
  confirmationCode: string | null;
  quantity: number;
  /** The trip day it sits on; null is the unscheduled tray. */
  dayId: number | null;
  driverId: number | null;
  officerId: number | null;
  vehicleId: number | null;
  /** Who it's for; empty is the whole party. Replaces the event's travellers on save. */
  travelers: Array<{ travelerId: number } | { name: string }>;
  /** Left out entirely for people who can't see costs, so a save never clears one. */
  unitPrice?: number | null;
}

const ALL_STATUSES: TripStatus[] = ['Draft', 'Planned', 'Active', 'Completed', 'Cancelled'];

const STATUS_PILL: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Planned: 'bg-blue-50 text-blue-700',
  Active: 'bg-emerald-50 text-emerald-700',
  Completed: 'bg-violet-50 text-violet-700',
  Cancelled: 'bg-rose-50 text-rose-700',
};

// Booked-style item types render as compact rows with a leading colored icon chip.
// Location/activity types render as numbered stop cards.
/** Booked things read better as compact rows; the rest get a fuller card. */
const ROW_STYLE_CATEGORIES = new Set<string>([
  'flight',
  'transportation',
  'lodging',
  'booking',
]);

/** Small coloured dots summarising what a day contains, shown in the rail. */
function DayTypeChip({ category }: { category: string }) {
  const meta = categoryMeta(category);
  return (
    <span aria-hidden title={meta.label} className={`h-2 w-2 rounded-full ${meta.dot}`} />
  );
}

function dateInputValue(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function timeInputValue(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function combineDateTime(date: string, time: string | null): string | null {
  if (!date) return null;
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : '09:00';
  const d = new Date(`${date}T${t}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatRangeBadge(start: string | null, end: string | null): string {
  if (!start || !end) return 'No dates set';
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 'No dates set';
  const fmt = (d: Date) => d.toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function formatTimeRange(scheduledAt: string | null, endsAt: string | null): string {
  if (!scheduledAt) return '';
  const s = new Date(scheduledAt);
  const t = (d: Date) => d.toLocaleTimeString(APP_LOCALE, { hour: 'numeric', minute: '2-digit' });
  if (!endsAt) return t(s);
  const e = new Date(endsAt);
  return `${t(s)} – ${t(e)}`;
}

/** "7:00 ARRIVAL" — the time plus whatever the event calls that moment. */
function bookedLabel(item: TripItineraryItemSummary): string {
  const time = formatTimeRange(item.scheduledAt, item.endsAt);
  if (!item.timeLabel) return time;
  return time ? `${time} ${item.timeLabel}` : item.timeLabel;
}

/** The legacy column still has to be written; derive it from the category. */
const LEGACY_TYPE: Record<TripItemCategory, TripItemType> = {
  flight: 'flight',
  transportation: 'car',
  lodging: 'hotel',
  tour: 'activity',
  booking: 'activity',
  activity: 'activity',
  information: 'location',
};

function blankEditor(
  prefillDate: string | null,
  category: TripItemCategory = 'activity',
  dayId: number | null = null,
): EditorState {
  return {
    category,
    description: '',
    subtitle: '',
    body: '',
    timeLabel: CATEGORY_META[category].timeLabels[0] ?? '',
    providerName: '',
    phone: '',
    bookingUrl: '',
    placeName: '',
    address: '',
    date: prefillDate ?? '',
    time: prefillDate ? '09:00' : '',
    endTime: '',
    reminderMinutesBefore: '',
    imageUrl: '',
    confirmationCode: '',
    unitPrice: '',
    details: {},
    dayId,
    timezone: localTimeZone(),
    durationHours: '',
    durationMinutes: '',
    attachments: [],
    removedAttachmentIds: [],
    newFiles: [],
    driverId: null,
    officerId: null,
    vehicleId: null,
    travelers: [],
  };
}

function editorFromItem(item: TripItineraryItemSummary): EditorState {
  const category = (item.category as TripItemCategory) ?? mapLegacyItemType(item.itemType);
  const isFlight = category === 'flight';
  // A flight's time reads in its airport's zone; everything else in the viewer's.
  const savedZone = item.details?.timezone;
  const timezone = isFlight && savedZone && isValidTimeZone(savedZone) ? savedZone : localTimeZone();
  const zoned = isFlight ? utcToZoned(item.scheduledAt, timezone) : null;
  return {
    category,
    description: item.description,
    subtitle: item.subtitle ?? '',
    body: item.body ?? '',
    timeLabel: isFlight
      ? item.timeLabel === 'ARRIVAL'
        ? 'ARRIVAL'
        : 'DEPARTURE'
      : category === 'transportation'
        ? item.timeLabel === 'DROP-OFF' || item.timeLabel === EMPTY_RUN
          ? item.timeLabel
          : 'PICK-UP'
        : (item.timeLabel ?? ''),
    providerName: item.providerName ?? '',
    phone: item.phone ?? '',
    bookingUrl: item.bookingUrl ?? '',
    placeName: item.placeName ?? '',
    address: item.address ?? '',
    date: zoned ? zoned.date : dateInputValue(item.scheduledAt),
    time: zoned ? zoned.time : timeInputValue(item.scheduledAt),
    endTime: timeInputValue(item.endsAt),
    reminderMinutesBefore:
      item.reminderMinutesBefore != null ? String(item.reminderMinutesBefore) : '',
    imageUrl: item.imageUrl ?? '',
    confirmationCode: item.confirmationCode ?? '',
    unitPrice: item.unitPrice != null ? String(item.unitPrice) : '',
    details: item.details ?? {},
    dayId: item.dayId,
    timezone,
    durationHours: item.durationMinutes ? String(Math.floor(item.durationMinutes / 60)) : '',
    durationMinutes: item.durationMinutes ? String(item.durationMinutes % 60) : '',
    attachments: item.attachments,
    removedAttachmentIds: [],
    newFiles: [],
    driverId: item.driver?.id ?? null,
    officerId: item.officer?.id ?? null,
    vehicleId: item.vehicle?.id ?? null,
    travelers: item.travelers.map((t) => ({ travelerId: t.id, name: t.name })),
  };
}

/**
 * Flights and transport carry a crew: a driver and a vehicle are required, a
 * CPO isn't. An imported event that names them only as text may stay as it is.
 */
function crewPayload(
  editor: EditorState,
): { driverId: number | null; officerId: number | null; vehicleId: number | null } | { error: string } {
  if (editor.category !== 'flight' && editor.category !== 'transportation') {
    return { driverId: null, officerId: null, vehicleId: null };
  }
  if (!editor.driverId && !editor.details.driverName) return { error: 'Pick a driver' };
  if (!editor.vehicleId && !editor.details.vehicle) return { error: 'Pick a vehicle' };
  return { driverId: editor.driverId, officerId: editor.officerId, vehicleId: editor.vehicleId };
}

/** An empty run carries no one, whatever was ticked before it became one. */
function travelersPayload(editor: EditorState): ItemPayload['travelers'] {
  if (isEmptyRunEditor(editor)) return [];
  return editor.travelers.map((t) => (t.travelerId ? { travelerId: t.travelerId } : { name: t.name }));
}

function isEmptyRunEditor(editor: EditorState): boolean {
  return editor.category === 'transportation' && editor.timeLabel === EMPTY_RUN;
}

/** Hours and minutes as typed → minutes; null for none. */
function parseDuration(editor: EditorState): number | null | { error: string } {
  const hours = editor.durationHours.trim() === '' ? 0 : Number(editor.durationHours);
  const minutes = editor.durationMinutes.trim() === '' ? 0 : Number(editor.durationMinutes);
  if (![hours, minutes].every(Number.isInteger) || hours < 0 || hours > 30 || minutes < 0 || minutes > 59) {
    return { error: 'Duration is whole hours (up to 30) and minutes (0–59)' };
  }
  return hours * 60 + minutes || null;
}

/**
 * A flight's date and time are local to the airport it's at, in the zone
 * picked beside them. The time is the departure or the arrival, per the
 * direction; the duration gives the other end.
 */
function flightToPayload(editor: EditorState, includeCost: boolean): ItemPayload | { error: string } {
  const arrival = editor.timeLabel === 'ARRIVAL';
  if (editor.date && !editor.time) return { error: arrival ? 'Add the arrival time' : 'Add the departure time' };
  const scheduledAt = editor.date ? zonedToUtcIso(editor.date, editor.time, editor.timezone) : null;
  if (editor.date && !scheduledAt) return { error: 'Pick a valid date, time and timezone' };

  const durationMinutes = parseDuration(editor);
  if (durationMinutes !== null && typeof durationMinutes === 'object') return durationMinutes;

  const reminderMinutesBefore = editor.reminderMinutesBefore ? Number(editor.reminderMinutesBefore) : null;
  if (scheduledAt == null && reminderMinutesBefore != null) return { error: 'Reminders need a scheduled time' };
  const price = includeCost ? editor.unitPrice.trim() : '';
  if (price && !Number.isFinite(Number(price))) return { error: 'Cost must be a number' };

  const crew = crewPayload(editor);
  if ('error' in crew) return crew;

  const flightNumber = editor.details.flightNumber?.trim();
  return {
    ...crew,
    travelers: travelersPayload(editor),
    itemType: 'flight',
    category: 'flight',
    description:
      editor.description.trim() || `${arrival ? 'Arrival' : 'Departure'}${flightNumber ? ` · ${flightNumber}` : ''}`,
    subtitle: editor.subtitle.trim() || null,
    body: editor.body.trim() || null,
    timeLabel: arrival ? 'ARRIVAL' : 'DEPARTURE',
    providerName: editor.providerName.trim() || null,
    bookingUrl: editor.bookingUrl.trim() || null,
    phone: editor.phone.trim() || null,
    placeName: editor.placeName.trim() || null,
    address: editor.address.trim() || null,
    details: pruneDetails('flight', { ...editor.details, timezone: editor.timezone }),
    scheduledAt,
    // A departure ends when it lands; an arrival's moment is the landing itself.
    endsAt:
      !arrival && scheduledAt && durationMinutes
        ? new Date(new Date(scheduledAt).getTime() + durationMinutes * 60_000).toISOString()
        : null,
    durationMinutes,
    reminderMinutesBefore,
    imageUrl: editor.imageUrl.trim() || null,
    confirmationCode: editor.confirmationCode.trim() || null,
    quantity: 1,
    dayId: editor.dayId,
    ...(includeCost ? { unitPrice: price ? Number(price) : null } : {}),
  };
}

function editorToPayload(editor: EditorState, includeCost: boolean): ItemPayload | { error: string } {
  if (editor.category === 'flight') return flightToPayload(editor, includeCost);
  const transport = editor.category === 'transportation';
  const emptyRun = isEmptyRunEditor(editor);
  const dropOff = editor.timeLabel === 'DROP-OFF';
  const place = (dropOff ? editor.details.dropoffLocation : editor.details.pickupLocation)?.trim();
  const description =
    editor.description.trim() ||
    (emptyRun
      ? emptyRunTitle(editor.details.pickupLocation ?? '', editor.details.dropoffLocation ?? '')
      : transport
        ? `${dropOff ? 'Drop-off' : 'Pick-up'}${place ? ` · ${place}` : ''}`
        : '');
  if (!description) return { error: 'Give it a name' };
  const crew = crewPayload(editor);
  if ('error' in crew) return crew;
  const scheduledAt = editor.date ? combineDateTime(editor.date, editor.time || null) : null;

  // An empty run is timed by when it leaves and how long the drive is.
  const durationMinutes = emptyRun ? parseDuration(editor) : null;
  if (durationMinutes !== null && typeof durationMinutes === 'object') return durationMinutes;
  const endsAt = emptyRun
    ? scheduledAt && durationMinutes
      ? new Date(new Date(scheduledAt).getTime() + durationMinutes * 60_000).toISOString()
      : null
    : editor.date && editor.endTime
      ? combineDateTime(editor.date, editor.endTime)
      : null;
  if (endsAt && scheduledAt && new Date(endsAt) < new Date(scheduledAt)) {
    return { error: 'End time must be after start time' };
  }
  const reminderMinutesBefore = editor.reminderMinutesBefore ? Number(editor.reminderMinutesBefore) : null;
  if (scheduledAt == null && reminderMinutesBefore != null) {
    return { error: 'Reminders need a scheduled time' };
  }
  const price = includeCost ? editor.unitPrice.trim() : '';
  if (price && !Number.isFinite(Number(price))) {
    return { error: 'Cost must be a number' };
  }

  return {
    itemType: LEGACY_TYPE[editor.category],
    category: editor.category,
    description,
    subtitle: editor.subtitle.trim() || null,
    body: editor.body.trim() || null,
    timeLabel: editor.timeLabel.trim() || null,
    providerName: editor.providerName.trim() || null,
    bookingUrl: editor.bookingUrl.trim() || null,
    phone: editor.phone.trim() || null,
    placeName: editor.placeName.trim() || null,
    address: editor.address.trim() || null,
    // Drop anything the category doesn't declare, so switching category can't
    // smuggle a stale flight number onto a hotel.
    details: pruneDetails(editor.category, editor.details),
    scheduledAt,
    endsAt,
    durationMinutes,
    reminderMinutesBefore,
    imageUrl: editor.imageUrl.trim() || null,
    confirmationCode: editor.confirmationCode.trim() || null,
    quantity: 1,
    dayId: editor.dayId,
    ...crew,
    travelers: travelersPayload(editor),
    ...(includeCost ? { unitPrice: price ? Number(price) : null } : {}),
  };
}

/**
 * The Trips list is served from the client router cache for a while after a
 * visit (experimental.staleTimes in next.config.ts), so a status change or
 * edit made here would still show the old row there. Once the trip has
 * changed, leaving this page (the Back link or the browser's back button)
 * refreshes the router so the list is fetched again.
 */
function useRefreshListAfterEdits(trip: TripDetail, initialTrip: TripDetail) {
  const router = useRouter();
  const changed = useRef(false);
  useEffect(() => {
    if (trip !== initialTrip) changed.current = true;
  }, [trip, initialTrip]);
  useEffect(
    () => () => {
      if (changed.current) router.refresh();
    },
    [router],
  );
}

export default function ItineraryPageClient({
  trip: initialTrip,
  crewOptions,
  clientTravelers: initialClientTravelers,
  currentUser,
  isAdmin,
}: ItineraryPageClientProps) {
  const [trip, setTrip] = useState<TripDetail>(initialTrip);
  useRefreshListAfterEdits(trip, initialTrip);
  // Follows the trip's client, which the edit form can change.
  const [clientTravelers, setClientTravelers] = useState(initialClientTravelers);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which day the right-hand pane is showing. `null` = the Unscheduled tray. */
  const [activeDayId, setActiveDayId] = useState<number | null>(
    initialTrip.days[0]?.id ?? null,
  );
  // `null` means the unscheduled bucket; a day id that no longer exists (the
  // day was deleted) falls back to the first day.
  const currentDayId =
    activeDayId === null || trip.days.some((day) => day.id === activeDayId)
      ? activeDayId
      : (trip.days[0]?.id ?? null);
  /** The right-hand pane shows the trip log instead of a day. */
  const [showLog, setShowLog] = useState(false);
  const [logCount, setLogCount] = useState(initialTrip.logCount);
  const [addingHere, setAddingHere] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState>(blankEditor(null));
  const [dayMenuOpen, setDayMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  /** The trip form is open once its options have loaded. */
  const [editOptions, setEditOptions] = useState<TripFormOptions | null>(null);

  const isCreator = trip.createdBy.id === currentUser.id;
  const isOwner = trip.owner?.id === currentUser.id;
  const canEdit =
    isAdmin ||
    (trip.status !== 'Cancelled' && (trip.status !== 'Completed' ? isCreator || isOwner : isOwner));

  // Days are rows now, so membership comes from `dayId` rather than from
  // re-deriving a date out of each item's timestamp.
  const { groups, unscheduled } = useMemo(
    () => groupItemsByDay(trip.days, trip.items),
    [trip.days, trip.items],
  );

  const travelerChoices: TravelerChoices = {
    onTrip: trip.travelers,
    client: clientTravelers,
    clientName: trip.customer.name,
  };

  const activeGroup = groups.find((group) => group.day.id === currentDayId) ?? null;
  const activeItems = activeGroup ? activeGroup.items : unscheduled;

  const applyTrip = (next: TripDetail) => setTrip(next);

  // ── Items ───────────────────────────────────────────────────────────────

  const startAdd = (category: TripItemCategory = 'activity') => {
    setError(null);
    setEditingItemId(null);
    setEditor(blankEditor(activeGroup?.day.dateKey ?? null, category, currentDayId));
    setAddingHere(true);
  };

  /** The add form, filled in for the empty run that goes with this pick-up or drop-off. */
  const startEmptyRun = (item: TripItineraryItemSummary) => {
    const draft = emptyRunFor(item);
    const date = dateInputValue(draft.startsAt);
    // Leaving an hour before an early pick-up can fall on the day before.
    const dayId = trip.days.find((day) => day.dateKey === date)?.id ?? item.dayId;
    setError(null);
    setEditingItemId(null);
    setEditor({
      ...blankEditor(null, 'transportation', dayId),
      timeLabel: EMPTY_RUN,
      date,
      time: timeInputValue(draft.startsAt),
      durationHours: String(Math.floor(draft.durationMinutes / 60)),
      durationMinutes: String(draft.durationMinutes % 60),
      details: { pickupLocation: draft.from, dropoffLocation: draft.to },
      driverId: item.driver?.id ?? null,
      vehicleId: item.vehicle?.id ?? null,
    });
    if (dayId !== currentDayId) setActiveDayId(dayId);
    setShowLog(false);
    setAddingHere(true);
  };

  /**
   * After the event itself has saved: drop the files marked for removal, then
   * upload the new ones. Returns the freshest trip, and what went wrong if anything.
   */
  const syncAttachments = async (
    itemId: number,
    state: EditorState,
  ): Promise<{ trip: TripDetail | null; error: string | null }> => {
    let latest: TripDetail | null = null;
    for (const attachmentId of state.removedAttachmentIds) {
      const r = await fetch(`/api/trips/${trip.id}/items/${itemId}/attachments/${attachmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) return { trip: latest, error: data?.error ?? 'Could not remove a file' };
      latest = data.trip;
    }
    if (state.newFiles.length > 0) {
      const form = new FormData();
      for (const file of state.newFiles) form.append('files', file);
      const r = await fetch(`/api/trips/${trip.id}/items/${itemId}/attachments`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) return { trip: latest, error: data?.error ?? 'Could not upload the files' };
      latest = data.trip;
    }
    return { trip: latest, error: null };
  };

  /** The event saved but its files didn't: stay in its editor with the files still queued. */
  const keepEditingAfterFileError = (saved: TripDetail, itemId: number, state: EditorState, message: string) => {
    const item = saved.items.find((candidate) => candidate.id === itemId);
    setAddingHere(false);
    setEditingItemId(item ? itemId : null);
    if (item) setEditor({ ...editorFromItem(item), newFiles: state.newFiles });
    setError(`Saved, but the files weren't: ${message}`);
  };

  const cancelAddOrEdit = () => {
    setAddingHere(false);
    setEditingItemId(null);
    setEditor(blankEditor(null));
    setError(null);
  };

  const submitAdd = async () => {
    const payload = editorToPayload(editor, !trip.costsHidden);
    if ('error' in payload) {
      setError(payload.error);
      return;
    }
    setError(null);
    setPending('add');
    try {
      const r = await fetch(`/api/trips/${trip.id}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [payload] }),
      });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not add item');
        return;
      }
      const before = new Set(trip.items.map((item) => item.id));
      const created = data.trip.items.find((item) => !before.has(item.id));
      if (created && editor.newFiles.length > 0) {
        const synced = await syncAttachments(created.id, editor);
        const latest = synced.trip ?? data.trip;
        applyTrip(latest);
        if (synced.error) {
          keepEditingAfterFileError(latest, created.id, editor, synced.error);
          return;
        }
      } else {
        applyTrip(data.trip);
      }
      cancelAddOrEdit();
    } finally {
      setPending(null);
    }
  };

  const submitEdit = async () => {
    if (editingItemId == null) return;
    const payload = editorToPayload(editor, !trip.costsHidden);
    if ('error' in payload) {
      setError(payload.error);
      return;
    }
    setError(null);
    setPendingItemId(editingItemId);
    try {
      const r = await fetch(`/api/trips/${trip.id}/items/${editingItemId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not update item');
        return;
      }
      const synced = await syncAttachments(editingItemId, editor);
      const latest = synced.trip ?? data.trip;
      applyTrip(latest);
      if (synced.error) {
        keepEditingAfterFileError(latest, editingItemId, editor, synced.error);
        return;
      }
      cancelAddOrEdit();
    } finally {
      setPendingItemId(null);
    }
  };

  const toggleComplete = async (item: TripItineraryItemSummary) => {
    setPendingItemId(item.id);
    setError(null);
    try {
      const r = await fetch(`/api/trips/${trip.id}/items/${item.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: item.completedAt === null }),
      });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not update item');
        return;
      }
      applyTrip(data.trip);
    } finally {
      setPendingItemId(null);
    }
  };

  const deleteItem = async (itemId: number) => {
    if (!confirm('Remove this item from the itinerary?')) return;
    setPendingItemId(itemId);
    setError(null);
    try {
      const r = await fetch(`/api/trips/${trip.id}/items/${itemId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not remove item');
        return;
      }
      applyTrip(data.trip);
    } finally {
      setPendingItemId(null);
    }
  };

  const startEdit = (item: TripItineraryItemSummary) => {
    setError(null);
    setAddingHere(false);
    setEditingItemId(item.id);
    setEditor(editorFromItem(item));
  };

  // ── Drag to reschedule ──────────────────────────────────────────────────

  const commitDrag = (itemId: number, target: DragTarget) => {
    const moving = trip.items.find((item) => item.id === itemId);
    if (!moving) return;
    const fromDayId = moving.dayId;
    if (fromDayId === target.dayId && target.index === Number.MAX_SAFE_INTEGER) {
      // Dropped on its own day card — nothing to do.
      return;
    }

    const snapshot = trip;
    const nextItems = applyReorder(trip.items, itemId, target.dayId, target.index);
    setTrip({ ...trip, items: nextItems });
    // Follow the card, so a cross-day drag doesn't leave you looking at a
    // day the event just left.
    if (target.dayId !== fromDayId) setActiveDayId(target.dayId);

    const payload = reorderPayload(nextItems, [fromDayId, target.dayId]);
    void (async () => {
      try {
        const r = await fetch(`/api/trips/${trip.id}/items/reorder`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            // Without this the global fetch interceptor toasts every drop.
            [SILENT_BANNER_HEADER]: '1',
          },
          body: JSON.stringify({ days: payload }),
        });
        if (!r.ok) throw new Error('reorder failed');
      } catch {
        setTrip(snapshot);
        setError('Could not save the new order — the itinerary has been put back.');
      }
    })();
  };

  const { drag, registerEvent, registerDayCard, registerPane, onEventPointerDown } =
    useItineraryDrag({
      items: activeItems,
      activeDayId: currentDayId,
      enabled: canEdit && editingItemId === null && !addingHere,
      onCommit: commitDrag,
    });

  // ── Days ────────────────────────────────────────────────────────────────

  const callDayEndpoint = async (
    url: string,
    init: RequestInit,
    failure: string,
    selectNew = false,
  ) => {
    setError(null);
    try {
      const before = new Set(trip.days.map((day) => day.id));
      const r = await fetch(url, { credentials: 'include', ...init });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? failure);
        return;
      }
      applyTrip(data.trip);
      if (selectNew) {
        const added = data.trip.days.find((day) => !before.has(day.id));
        if (added) setActiveDayId(added.id);
      }
    } finally {
      setPending(null);
      setDayMenuOpen(false);
    }
  };

  const addDay = async (atStart = false) => {
    setPending('day');
    await callDayEndpoint(
      `/api/trips/${trip.id}/days`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          atStart ? { atStart: true } : { afterDayId: currentDayId ?? null },
        ),
      },
      'Could not add a day',
      true,
    );
  };

  const patchDay = async (dayId: number, body: Record<string, unknown>) => {
    setPending('day');
    await callDayEndpoint(
      `/api/trips/${trip.id}/days/${dayId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Could not update the day',
    );
  };

  const duplicateDay = async (dayId: number) => {
    setPending('day');
    await callDayEndpoint(
      `/api/trips/${trip.id}/days/${dayId}/duplicate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      'Could not duplicate the day',
      true,
    );
  };

  const removeDay = async (dayId: number) => {
    if (
      !confirm(
        'Delete this day? Anything scheduled on it moves to Unscheduled rather than being deleted.',
      )
    ) {
      return;
    }
    setPending('day');
    await callDayEndpoint(
      `/api/trips/${trip.id}/days/${dayId}`,
      { method: 'DELETE' },
      'Could not delete the day',
    );
  };

  const updateStatus = async (status: TripStatus) => {
    if (status === trip.status) return;
    setPending(`status:${status}`);
    setError(null);
    try {
      const r = await fetch(`/api/trips/${trip.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not update status');
        return;
      }
      applyTrip(data.trip);
    } finally {
      setPending(null);
    }
  };

  const openTripForm = async () => {
    setPending('edit-trip');
    setError(null);
    try {
      const r = await fetch('/api/trips/form-options', { credentials: 'include' });
      const data = (await r.json().catch(() => null)) as (TripFormOptions & { error?: string }) | null;
      if (!r.ok || !data?.customers) {
        setError(data?.error ?? 'Could not open the trip details');
        return;
      }
      setEditOptions(data);
    } finally {
      setPending(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const activeLabel = activeGroup ? dayLabel(activeGroup.day) : null;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50/50">
      <header className="sticky top-0 z-30 shrink-0 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/modules/trip-planning"
            className="text-sm font-medium text-gray-400 transition-colors hover:text-primary"
          >
            ← Back
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-primary">
              {trip.reference} · {trip.trackingCode}
            </p>
            <h1 className="truncate text-base font-bold tracking-tight text-gray-900 sm:text-lg">
              {trip.title}
            </h1>
            <p
              className="truncate text-xs text-gray-500"
              title={trip.travelers.map((t) => t.name).join(', ')}
            >
              {trip.customer.name}
              {trip.travelers.length > 0 && (
                <>
                  {' · '}
                  {trip.travelers.map((t, index) => (
                    <span key={t.id}>
                      {index > 0 && ', '}
                      {t.name}
                      {t.isPrimary && trip.travelers.length > 1 && (
                        <span className="text-gray-400"> (lead)</span>
                      )}
                    </span>
                  ))}
                </>
              )}
            </p>
          </div>
          <span className="hidden text-xs text-gray-500 sm:block">
            {formatRangeBadge(trip.startDate, trip.endDate)}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={() => void openTripForm()}
              disabled={pending === 'edit-trip'}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.536 8 18l1.464-4.536z" />
              </svg>
              {pending === 'edit-trip' ? 'Opening…' : 'Edit trip'}
            </button>
          )}
          {trip.status === 'Active' && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </button>
          )}
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              STATUS_PILL[trip.status] ?? STATUS_PILL.Draft
            }`}
          >
            {trip.status}
          </span>
        </div>
      </header>

      {editOptions && (
        <TripBuilder
          trip={trip}
          customers={editOptions.customers}
          travelers={editOptions.travelers}
          owners={editOptions.owners}
          currentUser={currentUser}
          onClose={() => setEditOptions(null)}
          onSaved={(saved) => {
            applyTrip(saved);
            setClientTravelers(editOptions.travelers.filter((t) => t.customerId === saved.customer.id));
            setEditOptions(null);
          }}
        />
      )}

      {shareOpen && (
        <ShareDialog
          tripId={trip.id}
          customer={{ name: trip.customer.name, email: trip.customer.email }}
          onClose={() => setShareOpen(false)}
        />
      )}

      {error && (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-700 sm:px-6">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ── Day rail ─────────────────────────────────────────────── */}
        <aside className="shrink-0 border-b border-gray-200 bg-white lg:w-72 lg:border-b-0 lg:border-r">
          <div className="border-b border-gray-100 p-3">
            <button
              type="button"
              onClick={() => {
                setShowLog(false);
                void addDay();
              }}
              disabled={!canEdit || pending === 'day'}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
              </svg>
              New Day
            </button>
            {trip.days.length > 0 && canEdit && (
              <button
                type="button"
                onClick={() => {
                  setShowLog(false);
                  void addDay(true);
                }}
                disabled={pending === 'day'}
                className="mt-1.5 w-full rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-primary disabled:opacity-50"
              >
                Add a day at the start
              </button>
            )}
          </div>

          {/* Above the day list so it stays in reach on a long trip. */}
          <button
            type="button"
            onClick={() => setShowLog(true)}
            aria-pressed={showLog}
            className={`flex w-full items-center justify-between border-b border-gray-100 px-4 py-3 text-left transition-colors ${
              showLog ? 'bg-primary/5' : 'hover:bg-gray-50'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5h10M9 12h10M9 19h10M5 5h.01M5 12h.01M5 19h.01" />
              </svg>
              Trip log
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">{logCount}</span>
          </button>

          <div className="max-h-[22rem] overflow-y-auto lg:max-h-[calc(100vh-11rem)]">
            {groups.map(({ day, items }) => {
              const label = dayLabel(day);
              const active = !showLog && day.id === currentDayId;
              return (
                <button
                  key={day.id}
                  ref={registerDayCard(day.id)}
                  type="button"
                  onClick={() => {
                    setShowLog(false);
                    setActiveDayId(day.id);
                  }}
                  className={`flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                    active ? 'bg-primary/5' : 'hover:bg-gray-50'
                  } ${
                    drag?.target?.dayId === day.id && drag.target.index === Number.MAX_SAFE_INTEGER
                      ? 'ring-2 ring-inset ring-primary/50'
                      : ''
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 h-9 w-1 shrink-0 rounded-full ${
                      active ? 'bg-primary' : 'bg-transparent'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-gray-500">{label.short}</span>
                    <span className="block truncate text-sm font-semibold text-gray-900">
                      {dayHeading(day)}
                    </span>
                    {items.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {dayTypeChips(items).map((category) => (
                          <DayTypeChip key={category} category={category} />
                        ))}
                      </span>
                    )}
                  </span>
                  <svg
                    className="mt-1 h-4 w-4 shrink-0 text-gray-300"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              );
            })}

            {groups.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-400">
                No days yet. Add one to start building the itinerary.
              </p>
            )}

            <button
              ref={registerDayCard(null)}
              type="button"
              onClick={() => {
                setShowLog(false);
                setActiveDayId(null);
              }}
              className={`flex w-full items-center justify-between border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                !showLog && currentDayId === null ? 'bg-primary/5' : 'hover:bg-gray-50'
              } ${
                drag?.target?.dayId === null && drag.target.index === Number.MAX_SAFE_INTEGER
                  ? 'ring-2 ring-inset ring-primary/50'
                  : ''
              }`}
            >
              <span className="text-sm font-medium text-gray-600">Unscheduled</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                {unscheduled.length}
              </span>
            </button>
          </div>
        </aside>

        {/* ── Day panel ────────────────────────────────────────────── */}
        <main ref={registerPane} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
            {showLog ? (
              <TripLogPanel
                tripId={trip.id}
                description={trip.description}
                notes={trip.notes}
                currentUserId={currentUser.id}
                isAdmin={isAdmin}
                onCountChange={setLogCount}
              />
            ) : (
              <>
                <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-4">
                    {activeLabel && (
                      <div className="shrink-0 text-center">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
                          {activeLabel.month}
                        </p>
                        <p className="text-2xl font-bold leading-tight text-gray-900">
                          {activeLabel.dayOfMonth}
                        </p>
                      </div>
                    )}
                    <div className="min-w-0 border-l border-gray-200 pl-4">
                      {activeGroup ? (
                        <>
                          <input
                            value={activeGroup.day.title ?? ''}
                            placeholder={activeLabel?.weekday || `Day ${activeGroup.day.dayNumber}`}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const title = event.target.value;
                              setTrip((current) => ({
                                ...current,
                                days: current.days.map((day) =>
                                  day.id === activeGroup.day.id ? { ...day, title } : day,
                                ),
                              }));
                            }}
                            onBlur={(event) =>
                              void patchDay(activeGroup.day.id, { title: event.target.value.trim() || null })
                            }
                            className="w-full truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xl font-bold text-gray-900 transition-colors hover:border-gray-200 focus:border-primary focus:outline-none disabled:hover:border-transparent"
                          />
                          <input
                            type="date"
                            value={activeGroup.day.dateKey ?? ''}
                            disabled={!canEdit}
                            onChange={(event) =>
                              void patchDay(activeGroup.day.id, { dateKey: event.target.value || null })
                            }
                            className="mt-1 rounded-md border border-transparent px-1 py-0.5 text-xs text-gray-500 transition-colors hover:border-gray-200 focus:border-primary focus:outline-none"
                          />
                        </>
                      ) : (
                        <>
                          <h2 className="text-xl font-bold text-gray-900">Unscheduled</h2>
                          <p className="mt-1 text-xs text-gray-500">
                            Anything without a day yet. Give it a date to place it.
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {activeGroup && canEdit && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setDayMenuOpen((open) => !open)}
                          aria-label="Day options"
                          className="rounded-lg border border-gray-200 px-2.5 py-2 text-gray-500 transition-colors hover:bg-gray-50"
                        >
                          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM18 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                        </button>
                        {dayMenuOpen && (
                          <>
                            <button
                              type="button"
                              aria-label="Close menu"
                              className="fixed inset-0 z-10 cursor-default"
                              onClick={() => setDayMenuOpen(false)}
                            />
                            <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                              <button
                                type="button"
                                onClick={() => void duplicateDay(activeGroup.day.id)}
                                className="block w-full px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                              >
                                Duplicate day
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeDay(activeGroup.day.id)}
                                className="block w-full px-4 py-2 text-left text-sm text-rose-600 transition-colors hover:bg-rose-50"
                              >
                                Delete day
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => startAdd()}
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
                        </svg>
                        New Event
                      </button>
                    )}
                  </div>
                </div>

                {activeGroup?.day.summary && (
                  <p className="mb-5 whitespace-pre-line text-sm text-gray-600">{activeGroup.day.summary}</p>
                )}

                {activeItems.length === 0 && !addingHere && (
                  <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
                    Nothing here yet.
                  </p>
                )}

                <ItemList
                  items={activeItems}
                  days={trip.days}
                  crewOptions={crewOptions}
                  travelerChoices={travelerChoices}
                  showCost={!trip.costsHidden}
                  canEdit={canEdit}
                  registerEvent={registerEvent}
                  onPointerDownItem={onEventPointerDown}
                  dragItemId={drag?.itemId ?? null}
                  ghost={
                    drag && drag.target && drag.target.dayId === currentDayId
                      ? { index: drag.target.index, height: drag.height }
                      : null
                  }
                  pendingItemId={pendingItemId}
                  editingItemId={editingItemId}
                  editor={editor}
                  setEditor={setEditor}
                  addingHere={addingHere}
                  onStartEdit={startEdit}
                  onSubmitEdit={submitEdit}
                  onSubmitAdd={submitAdd}
                  onCancel={cancelAddOrEdit}
                  onDelete={deleteItem}
                  onToggleComplete={toggleComplete}
                  onStartAdd={startAdd}
                  onAddEmptyRun={startEmptyRun}
                  pending={pending}
                />
              </>
            )}

            <div className="mt-10 border-t border-gray-100 pt-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Trip status
              </p>
              <div className="flex flex-wrap gap-2">
                {ALL_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={!canEdit || pending === `status:${status}` || status === trip.status}
                    onClick={() => void updateStatus(status)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                      status === trip.status
                        ? STATUS_PILL[status] ?? STATUS_PILL.Draft
                        : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
              {trip.sourceQuote && (
                <p className="mt-4 text-xs text-gray-500">
                  Built from quote{' '}
                  <Link
                    href={`/modules/quotes/${trip.sourceQuote.id}/edit`}
                    className="font-medium text-primary hover:underline"
                  >
                    {trip.sourceQuote.reference}
                  </Link>
                </p>
              )}
            </div>
          </div>
        </main>
      </div>

      {drag && (
        <div
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-[1000] rounded-xl opacity-90 shadow-2xl"
          style={{
            width: drag.width,
            transform: `translate(${drag.pointerX - drag.offsetX}px, ${drag.pointerY - drag.offsetY}px)`,
          }}
        >
          {(() => {
            const item = trip.items.find((candidate) => candidate.id === drag.itemId);
            if (!item) return null;
            return (
              <div className="flex items-center gap-2.5 rounded-xl border border-primary/30 bg-white px-3 py-2.5">
                <ItemTypeIcon category={item.category} />
                <p className="truncate text-sm font-semibold text-gray-900">{item.description}</p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

interface ItemListProps {
  items: TripItineraryItemSummary[];
  /** For the flight and transport forms' day pickers. */
  days: TripDaySummary[];
  crewOptions: CrewOptions;
  travelerChoices: TravelerChoices;
  showCost: boolean;
  registerEvent: (id: number) => (el: HTMLElement | null) => (() => void) | undefined;
  onPointerDownItem: (event: React.PointerEvent<HTMLElement>, itemId: number) => void;
  dragItemId: number | null;
  /** Where the placeholder sits in the list, and how tall to make it. */
  ghost: { index: number; height: number } | null;
  canEdit: boolean;
  pendingItemId: number | null;
  editingItemId: number | null;
  editor: EditorState;
  setEditor: (e: EditorState) => void;
  addingHere: boolean;
  onStartEdit: (item: TripItineraryItemSummary) => void;
  onSubmitEdit: () => void;
  onSubmitAdd: () => void;
  onCancel: () => void;
  onDelete: (id: number) => void;
  onToggleComplete: (item: TripItineraryItemSummary) => void;
  onStartAdd: (category?: TripItemCategory) => void;
  /** Open the add form on the empty run for a pick-up or drop-off. */
  onAddEmptyRun: (item: TripItineraryItemSummary) => void;
  pending: string | null;
}

function ItemList({
  items,
  days,
  crewOptions,
  travelerChoices,
  showCost,
  registerEvent,
  onPointerDownItem,
  dragItemId,
  ghost,
  canEdit,
  pendingItemId,
  editingItemId,
  editor,
  setEditor,
  addingHere,
  onStartEdit,
  onSubmitEdit,
  onSubmitAdd,
  onCancel,
  onDelete,
  onToggleComplete,
  onStartAdd,
  onAddEmptyRun,
  pending,
}: ItemListProps) {
  const nodes = items
    .filter((item) => item.id !== dragItemId)
    .map((item) =>
        editingItemId === item.id ? (
          <ItemEditor
            key={item.id}
            editor={editor}
            setEditor={setEditor}
            onSubmit={onSubmitEdit}
            onCancel={onCancel}
            submitting={pendingItemId === item.id}
            submitLabel="Save"
            showCost={showCost}
            days={days}
            crewOptions={crewOptions}
            travelerChoices={travelerChoices}
          />
        ) : (
          <div
            key={item.id}
            ref={registerEvent(item.id)}
            onPointerDown={canEdit ? (event) => onPointerDownItem(event, item.id) : undefined}
            className={`rounded-xl transition ${canEdit ? 'cursor-grab touch-none select-none' : ''}`}
          >
            {item.category === 'flight' ? (
              <FlightCard
                item={item}
                canEdit={canEdit}
                isPending={pendingItemId === item.id}
                onEdit={() => onStartEdit(item)}
                onDelete={() => onDelete(item.id)}
                onToggleComplete={() => onToggleComplete(item)}
              />
            ) : isEmptyRun(item) ? (
              <EmptyRunCard
                item={item}
                canEdit={canEdit}
                isPending={pendingItemId === item.id}
                onEdit={() => onStartEdit(item)}
                onDelete={() => onDelete(item.id)}
                onToggleComplete={() => onToggleComplete(item)}
              />
            ) : ROW_STYLE_CATEGORIES.has(item.category) ? (
              <BookedRow
                item={item}
                canEdit={canEdit}
                draggable={false}
                isPending={pendingItemId === item.id}
                onEdit={() => onStartEdit(item)}
                onDelete={() => onDelete(item.id)}
                onToggleComplete={() => onToggleComplete(item)}
                onAddEmptyRun={
                  item.category === 'transportation' &&
                  (item.timeLabel === 'PICK-UP' || item.timeLabel === 'DROP-OFF')
                    ? () => onAddEmptyRun(item)
                    : undefined
                }
              />
            ) : (
              <StopCard
                item={item}
                canEdit={canEdit}
                draggable={false}
                isPending={pendingItemId === item.id}
                onEdit={() => onStartEdit(item)}
                onDelete={() => onDelete(item.id)}
                onToggleComplete={() => onToggleComplete(item)}
              />
            )}
          </div>
        ),
    );

  if (ghost) {
    const at = Math.max(0, Math.min(ghost.index, nodes.length));
    nodes.splice(
      at,
      0,
      <div
        key="__ghost"
        style={{ height: ghost.height }}
        className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5"
      />,
    );
  }

  return (
    <div className="space-y-2.5">
      {nodes}

      {addingHere && (
        <ItemEditor
          editor={editor}
          setEditor={setEditor}
          onSubmit={onSubmitAdd}
          onCancel={onCancel}
          submitting={pending === 'add'}
          submitLabel="Add"
          showCost={showCost}
          days={days}
          crewOptions={crewOptions}
          travelerChoices={travelerChoices}
        />
      )}

      {!addingHere && canEdit && (
        <button
          type="button"
          onClick={() => onStartAdd()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
          </svg>
          Add to this day
        </button>
      )}
    </div>
  );
}

function DetailChips({ item }: { item: TripItineraryItemSummary }) {
  const meta = categoryMeta(item.category);
  const details = item.details ?? {};
  // Imported records name the crew as text; once linked, CrewRow shows them instead.
  const linked = new Set([
    ...(item.driver ? ['driverName', 'driverPhone'] : []),
    ...(item.vehicle ? ['vehicle'] : []),
  ]);
  const chips = meta.fields
    .filter((field) => !linked.has(field.key))
    .map((field) => ({ label: field.label, value: details[field.key] }))
    .filter((chip): chip is { label: string; value: string } => Boolean(chip.value))
    .slice(0, 6);

  if (item.confirmationCode) chips.push({ label: 'Conf', value: item.confirmationCode });
  if (chips.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-dashed border-slate-200 pt-3">
      {chips.map((chip) => (
        <div key={chip.label}>
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{chip.label}</p>
          <p className="text-sm font-semibold text-slate-800">{chip.value}</p>
        </div>
      ))}
    </div>
  );
}

/** Place, phone and booking link — the same footer on every card. */
function ContactRow({ item }: { item: TripItineraryItemSummary }) {
  const place = item.placeName || item.address;
  if (!place && !item.phone && !item.bookingUrl) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      {place && (
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z" />
          </svg>
          {place}
        </span>
      )}
      {item.phone && <a href={`tel:${item.phone}`} className="hover:text-primary">{item.phone}</a>}
      {item.bookingUrl && (
        <a
          href={item.bookingUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-primary hover:underline"
        >
          Booking link
        </a>
      )}
    </div>
  );
}

function CardActions({
  done,
  isPending,
  onEdit,
  onDelete,
  onToggleComplete,
  extra,
}: {
  done: boolean;
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
  /** Card-specific actions, before Remove. */
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-2">
      <button
        type="button"
        onClick={onToggleComplete}
        disabled={isPending}
        className="text-xs font-medium text-slate-500 transition-colors hover:text-primary disabled:opacity-50"
      >
        {done ? 'Mark incomplete' : 'Mark complete'}
      </button>
      <button
        type="button"
        onClick={onEdit}
        disabled={isPending}
        className="text-xs font-medium text-slate-500 transition-colors hover:text-primary disabled:opacity-50"
      >
        Edit
      </button>
      {extra}
      <button
        type="button"
        onClick={onDelete}
        disabled={isPending}
        className="ml-auto text-xs font-medium text-slate-400 transition-colors hover:text-rose-600 disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}

/**
 * The vehicle repositioning with no passenger. Drawn quieter than a client
 * movement, so it can never be mistaken for one.
 */
function EmptyRunCard({
  item,
  canEdit,
  isPending,
  onEdit,
  onDelete,
  onToggleComplete,
}: {
  item: TripItineraryItemSummary;
  canEdit: boolean;
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}) {
  const done = item.completedAt !== null;
  const details = item.details ?? {};
  const route = `${details.pickupLocation || 'Base'} → ${details.dropoffLocation || 'Base'}`;
  const customTitle = item.description !== emptyRunTitle(details.pickupLocation ?? '', details.dropoffLocation ?? '');
  const facts = [
    item.durationMinutes ? `${formatDuration(item.durationMinutes * 60_000)} drive` : null,
    details.distanceKm ? `${details.distanceKm} km` : null,
  ].filter(Boolean);

  return (
    <div
      className={`group overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 transition-shadow hover:shadow-sm ${
        done ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-slate-400">
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <path d={CATEGORY_ICON_PATHS.transportation} />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {item.scheduledAt && (
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {formatTimeRange(item.scheduledAt, item.endsAt)}
              </span>
            )}
            <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Empty run · no passengers
            </span>
          </div>
          <p className={`mt-0.5 text-base font-semibold ${done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
            {customTitle ? item.description : route}
          </p>
          {customTitle && <p className="text-sm text-slate-500">{route}</p>}
          {facts.length > 0 && <p className="text-xs text-slate-500">{facts.join(' · ')}</p>}
          {item.body && (
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{item.body}</p>
          )}
          <CrewRow item={item} />
          <AttachmentStrip attachments={item.attachments} />
        </div>
      </div>
      {canEdit && (
        <CardActions
          done={done}
          isPending={isPending}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleComplete={onToggleComplete}
        />
      )}
    </div>
  );
}

/**
 * Booked things — lodging, transport, reservations. A coloured
 * category strip, the time and its label, then whatever fields that category
 * carries laid out like a ticket stub.
 */
function BookedRow({
  item,
  canEdit,
  isPending,
  onEdit,
  onDelete,
  onToggleComplete,
  onAddEmptyRun,
}: {
  item: TripItineraryItemSummary;
  canEdit: boolean;
  draggable: boolean;
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
  /** Pick-ups and drop-offs: add the empty run that goes with them. */
  onAddEmptyRun?: () => void;
}) {
  const done = item.completedAt !== null;
  const meta = categoryMeta(item.category);
  return (
    <div
      className={`group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md ${
        done ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <ItemTypeIcon category={item.category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {(item.scheduledAt || item.timeLabel) && (
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {bookedLabel(item)}
              </span>
            )}
            {item.providerName && (
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${meta.chip}`}>
                {item.providerName}
              </span>
            )}
          </div>
          <p
            className={`mt-0.5 text-base font-semibold ${
              done ? 'text-slate-400 line-through' : 'text-slate-900'
            }`}
          >
            {item.description}
          </p>
          {item.subtitle && <p className="text-sm text-slate-500">{item.subtitle}</p>}
          <TravelerRow item={item} />
          {item.body && (
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
              {item.body}
            </p>
          )}
          <DetailChips item={item} />
          <CrewRow item={item} />
          <ContactRow item={item} />
          <AttachmentStrip attachments={item.attachments} />
        </div>
        {item.reminderMinutesBefore != null && (
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            reminder
          </span>
        )}
      </div>
      {canEdit && (
        <CardActions
          done={done}
          isPending={isPending}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleComplete={onToggleComplete}
          extra={
            onAddEmptyRun && (
              <button
                type="button"
                onClick={onAddEmptyRun}
                disabled={isPending}
                title={
                  item.timeLabel === 'DROP-OFF'
                    ? 'Add the empty run back after this drop-off'
                    : 'Add the empty run out to this pick-up'
                }
                className="text-xs font-medium text-slate-500 transition-colors hover:text-primary disabled:opacity-50"
              >
                + Empty run
              </button>
            )
          }
        />
      )}
    </div>
  );
}

/** Activities, tours and information blocks — the narrative kind of event. */
function StopCard({
  item,
  canEdit,
  isPending,
  onEdit,
  onDelete,
  onToggleComplete,
}: {
  item: TripItineraryItemSummary;
  canEdit: boolean;
  draggable: boolean;
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}) {
  const done = item.completedAt !== null;
  const meta = categoryMeta(item.category);
  const isInformation = item.category === 'information';

  return (
    <div
      className={`group overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md ${
        isInformation ? 'border-slate-200 bg-slate-50/70' : 'border-slate-200 bg-white'
      } ${done ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-3 p-4">
        <ItemTypeIcon category={item.category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {(item.scheduledAt || item.timeLabel) && (
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {bookedLabel(item)}
              </span>
            )}
            {item.providerName && (
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${meta.chip}`}>
                {item.providerName}
              </span>
            )}
          </div>
          <p
            className={`mt-0.5 text-base font-semibold ${
              done ? 'text-slate-400 line-through' : 'text-slate-900'
            }`}
          >
            {item.description}
          </p>
          {item.subtitle && <p className="text-sm text-slate-500">{item.subtitle}</p>}
          <TravelerRow item={item} />
          {item.body && (
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
              {item.body}
            </p>
          )}
          <DetailChips item={item} />
          <CrewRow item={item} />
          <ContactRow item={item} />
          <AttachmentStrip attachments={item.attachments} />
          {item.reminderMinutesBefore != null && (
            <p className="mt-2 text-xs font-medium text-amber-700">Reminder set</p>
          )}
        </div>
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt=""
            className="h-20 w-28 shrink-0 rounded-xl object-cover sm:h-24 sm:w-36"
          />
        ) : null}
      </div>
      {canEdit && (
        <CardActions
          done={done}
          isPending={isPending}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleComplete={onToggleComplete}
        />
      )}
    </div>
  );
}

function ItemTypeIcon({ category }: { category: string }) {
  const meta = categoryMeta(category);
  const key = (isTripItemCategory(category) ? category : 'activity') as TripItemCategory;
  return (
    <div
      title={meta.label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.chip}`}
    >
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d={CATEGORY_ICON_PATHS[key]} />
      </svg>
    </div>
  );
}

/** "KQ 762 · Seat 14A · Gate 7" — whatever this category actually has. */
function ItemEditor({
  editor,
  setEditor,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
  showCost,
  days,
  crewOptions,
  travelerChoices,
}: {
  /** Costs are quote prices; hidden from people without access to quotes. */
  showCost: boolean;
  days: TripDaySummary[];
  crewOptions: CrewOptions;
  travelerChoices: TravelerChoices;
  editor: EditorState;
  setEditor: (e: EditorState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const patch = (next: Partial<EditorState>) => setEditor({ ...editor, ...next });
  const meta = CATEGORY_META[editor.category];
  const labelClass = 'text-xs font-medium text-gray-500';
  const fieldClass =
    'mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';
  const spanClass: Record<number, string> = {
    1: 'col-span-2 sm:col-span-1',
    2: 'col-span-2',
    3: 'col-span-2 sm:col-span-3',
    4: 'col-span-2 sm:col-span-4',
  };

  const setDetail = (key: string, value: string) =>
    patch({ details: { ...editor.details, [key]: value } });

  return (
    <div className="space-y-4 rounded-2xl border border-primary/20 bg-white p-4 shadow-sm sm:p-5">
      {/* Category — everything below reshapes around this. */}
      <div className="flex flex-wrap gap-1.5">
        {TRIP_ITEM_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() =>
              patch({
                category,
                // Details are category-specific; carrying them across would
                // leave a flight number sitting on a hotel.
                details: {},
                timeLabel: CATEGORY_META[category].timeLabels[0] ?? '',
              })
            }
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              editor.category === category
                ? 'border-primary bg-primary text-white'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {CATEGORY_META[category].label}
          </button>
        ))}
      </div>

      {editor.category === 'flight' ? (
        <FlightFields editor={editor} patch={patch} days={days} crewOptions={crewOptions} showCost={showCost} />
      ) : editor.category === 'transportation' ? (
        <TransportFields editor={editor} patch={patch} days={days} crewOptions={crewOptions} showCost={showCost} />
      ) : (
        <>
          <label className="block">
            <span className={labelClass}>{meta.titleLabel}</span>
            <input
              type="text"
              placeholder={meta.titlePlaceholder}
              value={editor.description}
              onChange={(e) => patch({ description: e.target.value })}
              className="mt-1 w-full rounded-lg bg-gray-50 px-4 py-3 text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>

          {meta.providerLabel && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="col-span-2 block">
                <span className={labelClass}>{meta.providerLabel}</span>
                <input
                  type="text"
                  value={editor.providerName}
                  onChange={(e) => patch({ providerName: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="col-span-2 block">
                <span className={labelClass}>Confirmation #</span>
                <input
                  type="text"
                  value={editor.confirmationCode}
                  onChange={(e) => patch({ confirmationCode: e.target.value })}
                  className={fieldClass}
                />
              </label>
            </div>
          )}

          {/* When + what kind of time it is */}
          {editor.category !== 'information' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="block">
                <span className={labelClass}>Date</span>
                <input
                  type="date"
                  value={editor.date}
                  onChange={(e) => patch({ date: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Time</span>
                <input
                  type="time"
                  value={editor.time}
                  onChange={(e) => patch({ time: e.target.value })}
                  disabled={!editor.date}
                  className={`${fieldClass} disabled:opacity-50`}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Ends</span>
                <input
                  type="time"
                  value={editor.endTime}
                  onChange={(e) => patch({ endTime: e.target.value })}
                  disabled={!editor.date}
                  className={`${fieldClass} disabled:opacity-50`}
                />
              </label>
              {meta.timeLabels.length > 0 && (
                <label className="block">
                  <span className={labelClass}>Label</span>
                  <select
                    value={editor.timeLabel}
                    onChange={(e) => patch({ timeLabel: e.target.value })}
                    className={fieldClass}
                  >
                    <option value="">None</option>
                    {meta.timeLabels.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {/* ── The fields that make this category itself ──────────────── */}
          {meta.fields.length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {meta.label} details
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {meta.fields.map((field) => (
                  <label key={field.key} className={`block ${spanClass[field.span ?? 2]}`}>
                    <span className={labelClass}>{field.label}</span>
                    {field.kind === 'select' ? (
                      <select
                        value={editor.details[field.key] ?? ''}
                        onChange={(e) => setDetail(field.key, e.target.value)}
                        className={`${fieldClass} bg-white`}
                      >
                        <option value="">—</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.kind === 'number' ? 'number' : field.kind === 'time' ? 'time' : 'text'}
                        placeholder={field.placeholder}
                        value={editor.details[field.key] ?? ''}
                        onChange={(e) => setDetail(field.key, e.target.value)}
                        className={`${fieldClass} bg-white`}
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Where */}
          {editor.category !== 'information' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="col-span-2 block">
                <span className={labelClass}>Place</span>
                <input
                  type="text"
                  placeholder="Villa Rosa Kempinski"
                  value={editor.placeName}
                  onChange={(e) => patch({ placeName: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="col-span-2 block">
                <span className={labelClass}>Address</span>
                <input
                  type="text"
                  value={editor.address}
                  onChange={(e) => patch({ address: e.target.value })}
                  className={fieldClass}
                />
              </label>
            </div>
          )}

          <label className="block">
            <span className={labelClass}>Description</span>
            <textarea
              placeholder="What the traveller should know about this."
              value={editor.body}
              onChange={(e) => patch({ body: e.target.value })}
              rows={3}
              className={fieldClass}
            />
          </label>

          <details className="rounded-xl border border-gray-100 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-gray-500">
              {showCost ? 'More — contact, link, cost, reminder' : 'More — contact, link, reminder'}
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="col-span-2 block">
                <span className={labelClass}>Phone</span>
                <input
                  type="tel"
                  value={editor.phone}
                  onChange={(e) => patch({ phone: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="col-span-2 block">
                <span className={labelClass}>Booking link</span>
                <input
                  type="url"
                  value={editor.bookingUrl}
                  onChange={(e) => patch({ bookingUrl: e.target.value })}
                  className={fieldClass}
                />
              </label>
              {!meta.providerLabel && (
                <label className="col-span-2 block">
                  <span className={labelClass}>Confirmation #</span>
                  <input
                    type="text"
                    value={editor.confirmationCode}
                    onChange={(e) => patch({ confirmationCode: e.target.value })}
                    className={fieldClass}
                  />
                </label>
              )}
              {showCost && (
                <label className="col-span-2 block sm:col-span-1">
                  <span className={labelClass}>Cost</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editor.unitPrice}
                    onChange={(e) => patch({ unitPrice: e.target.value })}
                    className={fieldClass}
                  />
                </label>
              )}
              <label className="col-span-2 block sm:col-span-1">
                <span className={labelClass}>Reminder</span>
                <select
                  value={editor.reminderMinutesBefore}
                  onChange={(e) => patch({ reminderMinutesBefore: e.target.value })}
                  disabled={!editor.date}
                  className={`${fieldClass} disabled:opacity-50`}
                >
                  {REMINDER_OPTIONS.map((option) => (
                    <option key={String(option.value)} value={option.value == null ? '' : String(option.value)}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 block">
                <span className={labelClass}>Image URL</span>
                <input
                  type="url"
                  value={editor.imageUrl}
                  onChange={(e) => patch({ imageUrl: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="col-span-2 block sm:col-span-4">
                <span className={labelClass}>Short sub-label</span>
                <input
                  type="text"
                  placeholder="One line under the title"
                  value={editor.subtitle}
                  onChange={(e) => patch({ subtitle: e.target.value })}
                  className={fieldClass}
                />
              </label>
            </div>
          </details>

        </>
      )}

      {!isEmptyRunEditor(editor) && (
        <EventTravelerFields
          choices={travelerChoices}
          value={editor.travelers}
          onChange={(travelers) => patch({ travelers })}
        />
      )}

      <AttachmentPicker
        attachments={editor.attachments}
        removedIds={editor.removedAttachmentIds}
        newFiles={editor.newFiles}
        onChange={(next) => patch(next)}
      />

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
