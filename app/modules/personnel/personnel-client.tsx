'use client';

import React, { useMemo, useRef, useState } from 'react';

import type { PersonnelSummary, UserOption } from '@/lib/personnel';

const BRAND = '#03458f';

const DEPARTMENTS = ['Operations', 'Human Resources', 'Finance', 'Sales', 'Administration', 'Security', 'IT'] as const;
const STATUSES = ['Active', 'On Leave', 'Remote', 'Terminated'] as const;

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

const STATUS_DOT: Record<string, string> = {
  Active: 'bg-green-500',
  'On Leave': 'bg-amber-500',
  Remote: 'bg-blue-400',
  Terminated: 'bg-gray-300',
};

const AVATAR_TINTS = ['#03458f', '#2563eb', '#0891b2', '#6366f1', '#475569', '#0284c7'];
function avatarTint(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

type Props = {
  isAdmin: boolean;
  initialItems: PersonnelSummary[];
  initialUsers: UserOption[];
};

type Form = {
  name: string;
  email: string;
  phone: string;
  role: string;
  department: string;
  status: string;
  location: string;
  manager: string;
  joinDate: string;
  skills: string;
  notes: string;
  userId: string;
};

const EMPTY_FORM: Form = {
  name: '', email: '', phone: '', role: '', department: 'Operations', status: 'Active',
  location: '', manager: '', joinDate: '', skills: '', notes: '', userId: '',
};

export default function PersonnelClient({ isAdmin, initialItems, initialUsers }: Props) {
  const [items, setItems] = useState<PersonnelSummary[]>(initialItems);
  const [users, setUsers] = useState<UserOption[]>(initialUsers);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoVersion, setPhotoVersion] = useState<Record<number, number>>({});

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  const refresh = async () => {
    try {
      const res = await fetch('/api/personnel', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.items)) setItems(data.items as PersonnelSummary[]);
      if (Array.isArray(data.users)) setUsers(data.users as UserOption[]);
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      if (deptFilter !== 'All' && p.department !== deptFilter) return false;
      if (statusFilter !== 'All' && p.status !== statusFilter) return false;
      if (!q) return true;
      return [p.name, p.role, p.email, p.department, p.manager, p.location, ...p.skills]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [items, search, deptFilter, statusFilter]);

  const stats = [
    { label: 'Total staff', value: items.length },
    { label: 'Active', value: items.filter((p) => p.status === 'Active').length },
    { label: 'On leave', value: items.filter((p) => p.status === 'On Leave').length },
    { label: 'Remote', value: items.filter((p) => p.status === 'Remote').length },
  ];

  const photoUrl = (p: PersonnelSummary) =>
    `/api/personnel/${p.id}/photo${photoVersion[p.id] ? `?v=${photoVersion[p.id]}` : ''}`;

  // --- Form -----------------------------------------------------------------

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setPendingPhoto(null);
    setPhotoPreview(null);
    setEditing(false);
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (p: PersonnelSummary) => {
    setForm({
      name: p.name,
      email: p.email ?? '',
      phone: p.phone ?? '',
      role: p.role ?? '',
      department: p.department,
      status: p.status,
      location: p.location ?? '',
      manager: p.manager ?? '',
      joinDate: p.joinDate ? p.joinDate.slice(0, 10) : '',
      skills: p.skills.join(', '),
      notes: p.notes ?? '',
      userId: p.user ? String(p.user.id) : '',
    });
    setPendingPhoto(null);
    setPhotoPreview(null);
    setEditing(true);
    setError(null);
    setFormOpen(true);
  };

  const pickPhoto = (file: File | null) => {
    setPendingPhoto(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  const uploadPhoto = async (id: number, file: File) => {
    const fd = new FormData();
    fd.append('photo', file);
    const res = await fetch(`/api/personnel/${id}/photo`, { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.error ?? 'The photo could not be uploaded.');
      return;
    }
    setPhotoVersion((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      role: form.role.trim() || null,
      department: form.department,
      status: form.status,
      location: form.location.trim() || null,
      manager: form.manager.trim() || null,
      joinDate: form.joinDate || null,
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      notes: form.notes.trim() || null,
      userId: form.userId ? Number(form.userId) : null,
    };
    try {
      if (editing && selectedId) {
        const res = await fetch(`/api/personnel/${selectedId}`, {
          method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          setError(payload?.error ?? 'Could not update.');
          setBusy(false);
          return;
        }
        if (pendingPhoto) await uploadPhoto(selectedId, pendingPhoto);
      } else {
        const res = await fetch('/api/personnel', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.item) {
          setError(payload?.error ?? 'Could not add personnel.');
          setBusy(false);
          return;
        }
        if (pendingPhoto) await uploadPhoto(payload.item.id, pendingPhoto);
      }
      await refresh();
      setFormOpen(false);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Remove this personnel record? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/personnel/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setSelectedId(null);
        await refresh();
      }
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
            <h1 className="text-2xl font-semibold text-gray-900">Personnel</h1>
            <p className="text-gray-500 mt-1 text-sm">Manage team records, workforce details, and assignments.</p>
          </div>
          {isAdmin && (
            <button onClick={openCreate} className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95" style={{ backgroundColor: BRAND }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add personnel
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {stats.map((s) => (
            <div key={s.label} className="bg-white p-4 rounded-2xl border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className="text-xl font-semibold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search name, role, skills…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30" />
          </div>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30">
            <option value="All">All departments</option>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30">
            <option value="All">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-900 font-medium">{items.length === 0 ? 'No personnel yet' : 'No matching records'}</p>
            <p className="text-gray-500 text-sm mt-1">
              {items.length === 0 ? (isAdmin ? 'Add your first team member to get started.' : 'No personnel have been added yet.') : 'Try a different search or filter.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <button key={p.id} onClick={() => setSelectedId(p.id)} className="text-left bg-white rounded-2xl p-5 border border-gray-100 hover:border-[#03458f]/40 hover:shadow-sm transition-all">
                <div className="flex items-start gap-4">
                  <Avatar person={p} src={p.hasPhoto ? photoUrl(p) : null} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-gray-900 truncate">{p.name}</p>
                      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
                        <span className={`w-2 h-2 rounded-full ${STATUS_DOT[p.status] ?? 'bg-gray-300'}`} />
                        {p.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 truncate mt-0.5">{p.role || '—'}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                      <span className="px-2 py-0.5 bg-gray-50 rounded-md border border-gray-100">{p.department}</span>
                      {p.user && <span className="text-[#03458f]">· has login</span>}
                    </div>
                    {p.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {p.skills.slice(0, 3).map((s) => (
                          <span key={s} className="px-2 py-0.5 bg-gray-50 rounded-md border border-gray-100 text-xs text-gray-500">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-40" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold text-gray-900">Personnel details</h2>
              <button onClick={() => setSelectedId(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 flex-1 space-y-6">
              <div className="flex items-center gap-4">
                <Avatar person={selected} src={selected.hasPhoto ? photoUrl(selected) : null} size={64} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold text-gray-900 truncate">{selected.name}</h3>
                  </div>
                  <p className="text-sm text-gray-500">{selected.role || '—'}</p>
                  <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                    <span className={`w-2 h-2 rounded-full ${STATUS_DOT[selected.status] ?? 'bg-gray-300'}`} />
                    {selected.status} · {selected.department}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <Row label="Email" value={selected.email} href={selected.email ? `mailto:${selected.email}` : null} />
                <Row label="Phone" value={selected.phone} href={selected.phone ? `tel:${selected.phone}` : null} />
                <Row label="Location" value={selected.location} />
                <Row label="Manager" value={selected.manager} />
                <Row label="Joined" value={selected.joinDate ? formatDate(selected.joinDate) : null} />
                <Row label="Login account" value={selected.user ? `${selected.user.name} (${selected.user.email})` : 'Not linked'} />
              </div>

              {selected.skills.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.skills.map((s) => (
                      <span key={s} className="px-2.5 py-1 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-600">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {selected.notes && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">Notes</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="p-6 border-t border-gray-100 sticky bottom-0 bg-white flex gap-3">
                <button onClick={() => remove(selected.id)} disabled={busy} className="px-4 py-2.5 rounded-xl border border-rose-200 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                  Delete
                </button>
                <button onClick={() => openEdit(selected)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: BRAND }}>
                  Edit
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Create / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Edit personnel' : 'Add personnel'}</h2>
              <button onClick={() => setFormOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={submitForm} className="p-6 space-y-4">
              {error && <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">{error}</div>}

              <PhotoPicker preview={photoPreview} existingUrl={editing && selected?.hasPhoto ? photoUrl(selected) : null} onPick={pickPhoto} />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Name *</Label>
                  <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" autoFocus />
                </div>
                <div>
                  <Label>Role / title</Label>
                  <input className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g. Team Leader" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Department</Label>
                  <select className={inputClass} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Email</Label>
                  <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
                </div>
                <div>
                  <Label>Phone</Label>
                  <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+254 …" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Location</Label>
                  <input className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, country" />
                </div>
                <div>
                  <Label>Manager</Label>
                  <input className={inputClass} value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} placeholder="Reports to" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Join date</Label>
                  <input type="date" className={inputClass} value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} />
                </div>
                <div>
                  <Label>Linked login account</Label>
                  <select className={inputClass} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                    <option value="">No login account</option>
                    {users.map((u) => {
                      const takenElsewhere = u.linkedToId != null && u.linkedToId !== selectedId;
                      return (
                        <option key={u.id} value={u.id} disabled={takenElsewhere}>
                          {u.name} ({u.email}){takenElsewhere ? ' — linked' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div>
                <Label>Skills</Label>
                <input className={inputClass} value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="Comma separated, e.g. First aid, Driving, Firearms" />
              </div>

              <div>
                <Label>Notes</Label>
                <textarea rows={2} className={`${inputClass} resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setFormOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: BRAND }}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Add personnel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-gray-500 mb-1.5 block">{children}</label>;
}

function Row({ label, value, href }: { label: string; value: string | null; href?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      {value ? (
        href ? (
          <a href={href} className="text-sm font-medium text-[#03458f] hover:underline truncate">{value}</a>
        ) : (
          <span className="text-sm font-medium text-gray-900 truncate">{value}</span>
        )
      ) : (
        <span className="text-sm text-gray-300">—</span>
      )}
    </div>
  );
}

function Avatar({ person, src, size }: { person: PersonnelSummary; src: string | null; size: number }) {
  const dim = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={person.name} className="rounded-xl object-cover shrink-0" style={dim} />;
  }
  return (
    <div className="flex items-center justify-center rounded-xl text-white font-semibold shrink-0" style={{ ...dim, backgroundColor: avatarTint(person.name), fontSize: size / 2.8 }}>
      {initials(person.name)}
    </div>
  );
}

function PhotoPicker({ preview, existingUrl, onPick }: { preview: string | null; existingUrl: string | null; onPick: (file: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = preview ?? existingUrl;
  return (
    <div className="flex items-center gap-4">
      <button type="button" onClick={() => inputRef.current?.click()} className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50 text-gray-400 hover:border-[#03458f]/50 hover:text-[#03458f]">
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
        <button type="button" onClick={() => inputRef.current?.click()} className="text-sm font-semibold text-[#03458f] hover:underline">
          {shown ? 'Change photo' : 'Add photo'}
        </button>
        {shown && (
          <button type="button" onClick={() => onPick(null)} className="block text-xs text-gray-400 hover:text-gray-600 mt-1">Remove selection</button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </div>
  );
}
