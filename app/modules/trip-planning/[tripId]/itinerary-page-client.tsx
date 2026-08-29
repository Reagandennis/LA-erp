'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
  REMINDER_OPTIONS,
  type TripDetail,
  type TripItemType,
  type TripItineraryItemSummary,
  type TripStatus,
} from '../types';
import { SILENT_BANNER_HEADER } from '@/app/ui/banner';

import {
  applyReorder,
  dayHeading,
  dayLabel,
  dayTypeChips,
  groupItemsByDay,
  reorderPayload,
} from './itinerary-model';
import FlightCard from './_components/flight-card';
import { useItineraryDrag, type DragTarget } from './_components/use-itinerary-drag';
import {
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
  unitPrice: number | null;
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
  'cruise',
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
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function formatTimeRange(scheduledAt: string | null, endsAt: string | null): string {
  if (!scheduledAt) return '';
  const s = new Date(scheduledAt);
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

interface EditorState {
  category: TripItemCategory;
  description: string;
  subtitle: string;
  body: string;
  timeLabel: string;
  providerName: string;
  phone: string;
  bookingUrl: string;
  placeName: string;
  address: string;
  date: string;
  time: string;
  endTime: string;
  reminderMinutesBefore: string;
  imageUrl: string;
  confirmationCode: string;
  unitPrice: string;
  /** Category-specific values, keyed by the field spec in categories.ts. */
  details: Record<string, string>;
}

/** The legacy column still has to be written; derive it from the category. */
const LEGACY_TYPE: Record<TripItemCategory, TripItemType> = {
  flight: 'flight',
  transportation: 'car',
  lodging: 'hotel',
  cruise: 'activity',
  tour: 'activity',
  booking: 'activity',
  activity: 'activity',
  information: 'location',
};

function blankEditor(
  prefillDate: string | null,
  category: TripItemCategory = 'activity',
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
  };
}

function editorFromItem(item: TripItineraryItemSummary): EditorState {
  const category = (item.category as TripItemCategory) ?? mapLegacyItemType(item.itemType);
  return {
    category,
    description: item.description,
    subtitle: item.subtitle ?? '',
    body: item.body ?? '',
    timeLabel: item.timeLabel ?? '',
    providerName: item.providerName ?? '',
    phone: item.phone ?? '',
    bookingUrl: item.bookingUrl ?? '',
    placeName: item.placeName ?? '',
    address: item.address ?? '',
    date: dateInputValue(item.scheduledAt),
    time: timeInputValue(item.scheduledAt),
    endTime: timeInputValue(item.endsAt),
    reminderMinutesBefore:
      item.reminderMinutesBefore != null ? String(item.reminderMinutesBefore) : '',
    imageUrl: item.imageUrl ?? '',
    confirmationCode: item.confirmationCode ?? '',
    unitPrice: item.unitPrice != null ? String(item.unitPrice) : '',
    details: item.details ?? {},
  };
}

function editorToPayload(editor: EditorState): ItemPayload | { error: string } {
  const description = editor.description.trim();
  if (!description) return { error: 'Give it a name' };
  const scheduledAt = editor.date ? combineDateTime(editor.date, editor.time || null) : null;
  const endsAt = editor.date && editor.endTime ? combineDateTime(editor.date, editor.endTime) : null;
  if (endsAt && scheduledAt && new Date(endsAt) < new Date(scheduledAt)) {
    return { error: 'End time must be after start time' };
  }
  const reminderMinutesBefore = editor.reminderMinutesBefore ? Number(editor.reminderMinutesBefore) : null;
  if (scheduledAt == null && reminderMinutesBefore != null) {
    return { error: 'Reminders need a scheduled time' };
  }
  const price = editor.unitPrice.trim();
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
    durationMinutes: null,
    reminderMinutesBefore,
    imageUrl: editor.imageUrl.trim() || null,
    confirmationCode: editor.confirmationCode.trim() || null,
    quantity: 1,
    unitPrice: price ? Number(price) : null,
  };
}

