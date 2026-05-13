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
  Draft: 'bg-gray-100 text-gray-700 border-gray-200',
  Planned: 'bg-blue-50 text-blue-700 border-blue-200',
  Active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Completed: 'bg-violet-50 text-violet-700 border-violet-200',
  Cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

// Booked-style item types render as compact rows with a leading colored icon chip.
// Location/activity types render as numbered pins below.
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

function formatDayOrdinal(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th';
  return `${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long' })} ${day}${suffix}`;
}

function formatRangeBadge(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '—';
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(s)} - ${fmt(e)}`;
}

function formatTimeRange(scheduledAt: string | null, endsAt: string | null): string {
  if (!scheduledAt) return '';
  const s = new Date(scheduledAt);
  const t = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!endsAt) return t(s);
  const e = new Date(endsAt);
  return `${t(s)} – ${t(e)}`;
}

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return out;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const iso = isoDateOnly(d);
    if (iso) out.push(iso);
  }
  return out;
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDateOnly(d) ?? dateStr;
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
    reminderMinutesBefore:
      item.reminderMinutesBefore != null ? String(item.reminderMinutesBefore) : '',
    imageUrl: item.imageUrl ?? '',
    confirmationCode: item.confirmationCode ?? '',
  };
}

function editorToPayload(editor: EditorState): ItemPayload | { error: string } {
  const description = editor.description.trim();
  if (!description) return { error: 'Give it a name' };
  const scheduledAt = editor.date ? combineDateTime(editor.date, editor.time || null) : null;
  const endsAt =
    editor.date && editor.endTime ? combineDateTime(editor.date, editor.endTime) : null;
  if (endsAt && scheduledAt && new Date(endsAt) < new Date(scheduledAt)) {
    return { error: 'End time must be after start time' };
  }
  const reminderMinutesBefore = editor.reminderMinutesBefore
    ? Number(editor.reminderMinutesBefore)
    : null;
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

  const isCreator = trip.createdBy.id === currentUser.id;
  const isOwner = trip.owner?.id === currentUser.id;
  const canEdit =
    isAdmin ||
    (trip.status !== 'Cancelled' &&
      (trip.status !== 'Completed' ? isCreator || isOwner : isOwner));

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

  const dayKeys = useMemo(() => {
    const tripStart = isoDateOnly(trip.startDate);
    const tripEnd = isoDateOnly(trip.endDate);
    const fromRange = tripStart && tripEnd ? daysBetween(tripStart, tripEnd) : [];
    const all = new Set<string>(fromRange);
    for (const k of itemsByDay.map.keys()) all.add(k);
    return Array.from(all).sort();
  }, [trip.startDate, trip.endDate, itemsByDay.map]);

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
      const data = (await r.json().catch(() => null)) as
        | { trip?: TripDetail; error?: string }
        | null;
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
      const data = (await r.json().catch(() => null)) as
        | { trip?: TripDetail; error?: string }
        | null;
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
      const data = (await r.json().catch(() => null)) as
        | { trip?: TripDetail; error?: string }
        | null;
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
      const data = (await r.json().catch(() => null)) as
        | { trip?: TripDetail; error?: string }
        | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not remove item');
        return;
      }
      setTrip(data.trip);
    } finally {
      setPendingItemId(null);
    }
  };

  const extendByOneDay = async () => {
    const anchor = isoDateOnly(trip.endDate) ?? isoDateOnly(trip.startDate) ?? isoDateOnly(new Date());
    if (!anchor) return;
    setPending('extend');
    setError(null);
    try {
      const r = await fetch(`/api/trips/${trip.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endDate: addDaysIso(anchor, 1) }),
      });
      const data = (await r.json().catch(() => null)) as
        | { trip?: TripDetail; error?: string }
        | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not extend trip');
        return;
      }
      setTrip(data.trip);
    } finally {
      setPending(null);
    }
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
      const data = (await r.json().catch(() => null)) as
        | { trip?: TripDetail; error?: string }
        | null;
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
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-100 bg-white sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-4 flex items-center gap-4">
          <Link
            href="/modules/trip-planning"
            className="text-gray-400 hover:text-gray-700 text-sm font-bold"
          >
            ← Back
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.3em] truncate">
              {trip.reference} · {trip.trackingCode}
            </p>
            <h1 className="text-base sm:text-lg font-black text-gray-900 tracking-tight truncate">
              {trip.title}
            </h1>
          </div>
          <span
            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
              STATUS_PILL[trip.status] ?? STATUS_PILL.Draft
            }`}
          >
            {trip.status}
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div className="flex-1 min-w-0">
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight text-gray-900">
              Itinerary
            </h2>
            <p className="text-sm text-gray-500 font-bold mt-2">
              {trip.customer.name}
              {trip.customer.company ? ` • ${trip.customer.company}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-full text-sm font-bold text-gray-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              {formatRangeBadge(trip.startDate, trip.endDate)}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
            {error}
          </div>
        )}

        {/* Unscheduled */}
        {(itemsByDay.unscheduled.length > 0 || addingUnscheduled) && (
          <DaySection
            heading="Unscheduled"
            subheading={`${itemsByDay.unscheduled.length} ${itemsByDay.unscheduled.length === 1 ? 'item' : 'items'} without a time yet`}
            isUnscheduled
          >
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
          </DaySection>
        )}

        {/* Days */}
        {dayKeys.map((day) => {
          const dayItems = itemsByDay.map.get(day) ?? [];
          const isAddingHere = addingForDate === day;
          return (
            <DaySection
              key={day}
              heading={formatDayOrdinal(day)}
              subheading={
                dayItems.length === 0
                  ? 'Nothing planned yet'
                  : `${dayItems.length} ${dayItems.length === 1 ? 'item' : 'items'}`
              }
            >
              <ItemList
                dateKey={day}
                items={dayItems}
                canEdit={canEdit}
                pendingItemId={pendingItemId}
                editingItemId={editingItemId}
                editor={editor}
                setEditor={setEditor}
                addingHere={isAddingHere}
                onStartEdit={startEdit}
                onSubmitEdit={submitEdit}
                onSubmitAdd={submitAdd}
                onCancel={cancelAddOrEdit}
                onDelete={deleteItem}
                onToggleComplete={toggleComplete}
                onStartAdd={(type) => startAdd(day, type)}
                pending={pending}
              />
            </DaySection>
          );
        })}

        {dayKeys.length === 0 && !addingUnscheduled && itemsByDay.unscheduled.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-12">
            {canEdit
              ? 'Pick start & end dates for this trip to start scheduling items.'
              : 'No itinerary items yet.'}
          </p>
        )}

        {/* Footer actions */}
        {canEdit && (
          <div className="mt-10 flex flex-wrap gap-3">
            {!addingUnscheduled && itemsByDay.unscheduled.length === 0 && (
              <button
                type="button"
                onClick={() => startAdd(null)}
                className="px-4 py-2 text-xs font-black text-gray-700 uppercase tracking-widest border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                + Add unscheduled item
              </button>
            )}
            <button
              type="button"
              onClick={extendByOneDay}
              disabled={pending === 'extend'}
              className="px-4 py-2 text-xs font-black text-emerald-700 uppercase tracking-widest border border-emerald-200 rounded-xl hover:bg-emerald-50 disabled:opacity-50"
            >
              {pending === 'extend' ? 'Adding…' : '+ Add day'}
            </button>
          </div>
        )}

        {/* Status footer */}
        {canEdit && (
          <div className="mt-12 pt-6 border-t border-gray-100">
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">
              Trip status
            </p>
            <div className="flex flex-wrap gap-2">
              {ALL_STATUSES.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => updateStatus(s)}
                  disabled={trip.status === s || pending !== null}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition ${
                    trip.status === s
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  {pending === `status:${s}` ? '…' : s}
                </button>
              ))}
            </div>
          </div>
        )}

        {trip.sourceQuote && (
          <p className="mt-6 text-xs text-gray-500">
            Created from quote{' '}
            <Link
              href={`/modules/quotes?focus=${trip.sourceQuote.id}`}
              className="text-emerald-700 font-bold hover:underline"
            >
              {trip.sourceQuote.reference}
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}

function DaySection({
  heading,
  subheading,
  children,
  isUnscheduled,
}: {
  heading: string;
  subheading?: string;
  children: React.ReactNode;
  isUnscheduled?: boolean;
}) {
  return (
    <section className="mb-12 first:mt-0">
      <div className="flex items-start gap-3 mb-5">
        <button
          type="button"
          aria-label="Collapse day"
          className="mt-1 text-gray-300 hover:text-gray-600"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h3
            className={`text-2xl sm:text-3xl font-black tracking-tight ${
              isUnscheduled ? 'text-amber-700' : 'text-gray-900'
            }`}
          >
            {heading}
          </h3>
          {subheading && (
            <p className="text-sm text-gray-500 font-bold mt-1">{subheading}</p>
          )}
        </div>
      </div>
      <div>{children}</div>
    </section>
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
  pending,
}: ItemListProps) {
  const bookedItems = items.filter((i) => ROW_STYLE_TYPES.has(i.itemType));
  const stopItems = items.filter((i) => !ROW_STYLE_TYPES.has(i.itemType));

  return (
    <div className="space-y-3">
      {/* Compact booked rows */}
      {bookedItems.map((item) =>
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
          <BookedRow
            key={item.id}
            item={item}
            canEdit={canEdit}
            isPending={pendingItemId === item.id}
            onEdit={() => onStartEdit(item)}
            onDelete={() => onDelete(item.id)}
            onToggleComplete={() => onToggleComplete(item)}
          />
        ),
      )}

      {/* Numbered pin cards */}
      {stopItems.length > 0 && (
        <div className="mt-3">
          {stopItems.map((item, idx) =>
            editingItemId === item.id ? (
              <div key={item.id} className="mb-3">
                <ItemEditor
                  editor={editor}
                  setEditor={setEditor}
                  onSubmit={onSubmitEdit}
                  onCancel={onCancel}
                  submitting={pendingItemId === item.id}
                  submitLabel="Save"
                />
              </div>
            ) : (
              <PinCard
                key={item.id}
                item={item}
                index={idx + 1}
                isLast={idx === stopItems.length - 1}
                canEdit={canEdit}
                isPending={pendingItemId === item.id}
                onEdit={() => onStartEdit(item)}
                onDelete={() => onDelete(item.id)}
                onToggleComplete={() => onToggleComplete(item)}
              />
            ),
          )}
        </div>
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
        <AddItemMenu onPick={onStartAdd} />
      )}
    </div>
  );
}

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
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}) {
  const done = item.completedAt !== null;
  return (
    <div
      className={`group flex items-center gap-3 px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 ${
        done ? 'opacity-60' : ''
      }`}
    >
      <ItemTypeIcon type={item.itemType} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-black truncate ${done ? 'line-through text-gray-400' : 'text-gray-900'}`}>
          {item.description}
        </p>
        {item.subtitle && (
          <p className="text-xs text-gray-500 truncate">{item.subtitle}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-black text-gray-900 whitespace-nowrap">
          {bookedLabel(item)}
        </p>
        {item.reminderMinutesBefore != null && (
          <p className="text-[10px] font-bold text-amber-700">🔔 reminder set</p>
        )}
      </div>
      {canEdit && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleComplete}
            disabled={isPending}
            className="p-1 text-gray-400 hover:text-emerald-600"
            aria-label={done ? 'Mark incomplete' : 'Mark complete'}
            title={done ? 'Mark incomplete' : 'Mark complete'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={isPending}
            className="px-2 py-1 text-[10px] font-black text-gray-500 uppercase tracking-widest hover:text-gray-900"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isPending}
            className="p-1 text-rose-400 hover:text-rose-700"
            aria-label="Remove"
            title="Remove"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function PinCard({
  item,
  index,
  isLast,
  canEdit,
  isPending,
  onEdit,
  onDelete,
  onToggleComplete,
}: {
  item: TripItineraryItemSummary;
  index: number;
  isLast: boolean;
  canEdit: boolean;
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}) {
  const done = item.completedAt !== null;
  return (
    <div className="relative">
      <div className="flex gap-4">
        <div className="flex flex-col items-center shrink-0 pt-1">
          <div className="w-9 h-10 bg-teal-400 text-white text-sm font-black rounded-t-full rounded-b-md flex items-end justify-center pb-1 shadow-sm">
            {index}
          </div>
          {!isLast && <div className="flex-1 w-px bg-gray-200 mt-1" />}
        </div>
        <div className="flex-1 min-w-0 pb-6">
          <div className="group flex items-start gap-4 rounded-2xl bg-gray-50 border border-gray-100 p-4">
            <div className="flex-1 min-w-0">
              <p className={`text-lg font-black tracking-tight ${done ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                {item.description}
              </p>
              {item.subtitle && (
                <p className="text-sm text-gray-500 mt-2 leading-relaxed whitespace-pre-wrap">
                  {item.subtitle}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                {item.scheduledAt && (
                  <span>{formatTimeRange(item.scheduledAt, item.endsAt)}</span>
                )}
                {item.reminderMinutesBefore != null && (
                  <span className="text-amber-700">🔔 reminder</span>
                )}
                {item.confirmationCode && (
                  <span className="text-violet-700">CONF · {item.confirmationCode}</span>
                )}
              </div>
            </div>
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt=""
                className="w-32 sm:w-44 h-24 sm:h-28 rounded-xl object-cover shrink-0"
              />
            ) : (
              <div className="w-32 sm:w-44 h-24 sm:h-28 rounded-xl bg-gray-100 shrink-0" />
            )}
          </div>
          {canEdit && (
            <div className="flex items-center gap-3 mt-2 ml-1">
              <button
                type="button"
                onClick={onToggleComplete}
                disabled={isPending}
                className="text-[10px] font-black text-gray-500 uppercase tracking-widest hover:text-emerald-700"
              >
                {done ? '↺ Mark incomplete' : '✓ Mark complete'}
              </button>
              <button
                type="button"
                onClick={onEdit}
                disabled={isPending}
                className="text-[10px] font-black text-gray-500 uppercase tracking-widest hover:text-gray-900"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={isPending}
                className="text-[10px] font-black text-rose-500 uppercase tracking-widest hover:text-rose-800"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemTypeIcon({ type }: { type: TripItemType }) {
  if (type === 'flight') {
    return (
      <div className="w-10 h-10 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5L21 16z" />
        </svg>
      </div>
    );
  }
  if (type === 'car') {
    return (
      <div className="w-10 h-10 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
        </svg>
      </div>
    );
  }
  if (type === 'hotel') {
    return (
      <div className="w-10 h-10 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z" />
        </svg>
      </div>
    );
  }
  return null;
}

function AddItemMenu({ onPick }: { onPick: (type: TripItemType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 text-xs font-black text-emerald-700 uppercase tracking-widest bg-emerald-50/60 border border-dashed border-emerald-200 rounded-2xl hover:bg-emerald-50"
      >
        + Add to day
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-2 z-10 bg-white border border-gray-200 rounded-2xl shadow-xl p-2 grid grid-cols-2 sm:grid-cols-5 gap-1">
          {TRIP_ITEM_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(t.value);
              }}
              className="px-3 py-2 text-xs font-black text-gray-700 uppercase tracking-widest hover:bg-gray-50 rounded-xl text-left"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
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
  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-emerald-200 space-y-3 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {TRIP_ITEM_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => patch({ itemType: t.value })}
            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition ${
              editor.itemType === t.value
                ? 'bg-gray-900 text-white border-gray-900'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Name (e.g. Nairobi — Cape Town, Hertz at Cape Town Airport, Lagoon Beach Hotel)"
        value={editor.description}
        onChange={(e) => patch({ description: e.target.value })}
        className="w-full px-4 py-3 bg-gray-50 rounded-xl text-base font-bold focus:ring-2 focus:ring-emerald-500"
      />
      <textarea
        placeholder="Optional notes — hours, address, confirmation info, anything useful"
        value={editor.subtitle}
        onChange={(e) => patch({ subtitle: e.target.value })}
        rows={2}
        className="w-full px-4 py-3 bg-gray-50 rounded-xl text-sm font-medium focus:ring-2 focus:ring-emerald-500"
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block">
          <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
            Date
          </span>
          <input
            type="date"
            value={editor.date}
            onChange={(e) => patch({ date: e.target.value })}
            className="mt-1 w-full px-2 py-2 bg-gray-50 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500"
          />
        </label>
        <label className="block">
          <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
            Time
          </span>
          <input
            type="time"
            value={editor.time}
            onChange={(e) => patch({ time: e.target.value })}
            disabled={!editor.date}
            className="mt-1 w-full px-2 py-2 bg-gray-50 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
            End time
          </span>
          <input
            type="time"
            value={editor.endTime}
            onChange={(e) => patch({ endTime: e.target.value })}
            disabled={!editor.date}
            className="mt-1 w-full px-2 py-2 bg-gray-50 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
            Reminder
          </span>
          <select
            value={editor.reminderMinutesBefore}
            onChange={(e) => patch({ reminderMinutesBefore: e.target.value })}
            disabled={!editor.date}
            className="mt-1 w-full px-2 py-2 bg-gray-50 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          >
            {REMINDER_OPTIONS.map((opt) => (
              <option key={String(opt.value)} value={opt.value == null ? '' : String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
            Image URL (optional)
          </span>
          <input
            type="url"
            placeholder="https://…"
            value={editor.imageUrl}
            onChange={(e) => patch({ imageUrl: e.target.value })}
            className="mt-1 w-full px-3 py-2 bg-gray-50 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500"
          />
        </label>
        <label className="block">
          <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
            Confirmation # (optional)
          </span>
          <input
            type="text"
            value={editor.confirmationCode}
            onChange={(e) => patch({ confirmationCode: e.target.value })}
            className="mt-1 w-full px-3 py-2 bg-gray-50 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-4 py-2 text-xs font-black text-gray-600 uppercase tracking-widest hover:text-gray-900 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="px-5 py-2 text-xs font-black text-white bg-emerald-600 uppercase tracking-widest rounded-xl hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
