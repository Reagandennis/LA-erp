'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  REMINDER_OPTIONS,
  TRIP_ITEM_TYPES,
  type TripDetail,
  type TripItemType,
  type TripItineraryItemSummary,
  type TripStatus,
} from '../types';

interface ItineraryPageClientProps {
  trip: TripDetail;
  currentUser: { id: number; name: string; email: string };
  isAdmin: boolean;
}

interface ItemPayload {
  itemType: TripItemType;
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
const ROW_STYLE_TYPES = new Set<TripItemType>(['flight', 'car', 'hotel']);

function isoDateOnly(value: string | Date | null): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
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

function dayParts(dateStr: string): { weekday: string; dayNum: string; heading: string } {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { weekday: '', dayNum: dateStr, heading: dateStr };
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    dayNum: String(d.getDate()),
    heading: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  };
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

function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function bookedLabel(item: TripItineraryItemSummary): string {
  if (item.itemType === 'car') return item.scheduledAt ? `Pick up ${formatTimeRange(item.scheduledAt, null)}` : 'Pick up';
  if (item.itemType === 'hotel') return item.scheduledAt ? `Check in ${formatTimeRange(item.scheduledAt, null)}` : 'Check in';
  return formatTimeRange(item.scheduledAt, item.endsAt);
}

interface EditorState {
  itemType: TripItemType;
  description: string;
  subtitle: string;
  date: string;
  time: string;
  endTime: string;
  reminderMinutesBefore: string;
  imageUrl: string;
  confirmationCode: string;
}

function blankEditor(prefillDate: string | null, type: TripItemType = 'activity'): EditorState {
  return {
    itemType: type,
    description: '',
    subtitle: '',
    date: prefillDate ?? '',
    time: prefillDate ? '09:00' : '',
    endTime: '',
    reminderMinutesBefore: '',
    imageUrl: '',
    confirmationCode: '',
  };
}

function editorFromItem(item: TripItineraryItemSummary): EditorState {
  return {
    itemType: item.itemType,
    description: item.description,
    subtitle: item.subtitle ?? '',
    date: dateInputValue(item.scheduledAt),
    time: timeInputValue(item.scheduledAt),
    endTime: timeInputValue(item.endsAt),
    reminderMinutesBefore: item.reminderMinutesBefore != null ? String(item.reminderMinutesBefore) : '',
    imageUrl: item.imageUrl ?? '',
    confirmationCode: item.confirmationCode ?? '',
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
  return {
    itemType: editor.itemType,
    description,
    subtitle: editor.subtitle.trim() || null,
    scheduledAt,
    endsAt,
    durationMinutes: null,
    reminderMinutesBefore,
    imageUrl: editor.imageUrl.trim() || null,
    confirmationCode: editor.confirmationCode.trim() || null,
    quantity: 1,
    unitPrice: null,
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
  const [addingForDate, setAddingForDate] = useState<string | null>(null);
  const [addingUnscheduled, setAddingUnscheduled] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState>(blankEditor(null));
  // A card dropped into a new slot waiting for the user to allocate its new time.
  const [reschedule, setReschedule] = useState<{ item: TripItineraryItemSummary; date: string; time: string } | null>(null);
  // Days the user has added in this session (beyond today + days that already have items).
  const [extraDays, setExtraDays] = useState<string[]>([]);

  const isCreator = trip.createdBy.id === currentUser.id;
  const isOwner = trip.owner?.id === currentUser.id;
  const canEdit =
    isAdmin ||
    (trip.status !== 'Cancelled' && (trip.status !== 'Completed' ? isCreator || isOwner : isOwner));

  const itemsByDay = useMemo(() => {
    const map = new Map<string, TripItineraryItemSummary[]>();
    const unscheduled: TripItineraryItemSummary[] = [];
    for (const item of trip.items) {
      const day = isoDateOnly(item.scheduledAt);
      if (!day) {
        unscheduled.push(item);
        continue;
      }
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(item);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
        const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
        return ta - tb || a.position - b.position;
      });
    }
    unscheduled.sort((a, b) => a.position - b.position);
    return { map, unscheduled };
  }, [trip.items]);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // The timeline shows the current date by default, plus any days that already have
  // scheduled items, plus days the user explicitly adds — not the whole trip range.
  const displayDays = useMemo(() => {
    const set = new Set<string>();
    if (today) set.add(today);
    for (const k of itemsByDay.map.keys()) set.add(k);
    for (const d of extraDays) set.add(d);
    return Array.from(set).sort();
  }, [today, itemsByDay.map, extraDays]);

  const startAdd = (date: string | null, type: TripItemType = 'activity') => {
    setError(null);
    setEditingItemId(null);
    setEditor(blankEditor(date, type));
    setAddingForDate(date);
    setAddingUnscheduled(date == null);
  };

  const cancelAddOrEdit = () => {
    setAddingForDate(null);
    setAddingUnscheduled(false);
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
        body: JSON.stringify({ items: [payload] }),
      });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not add item');
        return;
      }
      setTrip(data.trip);
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
      setTrip(data.trip);
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
      setTrip(data.trip);
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
      setTrip(data.trip);
    } finally {
      setPendingItemId(null);
    }
  };

  // Drag-and-drop within a day no longer silently retimes the card. Instead, dropping
  // it into a new slot prompts the user to allocate a new time, suggesting one based on
  // where it landed (between its new neighbours). The day re-sorts once the time is set.
  const requestReschedule = (orderedItems: TripItineraryItemSummary[], movedId: number) => {
    const idx = orderedItems.findIndex((i) => i.id === movedId);
    if (idx < 0) return;
    const moved = orderedItems[idx];
    const day = isoDateOnly(moved.scheduledAt) ?? today;

    const prevT = orderedItems[idx - 1]?.scheduledAt
      ? new Date(orderedItems[idx - 1].scheduledAt as string).getTime()
      : null;
    const nextT = orderedItems[idx + 1]?.scheduledAt
      ? new Date(orderedItems[idx + 1].scheduledAt as string).getTime()
      : null;

    let suggested: number | null = null;
    if (prevT != null && nextT != null && nextT > prevT) suggested = Math.round((prevT + nextT) / 2);
    else if (prevT != null) suggested = prevT + 30 * 60_000;
    else if (nextT != null) suggested = nextT - 30 * 60_000;
    else if (moved.scheduledAt) suggested = new Date(moved.scheduledAt).getTime();

    const time = suggested != null ? new Date(suggested).toTimeString().slice(0, 5) : timeInputValue(moved.scheduledAt) || '09:00';

    setError(null);
    setReschedule({ item: moved, date: day, time });
  };

  const confirmReschedule = async () => {
    if (!reschedule) return;
    const scheduledAt = combineDateTime(reschedule.date, reschedule.time);
    if (!scheduledAt) {
      setError('Pick a valid date and time for the card');
      return;
    }
    const item = reschedule.item;
    const dur =
      item.endsAt && item.scheduledAt
        ? new Date(item.endsAt).getTime() - new Date(item.scheduledAt).getTime()
        : null;
    const endsAt = dur != null && dur > 0 ? new Date(new Date(scheduledAt).getTime() + dur).toISOString() : null;

    setError(null);
    setPendingItemId(item.id);
    try {
      const r = await fetch(`/api/trips/${trip.id}/items/${item.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt, endsAt }),
      });
      const data = (await r.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not save the new time');
        return;
      }
      setTrip(data.trip);
      setReschedule(null);
    } finally {
      setPendingItemId(null);
    }
  };

  const addDay = () => {
    const last = displayDays.length > 0 ? displayDays[displayDays.length - 1] : today;
    if (!last) return;
    const next = addDaysIso(last, 1);
    setExtraDays((cur) => (next && !cur.includes(next) ? [...cur, next] : cur));
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
      setTrip(data.trip);
    } finally {
      setPending(null);
    }
  };

  const startEdit = (item: TripItineraryItemSummary) => {
    setError(null);
    setAddingForDate(null);
    setAddingUnscheduled(false);
    setEditingItemId(item.id);
    setEditor(editorFromItem(item));
  };

  return (
    <div className="min-h-screen bg-gray-50/50">
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-8">
          <Link href="/modules/trip-planning" className="text-sm font-medium text-gray-400 transition-colors hover:text-primary">
            ← Back
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-primary">
              {trip.reference} · {trip.trackingCode}
            </p>
            <h1 className="truncate text-base font-bold tracking-tight text-gray-900 sm:text-lg">{trip.title}</h1>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_PILL[trip.status] ?? STATUS_PILL.Draft}`}>
            {trip.status}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">Itinerary</h2>
            <p className="mt-1 text-sm text-gray-500">
              {trip.customer.name}
              {trip.customer.company ? ` · ${trip.customer.company}` : ''}
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700">
            <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {formatRangeBadge(trip.startDate, trip.endDate)}
          </span>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</div>
        )}

        {/* Day timeline */}
        <div>
          {displayDays.map((day) => {
            const dayItems = itemsByDay.map.get(day) ?? [];
            const isToday = day === today;
            const parts = dayParts(day);
            return (
              <div key={day} className="flex gap-4 sm:gap-5">
                {/* Left rail: date node + connecting line */}
                <div className="flex shrink-0 flex-col items-center">
                  <div
                    className={`flex h-14 w-14 flex-col items-center justify-center rounded-2xl border ${
                      isToday ? 'border-primary bg-primary text-white shadow-sm' : 'border-gray-200 bg-white text-gray-900'
                    }`}
                  >
                    <span className={`text-[10px] font-semibold uppercase ${isToday ? 'text-white/80' : 'text-gray-400'}`}>
                      {parts.weekday}
                    </span>
                    <span className="text-lg font-bold leading-none">{parts.dayNum}</span>
                  </div>
                  <div className="my-2 w-px flex-1 bg-gray-200" />
                </div>

                {/* Day content */}
                <div className="min-w-0 flex-1 pb-10">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-gray-900">{parts.heading}</h3>
                    {isToday && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Today</span>
                    )}
                    <span className="text-sm text-gray-400">
                      · {dayItems.length === 0 ? 'Nothing planned' : `${dayItems.length} ${dayItems.length === 1 ? 'item' : 'items'}`}
                    </span>
                  </div>
                  <ItemList
                    dateKey={day}
                    items={dayItems}
                    canEdit={canEdit}
                    pendingItemId={pendingItemId}
                    editingItemId={editingItemId}
                    editor={editor}
                    setEditor={setEditor}
                    addingHere={addingForDate === day}
                    onStartEdit={startEdit}
                    onSubmitEdit={submitEdit}
                    onSubmitAdd={submitAdd}
                    onCancel={cancelAddOrEdit}
                    onDelete={deleteItem}
                    onToggleComplete={toggleComplete}
                    onStartAdd={() => startAdd(day)}
                    onReorder={requestReschedule}
                    rescheduleId={reschedule?.item.id ?? null}
                    pending={pending}
                  />
                </div>
              </div>
            );
          })}

          {/* Add day node */}
          {canEdit && (
            <div className="flex items-center gap-4 sm:gap-5">
              <button
                type="button"
                onClick={addDay}
                aria-label="Add a day"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 text-gray-400 transition-colors hover:border-primary/40 hover:text-primary"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={addDay}
                className="text-sm font-semibold text-gray-500 transition-colors hover:text-primary"
              >
                Add another day
              </button>
            </div>
          )}
        </div>

        {/* Unscheduled */}
        {(itemsByDay.unscheduled.length > 0 || addingUnscheduled) && (
          <section className="mt-10 border-t border-gray-100 pt-8">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-amber-700">Unscheduled</h3>
              <p className="text-sm text-gray-500">
                {itemsByDay.unscheduled.length} {itemsByDay.unscheduled.length === 1 ? 'item' : 'items'} without a time yet
              </p>
            </div>
            <ItemList
              dateKey={null}
              items={itemsByDay.unscheduled}
              canEdit={canEdit}
              pendingItemId={pendingItemId}
              editingItemId={editingItemId}
              editor={editor}
              setEditor={setEditor}
              addingHere={addingUnscheduled}
              onStartEdit={startEdit}
              onSubmitEdit={submitEdit}
              onSubmitAdd={submitAdd}
              onCancel={cancelAddOrEdit}
              onDelete={deleteItem}
              onToggleComplete={toggleComplete}
              onStartAdd={() => startAdd(null)}
              pending={pending}
            />
          </section>
        )}

        {canEdit && !addingUnscheduled && itemsByDay.unscheduled.length === 0 && (
          <button
            type="button"
            onClick={() => startAdd(null)}
            className="mt-8 text-sm font-medium text-gray-500 transition-colors hover:text-primary"
          >
            + Add an unscheduled item
          </button>
        )}

        {/* Status footer */}
        {canEdit && (
          <div className="mt-12 border-t border-gray-100 pt-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Trip status</p>
            <div className="flex flex-wrap gap-2">
              {ALL_STATUSES.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => updateStatus(s)}
                  disabled={trip.status === s || pending !== null}
                  className={`rounded-lg border px-3.5 py-1.5 text-sm font-medium transition ${
                    trip.status === s ? 'border-primary bg-primary text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  {pending === `status:${s}` ? '…' : s}
                </button>
              ))}
            </div>
          </div>
        )}

        {trip.sourceQuote && (
          <p className="mt-6 text-sm text-gray-500">
            Created from quote{' '}
            <Link href={`/modules/quotes?focus=${trip.sourceQuote.id}`} className="font-semibold text-primary hover:underline">
              {trip.sourceQuote.reference}
            </Link>
          </p>
        )}
      </main>

      {reschedule && (
        <>
          <button
            type="button"
            aria-label="Cancel rescheduling"
            className="fixed inset-0 z-[300] bg-gray-900/30 backdrop-blur-sm"
            onClick={() => {
              setReschedule(null);
              setError(null);
            }}
          />
          <div className="fixed left-1/2 top-1/2 z-[310] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                New time needed
              </span>
            </div>
            <h3 className="text-lg font-bold text-gray-900">Allocate a new time</h3>
            <p className="mt-1 text-sm text-gray-500">
              You moved <span className="font-medium text-gray-700">{reschedule.item.description}</span>. Set when it now
              happens — the day re-orders by time.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Date</span>
                <input
                  type="date"
                  value={reschedule.date}
                  onChange={(e) => setReschedule((cur) => (cur ? { ...cur, date: e.target.value } : cur))}
                  className="mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Time</span>
                <input
                  type="time"
                  value={reschedule.time}
                  onChange={(e) => setReschedule((cur) => (cur ? { ...cur, time: e.target.value } : cur))}
                  className="mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
            </div>
            {error && <p className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setReschedule(null);
                  setError(null);
                }}
                disabled={pendingItemId === reschedule.item.id}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmReschedule}
                disabled={pendingItemId === reschedule.item.id}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {pendingItemId === reschedule.item.id ? 'Saving…' : 'Save time'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface ItemListProps {
  dateKey: string | null;
  items: TripItineraryItemSummary[];
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
  onStartAdd: (type?: TripItemType) => void;
  onReorder?: (items: TripItineraryItemSummary[], movedId: number) => void;
  rescheduleId?: number | null;
  pending: string | null;
}

function ItemList({
  items,
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
  onReorder,
  rescheduleId,
  pending,
}: ItemListProps) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const dndEnabled = canEdit && !!onReorder && items.length > 1;

  const handleDrop = (targetId: number) => {
    const movedId = dragId;
    const from = items.findIndex((i) => i.id === movedId);
    const to = items.findIndex((i) => i.id === targetId);
    setDragId(null);
    setOverId(null);
    if (!onReorder || movedId == null || from < 0 || to < 0 || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next, movedId);
  };

  return (
    <div className="space-y-2.5">
      {items.map((item) =>
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
            draggable={dndEnabled}
            onDragStart={
              dndEnabled
                ? (e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(item.id));
                    setDragId(item.id);
                  }
                : undefined
            }
            onDragEnter={dndEnabled ? () => setOverId(item.id) : undefined}
            onDragOver={dndEnabled ? (e) => e.preventDefault() : undefined}
            onDrop={
              dndEnabled
                ? (e) => {
                    e.preventDefault();
                    handleDrop(item.id);
                  }
                : undefined
            }
            onDragEnd={
              dndEnabled
                ? () => {
                    setDragId(null);
                    setOverId(null);
                  }
                : undefined
            }
            className={`rounded-xl transition ${dragId === item.id ? 'opacity-40' : ''} ${
              overId === item.id && dragId !== item.id ? 'ring-2 ring-primary/40' : ''
            } ${rescheduleId === item.id ? 'ring-2 ring-amber-400' : ''}`}
          >
            {ROW_STYLE_TYPES.has(item.itemType) ? (
              <BookedRow
                item={item}
                canEdit={canEdit}
                draggable={dndEnabled}
                isPending={pendingItemId === item.id}
                onEdit={() => onStartEdit(item)}
                onDelete={() => onDelete(item.id)}
                onToggleComplete={() => onToggleComplete(item)}
              />
            ) : (
              <StopCard
                item={item}
                canEdit={canEdit}
                draggable={dndEnabled}
                isPending={pendingItemId === item.id}
                onEdit={() => onStartEdit(item)}
                onDelete={() => onDelete(item.id)}
                onToggleComplete={() => onToggleComplete(item)}
              />
            )}
          </div>
        ),
      )}

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

function DragHandle() {
  return (
    <span
      className="shrink-0 cursor-grab text-gray-300 transition-colors group-hover:text-gray-400"
      title="Drag to reorder within the day"
      aria-hidden
    >
      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M7 5a1 1 0 11-2 0 1 1 0 012 0zM7 10a1 1 0 11-2 0 1 1 0 012 0zM7 15a1 1 0 11-2 0 1 1 0 012 0zM15 5a1 1 0 11-2 0 1 1 0 012 0zM15 10a1 1 0 11-2 0 1 1 0 012 0zM15 15a1 1 0 11-2 0 1 1 0 012 0z" />
      </svg>
    </span>
  );
}

function BookedRow({
  item,
  canEdit,
  draggable,
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
  return (
    <div className={`group flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 ${done ? 'opacity-60' : ''}`}>
      {draggable && <DragHandle />}
      <ItemTypeIcon type={item.itemType} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
          {item.description}
        </p>
        {item.subtitle && <p className="truncate text-xs text-gray-500">{item.subtitle}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="whitespace-nowrap text-sm font-semibold text-gray-900">{bookedLabel(item)}</p>
        {item.reminderMinutesBefore != null && <p className="text-xs font-medium text-amber-700">🔔 reminder</p>}
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onToggleComplete}
            disabled={isPending}
            className="p-1 text-gray-400 hover:text-primary"
            aria-label={done ? 'Mark incomplete' : 'Mark complete'}
            title={done ? 'Mark incomplete' : 'Mark complete'}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button type="button" onClick={onEdit} disabled={isPending} className="px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-900">
            Edit
          </button>
          <button type="button" onClick={onDelete} disabled={isPending} className="p-1 text-rose-400 hover:text-rose-700" aria-label="Remove" title="Remove">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function StopCard({
  item,
  canEdit,
  draggable,
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
  return (
    <div className={`group rounded-xl border border-gray-100 bg-white p-4 ${done ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        {draggable && (
          <div className="pt-1">
            <DragHandle />
          </div>
        )}
        <ItemTypeIcon type={item.itemType} />
        <div className="min-w-0 flex-1">
          <p className={`text-base font-semibold ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{item.description}</p>
          {item.subtitle && (
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-500">{item.subtitle}</p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            {item.scheduledAt && <span className="font-medium text-gray-700">{formatTimeRange(item.scheduledAt, item.endsAt)}</span>}
            {item.reminderMinutesBefore != null && <span className="text-amber-700">🔔 reminder</span>}
            {item.confirmationCode && <span className="text-violet-700">Conf · {item.confirmationCode}</span>}
          </div>
        </div>
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" className="h-20 w-28 shrink-0 rounded-lg object-cover sm:h-24 sm:w-36" />
        ) : null}
      </div>
      {canEdit && (
        <div className="mt-3 flex items-center gap-3 pl-1">
          <button type="button" onClick={onToggleComplete} disabled={isPending} className="text-xs font-medium text-gray-500 hover:text-primary">
            {done ? '↺ Mark incomplete' : '✓ Mark complete'}
          </button>
          <button type="button" onClick={onEdit} disabled={isPending} className="text-xs font-medium text-gray-500 hover:text-gray-900">
            Edit
          </button>
          <button type="button" onClick={onDelete} disabled={isPending} className="text-xs font-medium text-rose-500 hover:text-rose-800">
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function ItemTypeIcon({ type }: { type: TripItemType }) {
  if (type === 'flight') {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5L21 16z" />
        </svg>
      </div>
    );
  }
  if (type === 'car') {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
        </svg>
      </div>
    );
  }
  if (type === 'hotel') {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z" />
        </svg>
      </div>
    );
  }
  if (type === 'location') {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 17.02l-5.91 3.1 1.13-6.57L2.45 8.94l6.6-.96L12 2z" />
      </svg>
    </div>
  );
}

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
  const labelClass = 'text-xs font-medium text-gray-500';
  const fieldClass = 'mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';
  return (
    <div className="space-y-3 rounded-2xl border border-primary/20 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap gap-1.5">
        {TRIP_ITEM_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => patch({ itemType: t.value })}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              editor.itemType === t.value ? 'border-primary bg-primary text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Name (e.g. Nairobi — Cape Town, Hertz at the airport, Lagoon Beach Hotel)"
        value={editor.description}
        onChange={(e) => patch({ description: e.target.value })}
        className="w-full rounded-lg bg-gray-50 px-4 py-3 text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <textarea
        placeholder="Optional notes — hours, address, confirmation info, anything useful"
        value={editor.subtitle}
        onChange={(e) => patch({ subtitle: e.target.value })}
        rows={2}
        className="w-full rounded-lg bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className={labelClass}>Date</span>
          <input type="date" value={editor.date} onChange={(e) => patch({ date: e.target.value })} className={fieldClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Time</span>
          <input type="time" value={editor.time} onChange={(e) => patch({ time: e.target.value })} disabled={!editor.date} className={`${fieldClass} disabled:opacity-50`} />
        </label>
        <label className="block">
          <span className={labelClass}>End time</span>
          <input type="time" value={editor.endTime} onChange={(e) => patch({ endTime: e.target.value })} disabled={!editor.date} className={`${fieldClass} disabled:opacity-50`} />
        </label>
        <label className="block">
          <span className={labelClass}>Reminder</span>
          <select
            value={editor.reminderMinutesBefore}
            onChange={(e) => patch({ reminderMinutesBefore: e.target.value })}
            disabled={!editor.date}
            className={`${fieldClass} disabled:opacity-50`}
          >
            {REMINDER_OPTIONS.map((opt) => (
              <option key={String(opt.value)} value={opt.value == null ? '' : String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Image URL (optional)</span>
          <input type="url" placeholder="https://…" value={editor.imageUrl} onChange={(e) => patch({ imageUrl: e.target.value })} className={fieldClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Confirmation # (optional)</span>
          <input type="text" value={editor.confirmationCode} onChange={(e) => patch({ confirmationCode: e.target.value })} className={fieldClass} />
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} disabled={submitting} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50">
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
