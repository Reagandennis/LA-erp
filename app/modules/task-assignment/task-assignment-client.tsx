'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';

import { addDays, dateKey, dayDiff, parseDateKey, rangeOfDays, startOfWeek } from '@/lib/date-grid';
import {
  conflictsFor,
  describeConflict,
  type Engagement,
  engagementHref,
  formatWindow,
  occupiedDays,
  type ResourceKind,
} from '@/lib/resource-availability';

import {
  ASSIGNMENT_STATUSES,
  OFFICER_GRADES,
  RESOURCE_STATUSES,
  VEHICLE_TYPES,
  type AssignmentSummary,
  type DriverSummary,
  type OfficerSummary,
  type ResourceConflict,
  type TaskAssignmentData,
  type TripOption,
  type VehicleSummary,
} from './types';
import { useSyncedState } from '@/app/ui/use-synced-state';

type Tab = 'dashboard' | 'availability' | 'assignments' | 'vehicles' | 'drivers' | 'officers';
type ResourceTab = 'vehicles' | 'drivers' | 'officers';

const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'availability', label: 'Availability' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'vehicles', label: 'Cars' },
  { key: 'drivers', label: 'Drivers' },
  { key: 'officers', label: 'Protection officers' },
];

const BRAND = '#03458f';
const ACCENT = '#f9b232';

