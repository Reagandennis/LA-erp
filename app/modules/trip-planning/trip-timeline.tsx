'use client';

import { useMemo, useState } from 'react';

import { REMINDER_OPTIONS, type TripItineraryItemSummary } from './types';

export interface TripTimelineDraftPatch {
  description?: string;
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  reminderMinutesBefore?: number | null;
  quantity?: number;
  unitPrice?: number | null;
  completed?: boolean;
}

export interface TripTimelineProps {
  startDate: string | null;
  endDate: string | null;
  items: TripItineraryItemSummary[];
  currency: string;
  readOnly?: boolean;
  pendingItemId?: number | null;
  onAddItem: (input: {
    description: string;
    scheduledAt: string | null;
    durationMinutes: number | null;
    reminderMinutesBefore: number | null;
    quantity: number;
    unitPrice: number | null;
  }) => Promise<void> | void;
  onUpdateItem: (itemId: number, patch: TripTimelineDraftPatch) => Promise<void> | void;
  onDeleteItem?: (itemId: number) => Promise<void> | void;
  onExtendEndDate?: (newEndDate: string) => Promise<void> | void;
}

function isoDateOnly(value: string | Date | null): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toLocalDateInputValue(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toLocalTimeInputValue(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function combineDateTime(dateStr: string, timeStr: string | null): string | null {
  if (!dateStr) return null;
  const time = timeStr && /^\d{2}:\d{2}$/.test(timeStr) ? timeStr : '09:00';
  const local = new Date(`${dateStr}T${time}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return out;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(isoDateOnly(d) ?? '');
  }
  return out.filter(Boolean);
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDateOnly(d) ?? dateStr;
}

function formatDayHeading(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimeChip(scheduledAt: string | null): string {
  if (!scheduledAt) return '';
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function reminderLabel(minutes: number | null): string {
  if (minutes == null) return '';
  const match = REMINDER_OPTIONS.find((o) => o.value === minutes);
  return match?.label ?? `${minutes} min before`;
}

function formatMoney(value: number | null, currency: string): string {
  if (value == null) return '—';
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  });
}

interface ItemEditorState {
  description: string;
  date: string;
  time: string;
  durationMinutes: string;
  reminderMinutesBefore: string;
  quantity: string;
  unitPrice: string;
  showBilling: boolean;
}

function blankEditor(prefillDate: string | null = null): ItemEditorState {
  return {
    description: '',
    date: prefillDate ?? '',
    time: prefillDate ? '09:00' : '',
    durationMinutes: '',
    reminderMinutesBefore: '',
    quantity: '1',
    unitPrice: '',
    showBilling: false,
  };
}

function editorFromItem(item: TripItineraryItemSummary): ItemEditorState {
  return {
    description: item.description,
    date: toLocalDateInputValue(item.scheduledAt),
    time: toLocalTimeInputValue(item.scheduledAt),
    durationMinutes: item.durationMinutes != null ? String(item.durationMinutes) : '',
    reminderMinutesBefore:
      item.reminderMinutesBefore != null ? String(item.reminderMinutesBefore) : '',
    quantity: String(item.quantity ?? 1),
    unitPrice: item.unitPrice != null ? String(item.unitPrice) : '',
    showBilling: item.unitPrice != null || (item.quantity ?? 1) !== 1,
  };
}

export default function TripTimeline({
  startDate,
  endDate,
  items,
  currency,
  readOnly = false,
  pendingItemId = null,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onExtendEndDate,
}: TripTimelineProps) {
  const [addingForDate, setAddingForDate] = useState<string | null>(null);
  const [addingUnscheduled, setAddingUnscheduled] = useState(false);
  const [editor, setEditor] = useState<ItemEditorState>(blankEditor());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editEditor, setEditEditor] = useState<ItemEditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const startIso = isoDateOnly(startDate);
  const endIso = isoDateOnly(endDate);

  const dayKeys = useMemo(() => {
    if (!startIso || !endIso) return [] as string[];
    return daysBetween(startIso, endIso);
  }, [startIso, endIso]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, TripItineraryItemSummary[]>();
    const unscheduled: TripItineraryItemSummary[] = [];
    for (const item of items) {
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
  }, [items]);

  const orphanDayKeys = useMemo(() => {
    const known = new Set(dayKeys);
    const out: string[] = [];
    for (const k of itemsByDay.map.keys()) {
      if (!known.has(k)) out.push(k);
    }
    return out.sort();
  }, [dayKeys, itemsByDay.map]);

  const allDayKeys = useMemo(() => {
    return Array.from(new Set([...orphanDayKeys, ...dayKeys])).sort();
  }, [dayKeys, orphanDayKeys]);

  const startAdd = (date: string | null) => {
    setError(null);
    setEditingId(null);
    setEditEditor(null);
    setEditor(blankEditor(date));
    if (date) {
      setAddingForDate(date);
      setAddingUnscheduled(false);
    } else {
      setAddingForDate(null);
      setAddingUnscheduled(true);
    }
  };

  const cancelAdd = () => {
    setAddingForDate(null);
    setAddingUnscheduled(false);
    setEditor(blankEditor());
    setError(null);
  };

  const submitAdd = async () => {
    setError(null);
    const description = editor.description.trim();
    if (!description) {
      setError('Description is required');
      return;
    }
    const qty = Number(editor.quantity || '1');
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }
    const unitPrice = editor.unitPrice ? Number(editor.unitPrice) : null;
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      setError('Unit price must be zero or more');
      return;
    }
    const scheduledAt = editor.date ? combineDateTime(editor.date, editor.time || null) : null;
    const durationMinutes = editor.durationMinutes ? Number(editor.durationMinutes) : null;
    const reminderMinutesBefore = editor.reminderMinutesBefore
      ? Number(editor.reminderMinutesBefore)
      : null;
    if (scheduledAt == null && reminderMinutesBefore != null) {
      setError('Reminders need a scheduled time');
      return;
    }

    setSubmitting(true);
    try {
      await onAddItem({
        description,
        scheduledAt,
        durationMinutes,
        reminderMinutesBefore,
        quantity: qty,
        unitPrice,
      });
      cancelAdd();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add item');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (item: TripItineraryItemSummary) => {
    setError(null);
    setAddingForDate(null);
    setAddingUnscheduled(false);
    setEditingId(item.id);
    setEditEditor(editorFromItem(item));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditEditor(null);
    setError(null);
  };

  const submitEdit = async () => {
    if (editingId == null || editEditor == null) return;
    setError(null);
    const description = editEditor.description.trim();
    if (!description) {
      setError('Description is required');
      return;
    }
    const qty = Number(editEditor.quantity || '1');
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }
    const unitPrice = editEditor.unitPrice ? Number(editEditor.unitPrice) : null;
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      setError('Unit price must be zero or more');
      return;
    }
    const scheduledAt = editEditor.date
      ? combineDateTime(editEditor.date, editEditor.time || null)
      : null;
    const durationMinutes = editEditor.durationMinutes
      ? Number(editEditor.durationMinutes)
      : null;
    const reminderMinutesBefore = editEditor.reminderMinutesBefore
      ? Number(editEditor.reminderMinutesBefore)
      : null;
    if (scheduledAt == null && reminderMinutesBefore != null) {
      setError('Reminders need a scheduled time');
      return;
    }

    setSubmitting(true);
    try {
      await onUpdateItem(editingId, {
        description,
        scheduledAt,
        durationMinutes,
        reminderMinutesBefore,
        quantity: qty,
        unitPrice,
      });
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update item');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleComplete = async (item: TripItineraryItemSummary) => {
    try {
      await onUpdateItem(item.id, { completed: item.completedAt === null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not toggle completion');
    }
  };

  const extendByOneDay = async () => {
    if (!onExtendEndDate) return;
    const anchor = endIso ?? startIso ?? isoDateOnly(new Date());
    if (!anchor) return;
    await onExtendEndDate(addDaysIso(anchor, 1));
  };

  const renderItemRow = (item: TripItineraryItemSummary) => {
    const isEditing = editingId === item.id;
    const isPending = pendingItemId === item.id;

    if (isEditing && editEditor) {
      return (
        <ItemEditor
          key={item.id}
          editor={editEditor}
          setEditor={setEditEditor as (e: ItemEditorState) => void}
          onSubmit={submitEdit}
          onCancel={cancelEdit}
          submitLabel="Save"
          submitting={submitting}
        />
      );
    }

    const time = formatTimeChip(item.scheduledAt);
    const isDone = item.completedAt !== null;
    return (
      <div
        key={item.id}
        className={`flex items-start gap-3 p-3 rounded-2xl border ${
          isDone ? 'bg-gray-50/60 border-gray-100' : 'bg-white border-gray-100'
        }`}
      >
        <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
          <input
            type="checkbox"
            checked={isDone}
            onChange={() => toggleComplete(item)}
            disabled={readOnly || isPending}
            className="mt-1 w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {time && (
                <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-2 py-0.5 uppercase tracking-widest">
                  {time}
                </span>
              )}
              <p
                className={`text-sm font-black truncate ${
                  isDone ? 'line-through text-gray-400' : 'text-gray-900'
                }`}
              >
                {item.description}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-1">
              {item.durationMinutes != null && <span>{item.durationMinutes} min</span>}
              {item.reminderMinutesBefore != null && (
                <span className="text-amber-700">🔔 {reminderLabel(item.reminderMinutesBefore)}</span>
              )}
              {(item.unitPrice != null || item.quantity !== 1) && (
                <span>
                  Qty {item.quantity}
                  {item.unitPrice != null && ` · ${formatMoney(item.unitPrice, currency)}`}
                </span>
              )}
              {item.sourceQuoteItemId && <span className="text-violet-600">from quote</span>}
            </div>
          </div>
        </label>
        {!readOnly && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => startEdit(item)}
              disabled={isPending}
              className="px-2 py-1 text-[10px] font-black text-gray-500 uppercase tracking-widest hover:text-gray-900"
            >
              Edit
            </button>
            {onDeleteItem && (
              <button
                type="button"
                onClick={() => onDeleteItem(item.id)}
                disabled={isPending}
                className="px-2 py-1 text-[10px] font-black text-rose-500 uppercase tracking-widest hover:text-rose-700"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Unscheduled */}
      {(itemsByDay.unscheduled.length > 0 || addingUnscheduled) && (
        <section className="rounded-2xl border border-dashed border-gray-200 p-4 bg-amber-50/30">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[10px] font-black text-amber-800 uppercase tracking-[0.3em]">
              Unscheduled
            </h4>
            {!readOnly && !addingUnscheduled && (
              <button
                type="button"
                onClick={() => startAdd(null)}
                className="text-[10px] font-black text-emerald-700 uppercase tracking-widest hover:text-emerald-900"
              >
                + Add item
              </button>
            )}
          </div>
          <div className="space-y-2">
            {itemsByDay.unscheduled.map(renderItemRow)}
            {addingUnscheduled && (
              <ItemEditor
                editor={editor}
                setEditor={setEditor}
                onSubmit={submitAdd}
                onCancel={cancelAdd}
                submitLabel="Add"
                submitting={submitting}
              />
            )}
          </div>
        </section>
      )}

      {/* Day sections */}
      {allDayKeys.length === 0 && !addingUnscheduled && itemsByDay.unscheduled.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-6">
          {readOnly
            ? 'No itinerary items yet.'
            : 'Pick start & end dates above to start scheduling items, or add an unscheduled item.'}
        </p>
      )}

      {allDayKeys.map((day) => {
        const dayItems = itemsByDay.map.get(day) ?? [];
        const isAddingHere = addingForDate === day;
        return (
          <section key={day} className="rounded-2xl border border-gray-100 p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-black text-gray-900 uppercase tracking-[0.2em]">
                {formatDayHeading(day)}
                {!dayKeys.includes(day) && (
                  <span className="ml-2 text-[9px] font-bold text-rose-500 normal-case tracking-widest">
                    outside trip range
                  </span>
                )}
              </h4>
              {!readOnly && !isAddingHere && (
                <button
                  type="button"
                  onClick={() => startAdd(day)}
                  className="text-[10px] font-black text-emerald-700 uppercase tracking-widest hover:text-emerald-900"
                >
                  + Add item
                </button>
              )}
            </div>
            <div className="space-y-2">
              {dayItems.length === 0 && !isAddingHere && (
                <p className="text-[11px] font-bold text-gray-400 text-center py-3 uppercase tracking-widest">
                  Nothing planned for this day
                </p>
              )}
              {dayItems.map(renderItemRow)}
              {isAddingHere && (
                <ItemEditor
                  editor={editor}
                  setEditor={setEditor}
                  onSubmit={submitAdd}
                  onCancel={cancelAdd}
                  submitLabel="Add"
                  submitting={submitting}
                />
              )}
            </div>
          </section>
        );
      })}

      {/* Footer actions */}
      {!readOnly && (
        <div className="flex flex-wrap gap-2 pt-2">
          {itemsByDay.unscheduled.length === 0 && !addingUnscheduled && (
            <button
              type="button"
              onClick={() => startAdd(null)}
              className="px-3 py-2 text-[10px] font-black text-gray-600 uppercase tracking-widest border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              + Add unscheduled item
            </button>
          )}
          {onExtendEndDate && (
            <button
              type="button"
              onClick={extendByOneDay}
              className="px-3 py-2 text-[10px] font-black text-emerald-700 uppercase tracking-widest border border-emerald-200 rounded-xl hover:bg-emerald-50"
            >
              + Add day
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
          {error}
        </div>
      )}
    </div>
  );
}

interface ItemEditorProps {
  editor: ItemEditorState;
  setEditor: (next: ItemEditorState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  submitting: boolean;
}

function ItemEditor({
  editor,
  setEditor,
  onSubmit,
  onCancel,
  submitLabel,
  submitting,
}: ItemEditorProps) {
  const patch = (next: Partial<ItemEditorState>) => setEditor({ ...editor, ...next });
  return (
    <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-3">
      <input
        type="text"
        placeholder="What's happening?"
        value={editor.description}
        onChange={(e) => patch({ description: e.target.value })}
        className="w-full px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
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
            className="mt-1 w-full px-2 py-2 bg-white rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500"
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
            className="mt-1 w-full px-2 py-2 bg-white rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
            Duration (min)
          </span>
          <input
            type="number"
            min="0"
            step="5"
            value={editor.durationMinutes}
            onChange={(e) => patch({ durationMinutes: e.target.value })}
            placeholder="—"
            className="mt-1 w-full px-2 py-2 bg-white rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500"
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
            className="mt-1 w-full px-2 py-2 bg-white rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          >
            {REMINDER_OPTIONS.map((opt) => (
              <option key={String(opt.value)} value={opt.value == null ? '' : String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={() => patch({ showBilling: !editor.showBilling })}
        className="text-[10px] font-black text-gray-500 uppercase tracking-widest hover:text-gray-900"
      >
        {editor.showBilling ? '− Hide billing details' : '+ Billing details'}
      </button>

      {editor.showBilling && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
              Quantity
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={editor.quantity}
              onChange={(e) => patch({ quantity: e.target.value })}
              className="mt-1 w-full px-2 py-2 bg-white rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </label>
          <label className="block">
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
              Unit price
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={editor.unitPrice}
              onChange={(e) => patch({ unitPrice: e.target.value })}
              placeholder="—"
              className="mt-1 w-full px-2 py-2 bg-white rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-3 py-2 text-[10px] font-black text-gray-600 uppercase tracking-widest hover:text-gray-900 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="px-4 py-2 text-[10px] font-black text-white bg-emerald-600 uppercase tracking-widest rounded-xl hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
