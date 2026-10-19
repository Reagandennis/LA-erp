'use client';

import { APP_LOCALE } from '@/lib/locale';
import React, { useMemo, useRef, useState } from 'react';

import type { ContactSummary, CustomerOption } from '@/lib/contacts';

import GoogleImportButton from './google-import-button';

const BRAND = '#03458f';
const ACCENT = '#f9b232';

const CATEGORIES = ['Internal', 'Client', 'Vendor', 'Partner'] as const;
type Category = (typeof CATEGORIES)[number];

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

// A restrained avatar tint, derived from the name so it is stable per person.
const AVATAR_TINTS = ['#03458f', '#f9b232', '#2563eb', '#0891b2', '#6366f1', '#475569'];
function avatarTint(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
/** The deep-linked contact id, or null when it isn't one the user can see. */
function knownContactId(id: number | null | undefined, contacts: ContactSummary[]) {
  return id != null && contacts.some((c) => c.id === id) ? id : null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type ContactForm = {
  name: string;
  role: string;
  category: string;
  email: string;
  phone: string;
  location: string;
  notes: string;
  tags: string;
  customerId: string;
};

const EMPTY_FORM: ContactForm = {
  name: '',
  role: '',
  category: 'Client',
  email: '',
  phone: '',
  location: '',
  notes: '',
  tags: '',
  customerId: '',
};

export default function ContactsClient({
  initialContacts,
  initialCustomers,
  initialOpenId,
}: {
  initialContacts: ContactSummary[];
  initialCustomers: CustomerOption[];
  /** Contact to open on arrival (`?open=<id>`, e.g. from global search). */
  initialOpenId?: number | null;
}) {
  const [contacts, setContacts] = useState<ContactSummary[]>(initialContacts);
  const [customers] = useState<CustomerOption[]>(initialCustomers);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<Category | 'All'>('All');
  const [selectedId, setSelectedId] = useState<number | null>(() =>
    knownContactId(initialOpenId, initialContacts),
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoVersion, setPhotoVersion] = useState<Record<number, number>>({});

  // A deep link that changes while we're mounted opens that contact's drawer
  // the way clicking its card does (adjusted during render). Any open form is
  // closed first, as it would be before a card could be clicked, so an edit
  // can't be saved onto the newly selected contact. Unknown ids (no access,
  // deleted) are ignored.
  const [openId, setOpenId] = useState(initialOpenId ?? null);
  if (openId !== (initialOpenId ?? null)) {
    setOpenId(initialOpenId ?? null);
    const target = knownContactId(initialOpenId, contacts);
    if (target !== null) {
      setFormOpen(false);
      setPendingPhoto(null);
      setPhotoPreview(null);
      setSelectedId(target);
    }
  }

  const selected = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId],
  );

  const refresh = async () => {
    try {
      const res = await fetch('/api/contacts', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.contacts)) setContacts(data.contacts as ContactSummary[]);
    } catch {
      /* keep current data on transient failure */
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (categoryFilter !== 'All' && c.category !== categoryFilter) return false;
      if (!q) return true;
      return [c.name, c.role, c.email, c.phone, c.location, c.customer?.name, c.customer?.company, ...c.tags]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [contacts, search, categoryFilter]);

  const stats = useMemo(
    () =>
      (['All', ...CATEGORIES] as const).map((cat) => ({
        label: cat === 'All' ? 'Total contacts' : cat,
        value: cat === 'All' ? contacts.length : contacts.filter((c) => c.category === cat).length,
      })),
    [contacts],
  );

  const photoUrl = (c: ContactSummary) =>
    `/api/contacts/${c.id}/photo${photoVersion[c.id] ? `?v=${photoVersion[c.id]}` : ''}`;

  // --- Form helpers ---------------------------------------------------------

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setPendingPhoto(null);
    setPhotoPreview(null);
    setEditing(false);
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (c: ContactSummary) => {
    setForm({
      name: c.name,
      role: c.role ?? '',
      category: c.category,
      email: c.email ?? '',
      phone: c.phone ?? '',
      location: c.location ?? '',
      notes: c.notes ?? '',
      tags: c.tags.join(', '),
      customerId: c.customer ? String(c.customer.id) : '',
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

  const uploadPhoto = async (id: number, file: File): Promise<void> => {
    const fd = new FormData();
    fd.append('photo', file);
    const res = await fetch(`/api/contacts/${id}/photo`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
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

    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const body = {
      name: form.name.trim(),
      role: form.role.trim() || null,
      category: form.category,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      tags,
      customerId: form.customerId ? Number(form.customerId) : null,
    };

    try {
      if (editing && selectedId) {
        const res = await fetch(`/api/contacts/${selectedId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          setError(err?.error ?? 'Could not update the contact.');
          setBusy(false);
          return;
        }
        if (pendingPhoto) await uploadPhoto(selectedId, pendingPhoto);
      } else {
        const res = await fetch('/api/contacts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.item) {
          setError(payload?.error ?? 'Could not add the contact.');
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

  const removeContact = async (id: number) => {
    if (!window.confirm('Delete this contact? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setError(err?.error ?? 'Could not delete the contact.');
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
            <h1 className="text-2xl font-semibold text-gray-900">Contacts</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Operational contacts, teams, and external relationships.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            <GoogleImportButton onImported={setContacts} />
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95"
              style={{ backgroundColor: BRAND }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add contact
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
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
              placeholder="Search name, role, company, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30"
            />
          </div>
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 overflow-x-auto">
            {(['All', ...CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  categoryFilter === c ? 'text-white' : 'text-gray-500 hover:bg-gray-50'
                }`}
                style={categoryFilter === c ? { backgroundColor: BRAND } : undefined}
              >
                {c}
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
            <p className="text-gray-900 font-medium">No contacts found</p>
            <p className="text-gray-500 text-sm mt-1">
              {contacts.length === 0 ? 'Add your first contact to get started.' : 'Try a different search or filter.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="text-left bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#03458f]/40 hover:shadow-sm transition-all"
              >
                <div className="flex items-start gap-4">
                  <Avatar contact={c} src={c.hasPhoto ? photoUrl(c) : null} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-gray-900 truncate">{c.name}</p>
                      <CategoryBadge category={c.category} />
                    </div>
                    <p className="text-sm text-gray-500 truncate mt-0.5">{c.role || '—'}</p>
                    {c.customer && (
                      <p className="text-xs text-gray-400 truncate mt-1">
                        {c.customer.company || c.customer.name}
                      </p>
                    )}
                    {c.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {c.tags.slice(0, 3).map((t) => (
                          <span key={t} className="px-2 py-0.5 bg-gray-50 rounded-md border border-gray-100 text-xs text-gray-500">
                            {t}
                          </span>
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

      {/* Add / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Edit contact' : 'Add contact'}</h2>
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
                <Label>Name *</Label>
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Full name"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Role / title</Label>
                  <input
                    className={inputClass}
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    placeholder="e.g. Procurement Manager"
                  />
                </div>
                <div>
                  <Label>Category</Label>
                  <select
                    className={inputClass}
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label>Linked client</Label>
                <select
                  className={inputClass}
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                >
                  <option value="">No linked client</option>
                  {customers.map((cust) => (
                    <option key={cust.id} value={cust.id}>
                      {cust.company ? `${cust.name} — ${cust.company}` : cust.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Email</Label>
                  <input
                    type="email"
                    className={inputClass}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="name@example.com"
                  />
                </div>
                <div>
                  <Label>Phone</Label>
                  <input
                    className={inputClass}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+254 …"
                  />
                </div>
              </div>

              <div>
                <Label>Location</Label>
                <input
                  className={inputClass}
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="City, country"
                />
              </div>

              <div>
                <Label>Tags</Label>
                <input
                  className={inputClass}
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="Comma separated, e.g. Key client, High priority"
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
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Add contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-[220]" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-[230] overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">Contact details</h2>
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
              <div className="flex items-center gap-4">
                <Avatar contact={selected} src={selected.hasPhoto ? photoUrl(selected) : null} size={64} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold text-gray-900 truncate">{selected.name}</h3>
                  </div>
                  <p className="text-sm text-gray-500">{selected.role || '—'}</p>
                  <div className="mt-1.5">
                    <CategoryBadge category={selected.category} />
                  </div>
                </div>
              </div>

              {selected.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.tags.map((t) => (
                    <span key={t} className="px-2.5 py-1 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-600">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <DetailRow label="Email" value={selected.email} href={selected.email ? `mailto:${selected.email}` : null} />
                <DetailRow label="Phone" value={selected.phone} href={selected.phone ? `tel:${selected.phone}` : null} />
                <DetailRow label="Location" value={selected.location} />
                <DetailRow
                  label="Client"
                  value={selected.customer ? selected.customer.company || selected.customer.name : null}
                />
              </div>

              {selected.notes && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">Notes</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}

              <p className="text-xs text-gray-400">Added {new Date(selected.createdAt).toLocaleDateString(APP_LOCALE)}</p>
            </div>

            <div className="p-6 border-t border-gray-100 sticky bottom-0 bg-white flex gap-3">
              <button
                onClick={() => removeContact(selected.id)}
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
                Edit contact
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

function CategoryBadge({ category }: { category: string }) {
  const tint = category === 'Client' ? ACCENT : BRAND;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-gray-500 shrink-0"
      title={category}
    >
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tint }} />
      {category}
    </span>
  );
}

function DetailRow({ label, value, href }: { label: string; value: string | null; href?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      {value ? (
        href ? (
          <a href={href} className="text-sm font-medium text-[#03458f] hover:underline truncate">
            {value}
          </a>
        ) : (
          <span className="text-sm font-medium text-gray-900 truncate">{value}</span>
        )
      ) : (
        <span className="text-sm text-gray-300">—</span>
      )}
    </div>
  );
}

function Avatar({ contact, src, size }: { contact: ContactSummary; src: string | null; size: number }) {
  const dim = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={contact.name} className="rounded-xl object-cover shrink-0" style={dim} />;
  }
  return (
    <div
      className="flex items-center justify-center rounded-xl text-white font-semibold shrink-0"
      style={{ ...dim, backgroundColor: avatarTint(contact.name), fontSize: size / 2.8 }}
    >
      {initials(contact.name)}
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
