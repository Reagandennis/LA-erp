'use client';

import React, { useMemo, useRef, useState } from 'react';

import type { VehicleSummary } from '@/lib/task-assignment';

const BRAND = '#03458f';
const ACCENT = '#f9b232';

const VEHICLE_TYPES = ['Sedan', 'SUV', 'Van', 'Truck', 'Armoured', 'Motorcycle'] as const;
const STATUSES = ['Available', 'Assigned', 'Maintenance', 'Off duty'] as const;

type Status = (typeof STATUSES)[number];

// Minimalist status indicator colour (a dot, not a loud pill).
const STATUS_DOT: Record<string, string> = {
  Available: 'bg-green-500',
  Assigned: BRAND,
  Maintenance: ACCENT,
  'Off duty': 'bg-gray-300',
};

function statusDotStyle(status: string): { className: string; style?: React.CSSProperties } {
  const v = STATUS_DOT[status];
  if (!v) return { className: 'bg-gray-300' };
  return v.startsWith('bg-') ? { className: v } : { className: '', style: { backgroundColor: v } };
}

type VehicleForm = {
  registration: string;
  make: string;
  model: string;
  type: string;
  status: string;
  capacity: string;
  notes: string;
};

const EMPTY_FORM: VehicleForm = {
  registration: '',
  make: '',
  model: '',
  type: 'Sedan',
  status: 'Available',
  capacity: '',
  notes: '',
};

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