function statusTone(status: string): string {
  switch (status) {
    case 'Available':
    case 'Confirmed':
      return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'Active':
      return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'Completed':
      return 'bg-gray-100 text-gray-600 border-gray-200';
    case 'Cancelled':
    case 'Maintenance':
    case 'Off duty':
      return 'bg-rose-50 text-rose-600 border-rose-100';
    case 'Assigned':
    case 'Planned':
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

function fieldLabel(text: string) {
  return <label className="text-xs font-semibold text-gray-500 mb-1.5 block">{text}</label>;
}

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

export default function TaskAssignmentClient({ initialData }: { initialData: TaskAssignmentData }) {
  const [data, setData] = useSyncedState<TaskAssignmentData>(initialData);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<Tab | null>(null);
  const [editAssignment, setEditAssignment] = useState<AssignmentSummary | null>(null);
  /** What the server refused on the last save: the resources that were already booked. */
  const [serverConflicts, setServerConflicts] = useState<ResourceConflict[]>([]);

  const reload = async () => {
    try {
      const res = await fetch('/api/task-assignment', { credentials: 'include' });
      if (!res.ok) return;
      const next = (await res.json()) as TaskAssignmentData;
      setData(next);
    } catch {
      // ignore
    }
  };

  const send = async (
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setServerConflicts([]);
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string; conflict?: boolean; conflicts?: ResourceConflict[] }
          | null;
        // A double booking is shown beside the pickers, not as a general error.
        if (res.status === 409 && payload?.conflicts?.length) {
          setServerConflicts(payload.conflicts);
          // The screen's data may be behind: refresh so the pickers agree with the server.
          await reload();
          return false;
        }
        setError(payload?.error ?? 'Something went wrong.');
        return false;
      }
      await reload();
      return true;
    } catch {
      setError('Network error. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Create a resource (JSON), then upload its photo (multipart) if one was picked.
  const createResource = async (kind: ResourceTab, body: Record<string, unknown>, photo: File | null): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/task-assignment/${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as { item?: { id: number }; error?: string } | null;
      if (!res.ok || !payload?.item) {
        setError(payload?.error ?? 'Could not save.');
        return false;
      }
      if (photo) {
        const fd = new FormData();
        fd.append('photo', photo);
        const up = await fetch(`/api/task-assignment/${kind}/${payload.item.id}/photo`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        });
        if (!up.ok) {
          const upErr = (await up.json().catch(() => null)) as { error?: string } | null;
          setError(`Saved, but the photo failed: ${upErr?.error ?? 'upload error'}`);
          await reload();
          return true;
        }
      }
      await reload();
      return true;
    } catch {
      setError('Network error. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Upload/replace the photo for an existing resource (from its card).
  const uploadPhoto = async (kind: ResourceTab, id: number, photo: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('photo', photo);
      const up = await fetch(`/api/task-assignment/${kind}/${id}/photo`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!up.ok) {
        const upErr = (await up.json().catch(() => null)) as { error?: string } | null;
        setError(upErr?.error ?? 'Could not upload photo.');
        return;
      }
      await reload();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const stats = data.stats;
  const statCards = [
    { label: 'Active trips', value: stats.trips },
    { label: 'Assignments', value: stats.assignments },
    { label: 'Cars free', value: stats.vehiclesAvailable },
    { label: 'Drivers free', value: stats.driversAvailable },
    { label: 'Officers free', value: stats.officersAvailable },
  ];

  const q = search.trim().toLowerCase();
  const assignmentView = useAssignmentSearch(data, q, tab === 'dashboard' || tab === 'assignments');

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Task Assignment</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Allocate cars, drivers, and close protection officers to trips.
            </p>
          </div>
          <button
            onClick={() => {
              setError(null);
              setServerConflicts([]);
              setOpenForm(tab === 'dashboard' || tab === 'availability' ? 'assignments' : tab);
            }}
            className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors"
            style={{ backgroundColor: BRAND }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {tab === 'assignments' || tab === 'dashboard' || tab === 'availability'
              ? 'New assignment'
              : `Add ${TABS.find((t) => t.key === tab)?.label.toLowerCase()}`}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
          {statCards.map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className="text-xl font-semibold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-5 bg-white border border-gray-100 rounded-2xl p-1 w-full overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 whitespace-nowrap px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                tab === t.key ? 'text-white' : 'text-gray-500 hover:text-gray-800'
              }`}
              style={tab === t.key ? { backgroundColor: BRAND } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${TABS.find((t) => t.key === tab)?.label.toLowerCase()}...`}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30"
          />
        </div>

        {tab === 'dashboard' && <Dashboard data={data} view={assignmentView} q={q} />}
        {tab === 'availability' && <AvailabilityGrid data={data} q={q} />}

        {error && (
          <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600" aria-label="Dismiss">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {tab === 'assignments' && (
          <AssignmentList
            view={assignmentView}
            q={q}
            busy={busy}
            send={send}
            onEdit={(a) => {
              setError(null);
              setServerConflicts([]);
              setEditAssignment(a);
            }}
          />
        )}
        {tab === 'vehicles' && (
          <VehicleList items={data.vehicles} q={q} busy={busy} send={send} onPhoto={(id, file) => void uploadPhoto('vehicles', id, file)} />
        )}
        {tab === 'drivers' && (
          <DriverList items={data.drivers} q={q} busy={busy} send={send} onPhoto={(id, file) => void uploadPhoto('drivers', id, file)} />
        )}
        {tab === 'officers' && (
          <OfficerList items={data.officers} q={q} busy={busy} send={send} onPhoto={(id, file) => void uploadPhoto('officers', id, file)} />
        )}
      </div>

      {/* Forms */}
      {(openForm === 'assignments' || editAssignment) && (
        <AssignmentForm
          key={editAssignment?.id ?? 'new'}
          data={data}
          busy={busy}
          error={error}
          serverConflicts={serverConflicts}
          send={send}
          existing={editAssignment}
          onClose={() => {
            setOpenForm(null);
            setEditAssignment(null);
            setError(null);
            setServerConflicts([]);
          }}
        />
      )}
      {openForm === 'vehicles' && (
        <VehicleForm busy={busy} error={error} create={createResource} onClose={() => setOpenForm(null)} />
      )}
      {openForm === 'drivers' && (
        <DriverForm busy={busy} error={error} create={createResource} onClose={() => setOpenForm(null)} />
      )}
      {openForm === 'officers' && (
        <OfficerForm busy={busy} error={error} create={createResource} onClose={() => setOpenForm(null)} />
      )}
    </div>
  );
}

type CreateResource = (kind: ResourceTab, body: Record<string, unknown>, photo: File | null) => Promise<boolean>;
type PhotoHandler = (id: number, file: File) => void;

// --- Shared bits -----------------------------------------------------------

type Sender = (url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => Promise<boolean>;


const SEARCH_DEBOUNCE_MS = 300;

/** The assignments the Dashboard and Assignments tabs show, and where they came from. */
interface AssignmentView {
  items: AssignmentSummary[];
  /** A search is typed but its results haven't arrived yet. */
  searching: boolean;
  error: string | null;
  /** Completed and cancelled assignments not loaded with the screen. */
  past: number;
}

/**
 * Completed and cancelled assignments (years of them, from FileMaker) never
 * travel with the screen: without a search the current ones show, and a
 * search (after a typing pause) asks the server to look through the history.
 */
function useAssignmentSearch(data: TaskAssignmentData, q: string, enabled: boolean): AssignmentView {
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(q), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q]);

  const [result, setResult] = useState<{ q: string; data: TaskAssignmentData; items: AssignmentSummary[] } | null>(null);
  const [failure, setFailure] = useState<{ q: string; message: string } | null>(null);
  const active = enabled && settled.length > 0;
  // Results belong to a search term and the data they were fetched alongside;
  // a reload after a save fetches them again.
  const fresh = result !== null && result.q === settled && result.data === data;
  const failed = failure?.q === settled;

  useEffect(() => {
    if (!active || fresh || failed) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/task-assignment/assignments?q=${encodeURIComponent(settled)}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const payload = (await r.json()) as { items: AssignmentSummary[] };
        if (!cancelled) setResult({ q: settled, data, items: payload.items });
      } catch {
        if (!cancelled) setFailure({ q: settled, message: "The search couldn't be run. Try again." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, fresh, failed, settled, data]);

  if (!q) return { items: data.assignments, searching: false, error: null, past: data.pastAssignments };
  return {
    items: fresh ? result.items : (result?.items ?? []),
    searching: !fresh && !failed,
    error: failed ? failure.message : null,
    past: data.pastAssignments,
  };
}

function PastAssignmentsHint({ view, q }: { view: AssignmentView; q: string }) {
  if (view.error) return <p className="mb-3 text-xs text-rose-600">{view.error}</p>;
  if (q) return view.searching ? <p className="mb-3 text-xs text-gray-400">Searching all assignments…</p> : null;
  if (view.past === 0) return null;
  return (
    <p className="mb-3 text-xs text-gray-400">
      Showing current assignments. Search to find {view.past.toLocaleString()} past ones.
    </p>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200">
      <p className="text-gray-500 text-sm">No {label} yet.</p>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <button type="button" aria-label="Close" className="fixed inset-0 z-[300] bg-gray-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[310] w-full max-w-md bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-50">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">{children}</div>
      </div>
    </>
  );
}

function SubmitButton({ busy, label, disabled = false }: { busy: boolean; label: string; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="w-full py-3 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-60"
      style={{ backgroundColor: BRAND }}
    >
      {busy ? 'Saving…' : label}
    </button>
  );
}

function RowCard({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4">{children}</div>;
}

function DeleteButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="p-2 text-gray-300 hover:text-rose-500 rounded-lg hover:bg-rose-50 disabled:opacity-50"
      title="Delete"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  );
}

function StatusSelect({ value, options, onChange, busy }: { value: string; options: readonly string[]; onChange: (v: string) => void; busy: boolean }) {
  return (
    <select
      value={value}
      disabled={busy}
      onChange={(e) => onChange(e.target.value)}
      className={`text-xs font-medium rounded-full border px-2 py-1 focus:outline-none disabled:opacity-60 ${statusTone(value)}`}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

// A square thumbnail showing the resource photo (or a fallback), with a small
// camera button overlaid to upload/replace it.
function PhotoThumb({
  kind,
  id,
  hasPhoto,
  alt,
  fallback,
  onPhoto,
  busy,
}: {
  kind: ResourceTab;
  id: number;
  hasPhoto: boolean;
  alt: string;
  fallback: React.ReactNode;
  onPhoto: PhotoHandler;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative h-12 w-12 shrink-0">
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/task-assignment/${kind}/${id}/photo`} alt={alt} className="h-12 w-12 rounded-xl object-cover" />
      ) : (
        fallback
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title={hasPhoto ? 'Change photo' : 'Add photo'}
        className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:text-[#03458f] disabled:opacity-50"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPhoto(id, f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// --- Assignments -----------------------------------------------------------

function AssignmentList({
  view,
  q,
  busy,
  send,
  onEdit,
}: {
  view: AssignmentView;
  q: string;
  busy: boolean;
  send: Sender;
  onEdit: (a: AssignmentSummary) => void;
}) {
  const items = view.items;

  const hint = <PastAssignmentsHint view={view} q={q} />;
  if (items.length === 0) {
    return (
      <>
        {hint}
        <EmptyState label={q ? 'matching assignments' : 'current assignments'} />
      </>
    );
  }

  return (
    <div className="space-y-3">
      {hint}
      {items.map((a) => (
        <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900 truncate">
                  {a.trip ? a.trip.title : 'Trip removed'}
                </span>
                {a.trip && <span className="text-xs text-gray-400">{a.trip.reference}</span>}
              </div>
              {a.trip && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {a.trip.customerName} · {formatWindow({ from: a.trip.startDate, to: a.trip.endDate })}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusSelect
                value={a.status}
                options={ASSIGNMENT_STATUSES}
                busy={busy}
                onChange={(status) => void send(`/api/task-assignment/assignments/${a.id}`, 'PATCH', { status })}
              />
              <button
                onClick={() => onEdit(a)}
                disabled={busy}
                className="p-2 text-gray-400 hover:text-[#03458f] rounded-lg hover:bg-blue-50 disabled:opacity-50"
                title="Edit assignment"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <DeleteButton busy={busy} onClick={() => void send(`/api/task-assignment/assignments/${a.id}`, 'DELETE')} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            <ResourceChip label="Car" value={a.vehicle ? `${a.vehicle.registration} · ${a.vehicle.type}` : null} />
            <ResourceChip label="Driver" value={a.driver?.name ?? null} />
            <ResourceChip label="Officer" value={a.officer ? `${a.officer.name} · ${a.officer.grade}` : null} />
          </div>
          {a.notes && <p className="text-xs text-gray-500 mt-3 border-t border-gray-50 pt-3">{a.notes}</p>}
        </div>
      ))}
    </div>
  );
}

function ResourceChip({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className={`text-sm font-medium ${value ? 'text-gray-900' : 'text-gray-300'}`}>{value ?? 'Unassigned'}</p>
    </div>
  );
}

/** Assignments in these states hold their resources; the others free them. */
const HOLDING_STATUSES = new Set(['Planned', 'Confirmed', 'Active']);

function AssignmentForm({
  data,
  busy,
  error,
  serverConflicts,
  send,
  existing,
  onClose,
}: {
  data: TaskAssignmentData;
  busy: boolean;
  error: string | null;
  serverConflicts: ResourceConflict[];
  send: Sender;
  existing?: AssignmentSummary | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    tripId: existing?.tripId ?? data.trips[0]?.id ?? 0,
    vehicleId: existing?.vehicle?.id ?? 0,
    driverId: existing?.driver?.id ?? 0,
    officerId: existing?.officer?.id ?? 0,
    status: existing?.status ?? 'Planned',
    notes: existing?.notes ?? '',
  });

  // When editing a trip that is no longer in the active list (e.g. completed),
  // keep it selectable so the assignment can still be edited.
  const tripOptions: TripOption[] = [...data.trips];
  if (existing?.trip && !tripOptions.some((t) => t.id === existing.trip!.id)) {
    tripOptions.unshift(existing.trip);
  }

  // Who is already booked on the chosen trip's days. Worked out here from the
  // same rules the server applies, so the prompt appears as soon as a busy
  // car or person is picked rather than after a failed save.
  const trip = tripOptions.find((t) => t.id === form.tripId) ?? null;
  const window = { from: trip?.startDate ?? null, to: trip?.endDate ?? null };
  const holds = HOLDING_STATUSES.has(form.status);
  const clashes = (kind: ResourceKind, resourceId: number): Engagement[] =>
    holds && resourceId && trip
      ? conflictsFor(data.engagements, {
          kind,
          resourceId,
          tripId: trip.id,
          window,
          excludeAssignmentId: existing?.id ?? null,
        })
      : [];
  const busyNote = (kind: ResourceKind, id: number): string => {
    const found = clashes(kind, id);
    return found.length > 0 ? ` — busy ${formatWindow(found[0]!)} on ${found[0]!.reference}` : '';
  };
  const picked = {
    vehicle: {
      id: form.vehicleId,
      label: (() => {
        const v = data.vehicles.find((x) => x.id === form.vehicleId);
        return v ? `Car ${v.registration}` : 'This car';
      })(),
    },
    driver: {
      id: form.driverId,
      label: (() => {
        const d = data.drivers.find((x) => x.id === form.driverId);
        return d ? `Driver ${d.name}` : 'This driver';
      })(),
    },
    officer: {
      id: form.officerId,
      label: (() => {
        const o = data.officers.find((x) => x.id === form.officerId);
        return o ? `Officer ${o.name}` : 'This officer';
      })(),
    },
  };
  /** The prompt under a picker: what we can see locally, or what the server just refused. */
  const noticeFor = (kind: ResourceKind): string | null => {
    const { id, label } = picked[kind];
    if (!id) return null;
    const local = clashes(kind, id);
    if (local.length > 0) return describeConflict(label, kind, local);
    const refused = serverConflicts.find((c) => c.kind === kind && c.resourceId === id);
    return refused?.message ?? null;
  };
  const notices = { vehicle: noticeFor('vehicle'), driver: noticeFor('driver'), officer: noticeFor('officer') };
  const blocked = Boolean(notices.vehicle || notices.driver || notices.officer);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked) return;
    const payload = {
      tripId: form.tripId || undefined,
      vehicleId: form.vehicleId || null,
      driverId: form.driverId || null,
      officerId: form.officerId || null,
      status: form.status,
      notes: form.notes || null,
    };
    const ok = existing
      ? await send(`/api/task-assignment/assignments/${existing.id}`, 'PATCH', payload)
      : await send('/api/task-assignment/assignments', 'POST', payload);
    if (ok) onClose();
  };

  return (
    <Modal title={existing ? 'Edit assignment' : 'New assignment'} onClose={onClose}>
      {!existing && tripOptions.length === 0 ? (
        <p className="text-sm text-gray-500">
          There are no active trips to assign to. Create a trip in Trip Planning first.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            {fieldLabel('Trip')}
            <select className={inputClass} value={form.tripId} onChange={(e) => setForm({ ...form, tripId: Number(e.target.value) })}>
              {tripOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.reference} — {t.title} ({t.customerName})
                </option>
              ))}
            </select>
            {trip && (
              <p className="mt-1.5 text-xs text-gray-500">
                {trip.startDate && trip.endDate
                  ? `Occupies ${formatWindow(window)}. Busy cars and people are marked in the lists below.`
                  : 'This trip has no dates yet, so anyone booked elsewhere counts as busy until it does.'}
              </p>
            )}
          </div>
          <div>
            {fieldLabel('Car')}
            <select
              className={`${inputClass} ${notices.vehicle ? 'border-amber-300 bg-amber-50/40' : ''}`}
              value={form.vehicleId}
              onChange={(e) => setForm({ ...form, vehicleId: Number(e.target.value) })}
            >
              <option value={0}>— None —</option>
              {data.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registration} · {v.type} {v.status !== 'Available' ? `(${v.status})` : ''}
                  {busyNote('vehicle', v.id)}
                </option>
              ))}
            </select>
            <ConflictNotice message={notices.vehicle} />
          </div>
          <div>
            {fieldLabel('Driver')}
            <select
              className={`${inputClass} ${notices.driver ? 'border-amber-300 bg-amber-50/40' : ''}`}
              value={form.driverId}
              onChange={(e) => setForm({ ...form, driverId: Number(e.target.value) })}
            >
              <option value={0}>— None —</option>
              {data.drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.status !== 'Available' ? `(${d.status})` : ''}
                  {busyNote('driver', d.id)}
                </option>
              ))}
            </select>
            <ConflictNotice message={notices.driver} />
          </div>
          <div>
            {fieldLabel('Close protection officer')}
            <select
              className={`${inputClass} ${notices.officer ? 'border-amber-300 bg-amber-50/40' : ''}`}
              value={form.officerId}
              onChange={(e) => setForm({ ...form, officerId: Number(e.target.value) })}
            >
              <option value={0}>— None —</option>
              {data.officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.grade} {o.status !== 'Available' ? `(${o.status})` : ''}
                  {busyNote('officer', o.id)}
                </option>
              ))}
            </select>
            <ConflictNotice message={notices.officer} />
          </div>
          <div>
            {fieldLabel('Status')}
            <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {ASSIGNMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            {fieldLabel('Notes (optional)')}
            <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <p className="text-xs text-gray-400">Assign at least one of car, driver, or officer.</p>
          {error && <p className="text-xs text-rose-500">{error}</p>}
          {blocked && (
            <p className="text-xs font-medium text-amber-700">
              Someone picked above is not available on these dates. Choose another before saving.
            </p>
          )}
          <SubmitButton busy={busy} disabled={blocked} label={existing ? 'Save changes' : 'Create assignment'} />
        </form>
      )}
    </Modal>
  );
}

/** The prompt under a picker when its choice is already booked elsewhere. */
function ConflictNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span>{message}</span>
    </div>
  );
}

// --- Availability: who is booked on which days ------------------------------

/** How many days are on screen at once, and how wide one day is for each. */
const SCALES = [
  { days: 14, col: 64, label: '2 weeks' },
  { days: 28, col: 40, label: '4 weeks' },
  { days: 56, col: 26, label: '8 weeks' },
] as const;
const LABEL_W = 232;
const LANE_H = 30;
const ROW_PAD = 8;

type GridRow = { kind: ResourceKind; id: number; label: string; sub: string | null; status: string };

/** One booking drawn across the columns it covers, in the lane it was given. */
type Bar = { engagement: Engagement; start: number; end: number; lane: number };

/**
 * Lay a resource's bookings out as bars: clipped to the visible days, merged
 * when they are the same trip and source, and stacked into lanes so two trips
 * on one day sit one under the other instead of hiding each other.
 */
function barsFor(engagements: Engagement[], kind: ResourceKind, id: number, gridStart: Date, days: number): Bar[] {
  const spans = new Map<string, { engagement: Engagement; start: number; end: number }>();
  for (const e of engagements) {
    if (e.kind !== kind || e.resourceId !== id || !e.from || !e.to) continue;
    const from = parseDateKey(e.from);
    const to = parseDateKey(e.to);
    if (!from || !to) continue;
    const start = Math.max(0, dayDiff(gridStart, from));
    const end = Math.min(days - 1, dayDiff(gridStart, to));
    if (end < 0 || start > days - 1 || end < start) continue;
    const key = `${e.tripId}:${e.source}:${e.itemId ?? ''}`;
    const existing = spans.get(key);
    if (existing) {
      existing.start = Math.min(existing.start, start);
      existing.end = Math.max(existing.end, end);
    } else {
      spans.set(key, { engagement: e, start, end });
    }
  }
  const sorted = [...spans.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  const laneEnds: number[] = [];
  return sorted.map((span) => {
    let lane = laneEnds.findIndex((endAt) => endAt < span.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(span.end);
    } else {
      laneEnds[lane] = span.end;
    }
    return { ...span, lane };
  });
}

/** "Nov 2026" bands across the day header, one per month in view. */
function monthBands(days: Date[]): Array<{ label: string; span: number }> {
  const bands: Array<{ label: string; span: number }> = [];
  for (const d of days) {
    const label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const last = bands[bands.length - 1];
    if (last && last.label === label) last.span++;
    else bands.push({ label, span: 1 });
  }
  return bands;
}

function AvailabilityGrid({ data, q }: { data: TaskAssignmentData; q: string }) {
  const [scaleIndex, setScaleIndex] = useState(1);
  const scale = SCALES[scaleIndex]!;
  const [start, setStart] = useState(() => startOfWeek(new Date()));
  /** Show only cars and people with a booking in the days on screen. */
  const [bookedOnly, setBookedOnly] = useState(false);
  const days = useMemo(() => rangeOfDays(start, scale.days), [start, scale.days]);
  const keys = useMemo(() => days.map(dateKey), [days]);
  const today = dateKey(new Date());
  const todayIndex = keys.indexOf(today);
  const bands = useMemo(() => monthBands(days), [days]);

  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const booked = (kind: ResourceKind, id: number) => !bookedOnly || occupiedDays(data.engagements, kind, id, keys).size > 0;
  const allSections: Array<{ title: string; rows: GridRow[] }> = [
    {
      title: 'Cars',
      rows: data.vehicles
        .filter((v) => matches([v.registration, v.make, v.model, v.type].filter(Boolean).join(' ')))
        .map((v) => ({ kind: 'vehicle', id: v.id, label: v.registration, sub: [v.make, v.model].filter(Boolean).join(' ') || v.type, status: v.status })),
    },
    {
      title: 'Drivers',
      rows: data.drivers.filter((d) => matches(d.name)).map((d) => ({ kind: 'driver', id: d.id, label: d.name, sub: d.phone, status: d.status })),
    },
    {
      title: 'Protection officers',
      rows: data.officers
        .filter((o) => matches([o.name, o.callSign, o.grade].filter(Boolean).join(' ')))
        .map((o) => ({ kind: 'officer', id: o.id, label: o.name, sub: [o.grade, o.callSign].filter(Boolean).join(' · '), status: o.status })),
    },
  ];
  const sections = allSections.map((s) => ({ ...s, rows: s.rows.filter((r) => booked(r.kind, r.id)) }));
  const total = sections.reduce((n, s) => n + s.rows.length, 0);

  // Free today: not booked on today's date and not out of service.
  const freeToday = allSections.map((s) => ({
    title: s.title,
    free: s.rows.filter((r) => r.status === 'Available' && occupiedDays(data.engagements, r.kind, r.id, [today]).size === 0).length,
    total: s.rows.length,
  }));

  const rangeLabel = formatWindow({ from: keys[0]!, to: keys[keys.length - 1]! });
  const trackWidth = scale.days * scale.col;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-gray-200 bg-white p-0.5">
            <button type="button" onClick={() => setStart((s) => addDays(s, -7))} className="rounded-lg px-2.5 py-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="Previous week">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button type="button" onClick={() => setStart(startOfWeek(new Date()))} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100">
              Today
            </button>
            <button type="button" onClick={() => setStart((s) => addDays(s, 7))} className="rounded-lg px-2.5 py-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="Next week">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
          <span className="text-sm font-semibold text-gray-900">{rangeLabel}</span>
          <div role="radiogroup" aria-label="Days on screen" className="ml-1 flex items-center gap-1 rounded-xl bg-gray-100 p-0.5">
            {SCALES.map((s, i) => (
              <button
                key={s.days}
                type="button"
                role="radio"
                aria-checked={i === scaleIndex}
                onClick={() => setScaleIndex(i)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${i === scaleIndex ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          {freeToday.map((f) => (
            <span key={f.title} className="inline-flex items-baseline gap-1">
              <span className="text-base font-bold text-gray-900">{f.free}</span>
              <span>/ {f.total} {f.title.toLowerCase()} free today</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-md" style={{ backgroundColor: BRAND }} /> Trip allocation</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-md" style={{ backgroundColor: ACCENT }} /> Itinerary event</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-md bg-[repeating-linear-gradient(135deg,#e5e7eb_0,#e5e7eb_3px,#f9fafb_3px,#f9fafb_6px)]" /> Out of service</span>
        <span className="text-gray-400">Click a bar to open the trip on that event.</span>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-gray-600">
          <input type="checkbox" checked={bookedOnly} onChange={(e) => setBookedOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300" />
          Only booked in this period
        </label>
      </div>

      {total === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center text-sm text-gray-500">
          {bookedOnly ? 'Nobody is booked between these dates.' : q ? 'No matching cars or people.' : 'No cars or people to plan yet.'}
        </div>
      ) : (
        <div className="relative max-h-[70vh] overflow-auto rounded-2xl border border-gray-200 bg-white shadow-[0_10px_30px_-20px_rgba(15,23,42,0.25)]">
          <div style={{ minWidth: LABEL_W + trackWidth }}>
            {/* Header: month bands over day cells */}
            <div className="sticky top-0 z-30 flex bg-white/95 backdrop-blur">
              <div className="sticky left-0 z-40 flex shrink-0 items-end border-b border-r border-gray-200 bg-white px-4 pb-2" style={{ width: LABEL_W }}>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Resource</span>
              </div>
              <div style={{ width: trackWidth }}>
                <div className="flex border-b border-gray-100" style={{ height: 22 }}>
                  {bands.map((b) => (
                    <div key={b.label} className="flex items-center overflow-hidden border-r border-gray-200 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 last:border-r-0" style={{ width: b.span * scale.col }}>
                      <span className="truncate">{b.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex border-b border-gray-200" style={{ height: 44 }}>
                  {days.map((d, i) => {
                    const weekend = d.getDay() === 0 || d.getDay() === 6;
                    const isToday = i === todayIndex;
                    return (
                      <div key={keys[i]} className={`flex shrink-0 flex-col items-center justify-center border-r border-gray-100 last:border-r-0 ${weekend ? 'bg-gray-50' : ''}`} style={{ width: scale.col }}>
                        <span className={`text-[9px] font-medium uppercase ${isToday ? 'text-[#03458f]' : weekend ? 'text-gray-400' : 'text-gray-500'}`}>
                          {d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, scale.col < 30 ? 1 : 3)}
                        </span>
                        <span className={`mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold ${isToday ? 'text-white' : weekend ? 'text-gray-400' : 'text-gray-800'}`} style={isToday ? { backgroundColor: BRAND } : undefined}>
                          {d.getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Rows */}
            {sections
              .filter((s) => s.rows.length > 0)
              .map((s) => (
                <React.Fragment key={s.title}>
                  <div className="flex">
                    <div className="sticky left-0 z-20 shrink-0 border-b border-r border-gray-100 bg-gray-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500" style={{ width: LABEL_W }}>
                      {s.title}
                      <span className="ml-1.5 font-medium normal-case tracking-normal text-gray-400">{s.rows.length}</span>
                    </div>
                    <div className="border-b border-gray-100 bg-gray-50" style={{ width: trackWidth }} />
                  </div>
                  {s.rows.map((r) => (
                    <AvailabilityRow key={`${r.kind}-${r.id}`} row={r} days={days} gridStart={start} col={scale.col} todayIndex={todayIndex} engagements={data.engagements} />
                  ))}
                </React.Fragment>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AvailabilityRow({
  row,
  days,
  gridStart,
  col,
  todayIndex,
  engagements,
}: {
  row: GridRow;
  days: Date[];
  gridStart: Date;
  col: number;
  todayIndex: number;
  engagements: Engagement[];
}) {
  const bars = useMemo(() => barsFor(engagements, row.kind, row.id, gridStart, days.length), [engagements, row.kind, row.id, gridStart, days.length]);
  const lanes = Math.max(1, ...bars.map((b) => b.lane + 1));
  const height = lanes * LANE_H + ROW_PAD;
  const outOfService = row.status !== 'Available' && row.status !== 'Assigned';
  const trackWidth = days.length * col;

  return (
    <div className="group flex" style={{ height }}>
      <div className="sticky left-0 z-20 flex shrink-0 items-center gap-3 border-b border-r border-gray-100 bg-white px-4 group-hover:bg-gray-50" style={{ width: LABEL_W }}>
        <ResourceAvatar row={row} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{row.label}</p>
          {row.sub && <p className="truncate text-[11px] text-gray-400">{row.sub}</p>}
        </div>
        {outOfService && (
          <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusTone(row.status)}`}>{row.status}</span>
        )}
      </div>
      <div className="relative border-b border-gray-100" style={{ width: trackWidth }}>
        {/* Day cells */}
        <div className="absolute inset-0 flex" aria-hidden="true">
          {days.map((d, i) => {
            const weekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div
                key={i}
                className={`h-full shrink-0 border-r border-gray-100 last:border-r-0 ${i === todayIndex ? 'bg-blue-50/60' : weekend ? 'bg-gray-50/70' : ''} ${
                  outOfService ? 'bg-[repeating-linear-gradient(135deg,#e5e7eb_0,#e5e7eb_3px,#f9fafb_3px,#f9fafb_6px)]' : ''
                }`}
                style={{ width: col }}
              />
            );
          })}
        </div>
        {todayIndex >= 0 && <div className="pointer-events-none absolute inset-y-0 z-[1] w-px" style={{ left: todayIndex * col + col / 2, backgroundColor: BRAND, opacity: 0.35 }} aria-hidden="true" />}
        {/* Bookings */}
        {bars.map((b) => {
          const e = b.engagement;
          const movement = e.source === 'movement';
          const width = (b.end - b.start + 1) * col - 6;
          const label = `${e.reference} · ${e.title} (${formatWindow(e)})`;
          return (
            <Link
              key={`${e.tripId}-${e.source}-${e.itemId ?? 'trip'}-${b.start}`}
              href={engagementHref(e)}
              title={`${label}\nOpen the trip${e.itemId ? ' on this event' : ''}`}
              className="absolute z-[2] flex items-center gap-1.5 overflow-hidden rounded-lg px-2 text-[11px] font-semibold shadow-sm ring-1 ring-black/5 transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-1"
              style={{
                left: b.start * col + 3,
                top: ROW_PAD / 2 + b.lane * LANE_H,
                width,
                height: LANE_H - 6,
                backgroundColor: movement ? ACCENT : BRAND,
                color: movement ? '#3b2a05' : '#fff',
              }}
            >
              {movement && width >= 60 && (
                <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6v6l4 2" />
                  <circle cx="12" cy="12" r="9" strokeWidth={2} />
                </svg>
              )}
              <span className="truncate">{width > 90 ? label : e.reference}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** A small badge for the row: a car glyph, or the person's initials. */
function ResourceAvatar({ row }: { row: GridRow }) {
  if (row.kind === 'vehicle') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: BRAND }}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 13l2-5a2 2 0 011.9-1.3h10.2A2 2 0 0119 8l2 5m-18 0h18m-18 0v4a1 1 0 001 1h1a1 1 0 001-1v-1m14 1v-4m0 4a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1M6 16h.01M18 16h.01" />
        </svg>
      </span>
    );
  }
  const initials = row.label
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white" style={{ backgroundColor: row.kind === 'driver' ? ACCENT : BRAND }}>
      {initials || '?'}
    </span>
  );
}

// --- Vehicles --------------------------------------------------------------

function VehicleList({ items, q, busy, send, onPhoto }: { items: VehicleSummary[]; q: string; busy: boolean; send: Sender; onPhoto: PhotoHandler }) {
  const filtered = items.filter((v) =>
    !q ? true : [v.registration, v.make, v.model, v.type].filter(Boolean).join(' ').toLowerCase().includes(q),
  );
  if (filtered.length === 0) return <EmptyState label="cars" />;
  return (
    <div className="space-y-3">
      {filtered.map((v) => (
        <RowCard key={v.id}>
          <PhotoThumb
            kind="vehicles"
            id={v.id}
            hasPhoto={v.hasPhoto}
            alt={v.registration}
            busy={busy}
            onPhoto={onPhoto}
            fallback={
              <div className="flex h-12 w-12 items-center justify-center rounded-xl text-white" style={{ backgroundColor: BRAND }}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 13l2-5a2 2 0 011.9-1.3h10.2A2 2 0 0119 8l2 5m-18 0h18m-18 0v4a1 1 0 001 1h1a1 1 0 001-1v-1m14 1v-4m0 4a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1M6 16h.01M18 16h.01" />
                </svg>
              </div>
            }
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">{v.registration}</p>
            <p className="text-xs text-gray-500 truncate">
              {[v.make, v.model].filter(Boolean).join(' ') || v.type}
              {v.capacity ? ` · ${v.capacity} seats` : ''}
            </p>
          </div>
          <span className="text-xs text-gray-400 hidden sm:block">{v.type}</span>
          <StatusSelect value={v.status} options={RESOURCE_STATUSES} busy={busy} onChange={(status) => void send(`/api/task-assignment/vehicles/${v.id}`, 'PATCH', { status })} />
          <DeleteButton busy={busy} onClick={() => void send(`/api/task-assignment/vehicles/${v.id}`, 'DELETE')} />
        </RowCard>
      ))}
    </div>
  );
}

function VehicleForm({ busy, error, create, onClose }: { busy: boolean; error: string | null; create: CreateResource; onClose: () => void }) {
  const [form, setForm] = useState({ registration: '', make: '', model: '', type: 'Sedan', capacity: '', status: 'Available', notes: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await create(
      'vehicles',
      {
        registration: form.registration,
        make: form.make || null,
        model: form.model || null,
        type: form.type,
        capacity: form.capacity ? Number(form.capacity) : null,
        status: form.status,
        notes: form.notes || null,
      },
      photo,
    );
    if (ok) onClose();
  };
  return (
    <Modal title="Add car" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <PhotoField label="Car photo" file={photo} onChange={setPhoto} />
        <div>
          {fieldLabel('Registration / plate')}
          <input className={inputClass} value={form.registration} onChange={(e) => setForm({ ...form, registration: e.target.value })} placeholder="KAA 123A" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            {fieldLabel('Make')}
            <input className={inputClass} value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} placeholder="Toyota" />
          </div>
          <div>
            {fieldLabel('Model')}
            <input className={inputClass} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Land Cruiser" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            {fieldLabel('Type')}
            <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            {fieldLabel('Capacity')}
            <input className={inputClass} type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="Seats" />
          </div>
        </div>
        <div>
          {fieldLabel('Status')}
          <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {RESOURCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          {fieldLabel('Notes (optional)')}
          <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {error && <p className="text-xs text-rose-500">{error}</p>}
        <SubmitButton busy={busy} label="Add car" />
      </form>
    </Modal>
  );
}

// --- Drivers ---------------------------------------------------------------

function DriverList({ items, q, busy, send, onPhoto }: { items: DriverSummary[]; q: string; busy: boolean; send: Sender; onPhoto: PhotoHandler }) {
  const filtered = items.filter((d) => (!q ? true : [d.name, d.phone, d.licenseNumber].filter(Boolean).join(' ').toLowerCase().includes(q)));
  if (filtered.length === 0) return <EmptyState label="drivers" />;
  return (
    <div className="space-y-3">
      {filtered.map((d) => (
        <RowCard key={d.id}>
          <PhotoThumb
            kind="drivers"
            id={d.id}
            hasPhoto={d.hasPhoto}
            alt={d.name}
            busy={busy}
            onPhoto={onPhoto}
            fallback={
              <div className="flex h-12 w-12 items-center justify-center rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: ACCENT }}>
                {d.name.slice(0, 2).toUpperCase()}
              </div>
            }
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">{d.name}</p>
            <p className="text-xs text-gray-500 truncate">
              {[d.phone, d.licenseNumber].filter(Boolean).join(' · ') || 'No contact on file'}
            </p>
          </div>
          <StatusSelect value={d.status} options={RESOURCE_STATUSES} busy={busy} onChange={(status) => void send(`/api/task-assignment/drivers/${d.id}`, 'PATCH', { status })} />
          <DeleteButton busy={busy} onClick={() => void send(`/api/task-assignment/drivers/${d.id}`, 'DELETE')} />
        </RowCard>
      ))}
    </div>
  );
}

function DriverForm({ busy, error, create, onClose }: { busy: boolean; error: string | null; create: CreateResource; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', licenseNumber: '', status: 'Available', notes: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await create(
      'drivers',
      {
        name: form.name,
        phone: form.phone || null,
        licenseNumber: form.licenseNumber || null,
        status: form.status,
        notes: form.notes || null,
      },
      photo,
    );
    if (ok) onClose();
  };
  return (
    <Modal title="Add driver" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <PhotoField label="Driver photo" file={photo} onChange={setPhoto} />
        <div>
          {fieldLabel('Full name')}
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Driver name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            {fieldLabel('Phone')}
            <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+254…" />
          </div>
          <div>
            {fieldLabel('License no.')}
            <input className={inputClass} value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} />
          </div>
        </div>
        <div>
          {fieldLabel('Status')}
          <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {RESOURCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          {fieldLabel('Notes (optional)')}
          <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {error && <p className="text-xs text-rose-500">{error}</p>}
        <SubmitButton busy={busy} label="Add driver" />
      </form>
    </Modal>
  );
}

// --- Officers --------------------------------------------------------------

function OfficerList({ items, q, busy, send, onPhoto }: { items: OfficerSummary[]; q: string; busy: boolean; send: Sender; onPhoto: PhotoHandler }) {
  const filtered = items.filter((o) => (!q ? true : [o.name, o.callSign, o.grade, o.phone].filter(Boolean).join(' ').toLowerCase().includes(q)));
  if (filtered.length === 0) return <EmptyState label="protection officers" />;
  return (
    <div className="space-y-3">
      {filtered.map((o) => (
        <RowCard key={o.id}>
          <PhotoThumb
            kind="officers"
            id={o.id}
            hasPhoto={o.hasPhoto}
            alt={o.name}
            busy={busy}
            onPhoto={onPhoto}
            fallback={
              <div className="flex h-12 w-12 items-center justify-center rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: BRAND }}>
                {o.name.slice(0, 2).toUpperCase()}
              </div>
            }
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">
              {o.name}
              {o.callSign && <span className="text-xs text-gray-400 font-normal"> · {o.callSign}</span>}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {o.grade}
              {o.phone ? ` · ${o.phone}` : ''}
            </p>
          </div>
          <StatusSelect value={o.status} options={RESOURCE_STATUSES} busy={busy} onChange={(status) => void send(`/api/task-assignment/officers/${o.id}`, 'PATCH', { status })} />
          <DeleteButton busy={busy} onClick={() => void send(`/api/task-assignment/officers/${o.id}`, 'DELETE')} />
        </RowCard>
      ))}
    </div>
  );
}

function OfficerForm({ busy, error, create, onClose }: { busy: boolean; error: string | null; create: CreateResource; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', callSign: '', grade: 'CPO', phone: '', status: 'Available', notes: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await create(
      'officers',
      {
        name: form.name,
        callSign: form.callSign || null,
        grade: form.grade,
        phone: form.phone || null,
        status: form.status,
        notes: form.notes || null,
      },
      photo,
    );
    if (ok) onClose();
  };
  return (
    <Modal title="Add protection officer" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <PhotoField label="Officer photo" file={photo} onChange={setPhoto} />
        <div>
          {fieldLabel('Full name')}
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Officer name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            {fieldLabel('Call sign')}
            <input className={inputClass} value={form.callSign} onChange={(e) => setForm({ ...form, callSign: e.target.value })} placeholder="Alpha-1" />
          </div>
          <div>
            {fieldLabel('Grade')}
            <select className={inputClass} value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>
              {OFFICER_GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          {fieldLabel('Phone')}
          <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+254…" />
        </div>
        <div>
          {fieldLabel('Status')}
          <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {RESOURCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          {fieldLabel('Notes (optional)')}
          <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {error && <p className="text-xs text-rose-500">{error}</p>}
        <SubmitButton busy={busy} label="Add officer" />
      </form>
    </Modal>
  );
}

// --- Photo upload field (forms) --------------------------------------------

function PhotoField({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const pick = (f: File | null) => {
    onChange(f);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  };
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50 text-gray-400 hover:border-[#03458f]/50 hover:text-[#03458f]"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="truncate text-xs text-gray-400">{file ? file.name : 'JPG or PNG · optional'}</p>
        {file && (
          <button type="button" onClick={() => pick(null)} className="mt-0.5 text-xs font-medium text-rose-500 hover:text-rose-700">
            Remove
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
    </div>
  );
}

// --- Dashboard: resources flowing into their trip --------------------------

function Dashboard({ data, view, q }: { data: TaskAssignmentData; view: AssignmentView; q: string }) {
  const vById = new Map(data.vehicles.map((v) => [v.id, v]));
  const dById = new Map(data.drivers.map((d) => [d.id, d]));
  const oById = new Map(data.officers.map((o) => [o.id, o]));

  const items = view.items;

  if (items.length === 0) {
    return (
      <>
        <PastAssignmentsHint view={view} q={q} />
        <EmptyState label={q ? 'matching assignments' : 'current assignments to visualise'} />
      </>
    );
  }

  const carFallback = (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ backgroundColor: BRAND }}>
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 13l2-5a2 2 0 011.9-1.3h10.2A2 2 0 0119 8l2 5m-18 0h18m-18 0v4a1 1 0 001 1h1a1 1 0 001-1v-1m14 1v-4m0 4a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1M6 16h.01M18 16h.01" />
      </svg>
    </div>
  );

  return (
    <div className="space-y-4">
      {items.map((a) => {
        const resources: {
          key: string;
          kind: ResourceTab;
          id: number;
          label: string;
          sub: string;
          hasPhoto: boolean;
          fallback: React.ReactNode;
        }[] = [];
        if (a.vehicle) {
          resources.push({
            key: 'car',
            kind: 'vehicles',
            id: a.vehicle.id,
            label: a.vehicle.registration,
            sub: `Car · ${a.vehicle.type}`,
            hasPhoto: vById.get(a.vehicle.id)?.hasPhoto ?? false,
            fallback: carFallback,
          });
        }
        if (a.driver) {
          resources.push({
            key: 'driver',
            kind: 'drivers',
            id: a.driver.id,
            label: a.driver.name,
            sub: 'Driver',
            hasPhoto: dById.get(a.driver.id)?.hasPhoto ?? false,
            fallback: (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: ACCENT }}>
                {a.driver.name.slice(0, 2).toUpperCase()}
              </div>
            ),
          });
        }
        if (a.officer) {
          resources.push({
            key: 'officer',
            kind: 'officers',
            id: a.officer.id,
            label: a.officer.name,
            sub: `CPO · ${a.officer.grade}`,
            hasPhoto: oById.get(a.officer.id)?.hasPhoto ?? false,
            fallback: (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: BRAND }}>
                {a.officer.name.slice(0, 2).toUpperCase()}
              </div>
            ),
          });
        }

        return (
          <div key={a.id} className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
              <div className="flex-1 space-y-3">
                {resources.length === 0 ? (
                  <p className="text-sm text-gray-400">No resources on this assignment yet.</p>
                ) : (
                  resources.map((r) => (
                    <div key={r.key} className="flex items-center gap-3">
                      <MiniResource kind={r.kind} id={r.id} hasPhoto={r.hasPhoto} label={r.label} sub={r.sub} fallback={r.fallback} />
                      <FlowArrow />
                    </div>
                  ))
                )}
              </div>
              <TripNode trip={a.trip} status={a.status} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MiniResource({
  kind,
  id,
  hasPhoto,
  label,
  sub,
  fallback,
}: {
  kind: ResourceTab;
  id: number;
  hasPhoto: boolean;
  label: string;
  sub: string;
  fallback: React.ReactNode;
}) {
  return (
    <div className="flex w-40 shrink-0 items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 sm:w-48">
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/task-assignment/${kind}/${id}/photo`} alt={label} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : (
        fallback
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-gray-900">{label}</p>
        <p className="truncate text-xs text-gray-500">{sub}</p>
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex min-w-[36px] flex-1 items-center" aria-hidden>
      <div className="ta-arrow-line h-0.5 flex-1 rounded" />
      <svg className="ta-pulse -ml-1 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" style={{ color: BRAND }}>
        <path d="M9 6l6 6-6 6z" />
      </svg>
    </div>
  );
}

function TripNode({
  trip,
  status,
}: {
  trip: AssignmentSummary['trip'];
  status: string;
}) {
  return (
    <div className="flex shrink-0 items-center sm:w-72">
      <div className="w-full rounded-xl border-2 bg-white px-4 py-3" style={{ borderColor: BRAND }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold" style={{ color: BRAND }}>
            {trip ? trip.reference : 'Trip removed'}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(status)}`}>{status}</span>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-gray-900">{trip ? trip.title : '—'}</p>
        {trip && <p className="truncate text-xs text-gray-500">{trip.customerName}</p>}
      </div>
    </div>
  );
}