export default function ItineraryPageClient({
  trip: initialTrip,
  currentUser,
  isAdmin,
}: ItineraryPageClientProps) {
  const [trip, setTrip] = useState<TripDetail>(initialTrip);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which day the right-hand pane is showing. `null` = the Unscheduled tray. */
  const [activeDayId, setActiveDayId] = useState<number | null>(
    initialTrip.days[0]?.id ?? null,
  );
  const [addingHere, setAddingHere] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState>(blankEditor(null));
  const [dayMenuOpen, setDayMenuOpen] = useState(false);

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

  const activeGroup = groups.find((group) => group.day.id === activeDayId) ?? null;
  const activeItems = activeGroup ? activeGroup.items : unscheduled;

  // Keep the selection valid when the active day is deleted.
  useEffect(() => {
    if (activeDayId !== null && !trip.days.some((day) => day.id === activeDayId)) {
      setActiveDayId(trip.days[0]?.id ?? null);
    }
  }, [trip.days, activeDayId]);

  const applyTrip = (next: TripDetail) => setTrip(next);

  // ── Items ───────────────────────────────────────────────────────────────

  const startAdd = (category: TripItemCategory = 'activity') => {
    setError(null);
    setEditingItemId(null);
    setEditor(blankEditor(activeGroup?.day.dateKey ?? null, category));
    setAddingHere(true);
  };

  const cancelAddOrEdit = () => {
    setAddingHere(false);
    setEditingItemId(null);
    setEditor(blankEditor(null));
    setError(null);
  };

  const submitAdd = async () => {
    const payload = editorToPayload(editor);
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
        body: JSON.stringify({ items: [{ ...payload, dayId: activeDayId }] }),
      });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not add item');
        return;
      }
      applyTrip(data.trip);
      cancelAddOrEdit();
    } finally {
      setPending(null);
    }
  };

  const submitEdit = async () => {
    if (editingItemId == null) return;
    const payload = editorToPayload(editor);
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
      applyTrip(data.trip);
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
      activeDayId,
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
          atStart ? { atStart: true } : { afterDayId: activeDayId ?? null },
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
          </div>
          <span className="hidden text-xs text-gray-500 sm:block">
            {formatRangeBadge(trip.startDate, trip.endDate)}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              STATUS_PILL[trip.status] ?? STATUS_PILL.Draft
            }`}
          >
            {trip.status}
          </span>
        </div>
      </header>

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
              onClick={() => void addDay()}
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
                onClick={() => void addDay(true)}
                disabled={pending === 'day'}
                className="mt-1.5 w-full rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-primary disabled:opacity-50"
              >
                Add a day at the start
              </button>
            )}
          </div>

          <div className="max-h-[22rem] overflow-y-auto lg:max-h-[calc(100vh-11rem)]">
            {groups.map(({ day, items }) => {
              const label = dayLabel(day);
              const active = day.id === activeDayId;
              return (
                <button
                  key={day.id}
                  ref={registerDayCard(day.id)}
                  type="button"
                  onClick={() => setActiveDayId(day.id)}
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
              onClick={() => setActiveDayId(null)}
              className={`flex w-full items-center justify-between border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                activeDayId === null ? 'bg-primary/5' : 'hover:bg-gray-50'
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
              canEdit={canEdit}
              registerEvent={registerEvent}
              onPointerDownItem={onEventPointerDown}
              dragItemId={drag?.itemId ?? null}
              ghost={
                drag && drag.target && drag.target.dayId === activeDayId
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
              pending={pending}
            />

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
                    href={`/modules/quotes/${trip.sourceQuote.id}`}
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
  pending: string | null;
}

function ItemList({
  items,
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
            ) : ROW_STYLE_CATEGORIES.has(item.category) ? (
              <BookedRow
                item={item}
                canEdit={canEdit}
                draggable={false}
                isPending={pendingItemId === item.id}
                onEdit={() => onStartEdit(item)}
                onDelete={() => onDelete(item.id)}
                onToggleComplete={() => onToggleComplete(item)}
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
  const chips = meta.fields
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
}: {
  done: boolean;
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
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
 * Booked things — lodging, transport, cruises, reservations. A coloured
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
          {item.body && (
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
              {item.body}
            </p>
          )}
          <DetailChips item={item} />
          <ContactRow item={item} />
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
          {item.body && (
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
              {item.body}
            </p>
          )}
          <DetailChips item={item} />
          <ContactRow item={item} />
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

const CATEGORY_PATHS: Record<TripItemCategory, string> = {
  flight:
    'M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5L21 16z',
  transportation:
    'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  lodging:
    'M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z',
  cruise:
    'M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99a8.76 8.76 0 008 0c1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42a1.007 1.007 0 00-.66 1.28L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z',
  tour: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z',
  booking:
    'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z',
  activity:
    'M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4-6.2-4.6-6.2 4.6 2.4-7.4L2 9.4h7.6z',
  information:
    'M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
};

function ItemTypeIcon({ category }: { category: string }) {
  const meta = categoryMeta(category);
  const key = (isTripItemCategory(category) ? category : 'activity') as TripItemCategory;
  return (
    <div
      title={meta.label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.chip}`}
    >
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d={CATEGORY_PATHS[key]} />
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
}: {
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
          More — contact, link, cost, reminder
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