export default function VehiclesClient({ initialVehicles }: { initialVehicles: VehicleSummary[] }) {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>(initialVehicles);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'All'>('All');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bust the browser cache after a photo is replaced.
  const [photoVersion, setPhotoVersion] = useState<Record<number, number>>({});

  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? null,
    [vehicles, selectedId],
  );

  const refresh = async () => {
    try {
      const res = await fetch('/api/task-assignment', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.vehicles)) setVehicles(data.vehicles as VehicleSummary[]);
    } catch {
      /* keep current data on transient failure */
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter((v) => {
      const matchesStatus = statusFilter === 'All' || v.status === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return [v.registration, v.make, v.model, v.type]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [vehicles, search, statusFilter]);

  const stats = useMemo(
    () => [
      { label: 'Total fleet', value: vehicles.length },
      { label: 'Available', value: vehicles.filter((v) => v.status === 'Available').length },
      { label: 'Assigned', value: vehicles.filter((v) => v.status === 'Assigned').length },
      { label: 'In maintenance', value: vehicles.filter((v) => v.status === 'Maintenance').length },
    ],
    [vehicles],
  );

  const photoUrl = (v: VehicleSummary) =>
    `/api/task-assignment/vehicles/${v.id}/photo${photoVersion[v.id] ? `?v=${photoVersion[v.id]}` : ''}`;

  // --- Form helpers ---------------------------------------------------------

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setPendingPhoto(null);
    setPhotoPreview(null);
    setEditing(false);
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (v: VehicleSummary) => {
    setForm({
      registration: v.registration,
      make: v.make ?? '',
      model: v.model ?? '',
      type: v.type,
      status: v.status,
      capacity: v.capacity != null ? String(v.capacity) : '',
      notes: v.notes ?? '',
    });
    setPendingPhoto(null);
    setPhotoPreview(null);
    setEditing(true);
    setError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setPendingPhoto(null);
    setPhotoPreview(null);
  };

  const pickPhoto = (file: File | null) => {
    setPendingPhoto(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  const uploadPhoto = async (id: number, file: File): Promise<boolean> => {
    const fd = new FormData();
    fd.append('photo', file);
    const res = await fetch(`/api/task-assignment/vehicles/${id}/photo`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.error ?? 'The photo could not be uploaded.');
      return false;
    }
    setPhotoVersion((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    return true;
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.registration.trim()) {
      setError('Registration / plate is required.');
      return;
    }
    setBusy(true);
    setError(null);

    const body = {
      registration: form.registration.trim(),
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      type: form.type,
      status: form.status,
      capacity: form.capacity.trim() ? Number(form.capacity) : null,
      notes: form.notes.trim() || null,
    };

    try {
      if (editing && selectedId) {
        const res = await fetch(`/api/task-assignment/vehicles/${selectedId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          setError(err?.error ?? 'Could not update the vehicle.');
          setBusy(false);
          return;
        }
        if (pendingPhoto) await uploadPhoto(selectedId, pendingPhoto);
      } else {
        const res = await fetch('/api/task-assignment/vehicles', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.item) {
          setError(payload?.error ?? 'Could not add the vehicle.');
          setBusy(false);
          return;
        }
        if (pendingPhoto) await uploadPhoto(payload.item.id, pendingPhoto);
      }
      await refresh();
      closeForm();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const removeVehicle = async (id: number) => {
    if (!window.confirm('Delete this vehicle? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/task-assignment/vehicles/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setError(err?.error ?? 'Could not delete the vehicle.');
        return;
      }
      setSelectedId(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // --- Render ---------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Vehicles</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Manage fleet information, status, and assignment readiness.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95"
            style={{ backgroundColor: BRAND }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add vehicle
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          {stats.map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className="text-xl font-semibold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <svg
              className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search registration, make, model…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30"
            />
          </div>
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 overflow-x-auto">
            {(['All', ...STATUSES] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  statusFilter === s ? 'text-white' : 'text-gray-500 hover:bg-gray-50'
                }`}
                style={statusFilter === s ? { backgroundColor: BRAND } : undefined}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Error banner */}
        {error && !formOpen && (
          <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
            <p className="flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600" aria-label="Dismiss">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-900 font-medium">No vehicles found</p>
            <p className="text-gray-500 text-sm mt-1">
              {vehicles.length === 0 ? 'Add your first vehicle to get started.' : 'Try a different search or filter.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((v) => {
              const dot = statusDotStyle(v.status);
              return (
                <button
                  key={v.id}
                  onClick={() => setSelectedId(v.id)}
                  className="text-left bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#03458f]/40 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start gap-4">
                    {v.hasPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl(v)}
                        alt={v.registration}
                        className="h-14 w-14 rounded-xl object-cover shrink-0"
                      />
                    ) : (
                      <div
                        className="flex h-14 w-14 items-center justify-center rounded-xl text-white shrink-0"
                        style={{ backgroundColor: BRAND }}
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13l1.5-4.5A2 2 0 016.4 7h11.2a2 2 0 011.9 1.5L21 13m-18 0v4a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-4m-18 0h18M7 16.5h.01M17 16.5h.01" />
                        </svg>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-gray-900 truncate">{v.registration}</p>
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
                          <span className={`w-2 h-2 rounded-full ${dot.className}`} style={dot.style} />
                          {v.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 truncate mt-0.5">
                        {[v.make, v.model].filter(Boolean).join(' ') || '—'}
                      </p>
                      <div className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                        <span className="px-2 py-0.5 bg-gray-50 rounded-md border border-gray-100">{v.type}</span>
                        {v.capacity != null && (
                          <span className="px-2 py-0.5 bg-gray-50 rounded-md border border-gray-100">
                            {v.capacity} seats
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Edit vehicle' : 'Add vehicle'}</h2>
              <button onClick={closeForm} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={submitForm} className="p-6 space-y-4">
              {error && (
                <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">{error}</div>
              )}

              <PhotoPicker
                preview={photoPreview}
                existingUrl={editing && selected?.hasPhoto ? photoUrl(selected) : null}
                onPick={pickPhoto}
              />

              <div>
                <Label>Registration / plate *</Label>
                <input
                  className={inputClass}
                  value={form.registration}
                  onChange={(e) => setForm({ ...form, registration: e.target.value })}
                  placeholder="e.g. KDA 123A"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Make</Label>
                  <input
                    className={inputClass}
                    value={form.make}
                    onChange={(e) => setForm({ ...form, make: e.target.value })}
                    placeholder="Toyota"
                  />
                </div>
                <div>
                  <Label>Model</Label>
                  <input
                    className={inputClass}
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="Land Cruiser"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <select
                    className={inputClass}
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <select
                    className={inputClass}
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label>Capacity (seats)</Label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                  placeholder="Optional"
                />
              </div>

              <div>
                <Label>Notes</Label>
                <textarea
                  rows={3}
                  className={inputClass}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                  style={{ backgroundColor: BRAND }}
                >
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Add vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <>
          <div
            className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-40"
            onClick={() => setSelectedId(null)}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">Vehicle details</h2>
              <button
                onClick={() => setSelectedId(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 flex-1 space-y-6">
              {selected.hasPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl(selected)}
                  alt={selected.registration}
                  className="w-full h-44 rounded-2xl object-cover border border-gray-100"
                />
              ) : (
                <div
                  className="w-full h-44 rounded-2xl flex items-center justify-center text-white"
                  style={{ backgroundColor: BRAND }}
                >
                  <svg className="w-16 h-16 opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2} d="M3 13l1.5-4.5A2 2 0 016.4 7h11.2a2 2 0 011.9 1.5L21 13m-18 0v4a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-4m-18 0h18M7 16.5h.01M17 16.5h.01" />
                  </svg>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-semibold text-gray-900">{selected.registration}</h3>
                  {(() => {
                    const dot = statusDotStyle(selected.status);
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                        <span className={`w-2 h-2 rounded-full ${dot.className}`} style={dot.style} />
                        {selected.status}
                      </span>
                    );
                  })()}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {[selected.make, selected.model].filter(Boolean).join(' ') || 'No make / model on file'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Type" value={selected.type} />
                <Field label="Capacity" value={selected.capacity != null ? `${selected.capacity} seats` : '—'} />
              </div>

              <div>
                <p className="text-xs text-gray-400 mb-1.5">Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.notes || '—'}</p>
              </div>

              <p className="text-xs text-gray-400">
                Added {new Date(selected.createdAt).toLocaleDateString()}
              </p>
            </div>

            <div className="p-6 border-t border-gray-100 sticky bottom-0 bg-white flex gap-3">
              <button
                onClick={() => removeVehicle(selected.id)}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl border border-rose-200 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                onClick={() => openEdit(selected)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm"
                style={{ backgroundColor: BRAND }}
              >
                Edit vehicle
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-gray-500 mb-1.5 block">{children}</label>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl border border-gray-100 p-3.5">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}

function PhotoPicker({
  preview,
  existingUrl,
  onPick,
}: {
  preview: string | null;
  existingUrl: string | null;
  onPick: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = preview ?? existingUrl;
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50 text-gray-400 hover:border-[#03458f]/50 hover:text-[#03458f]"
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="h-full w-full object-cover" />
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      </button>
      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-sm font-semibold text-[#03458f] hover:underline"
        >
          {shown ? 'Change photo' : 'Add photo'}
        </button>
        {shown && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="block text-xs text-gray-400 hover:text-gray-600 mt-1"
          >
            Remove selection
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
