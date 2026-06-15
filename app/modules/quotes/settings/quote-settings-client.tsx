'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { BrandProfileSummary } from '@/lib/brand-profiles';
import type { OrganizationSummary } from '@/lib/organization';

type Tab = 'defaults' | 'brands';

interface Props {
  initialOrganization: OrganizationSummary;
  initialBrandProfiles: BrandProfileSummary[];
}

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];

export default function QuoteSettingsClient({
  initialOrganization,
  initialBrandProfiles,
}: Props) {
  const [tab, setTab] = useState<Tab>('defaults');

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              Quote Settings
            </h1>
            <p className="text-gray-500 mt-1 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
              Defaults, terms, and brand profiles for the quote builder
            </p>
          </div>
          <Link
            href="/modules/quotes"
            className="self-start px-4 py-2 border-2 border-gray-200 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-100"
          >
            Back to quotes
          </Link>
        </div>

        <div className="flex items-center gap-2 mb-6">
          <TabButton active={tab === 'defaults'} onClick={() => setTab('defaults')}>
            Defaults
          </TabButton>
          <TabButton active={tab === 'brands'} onClick={() => setTab('brands')}>
            Brand profiles
          </TabButton>
        </div>

        {tab === 'defaults' ? (
          <DefaultsTab initial={initialOrganization} />
        ) : (
          <BrandProfilesTab initial={initialBrandProfiles} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition ${
        active ? 'bg-primary text-white shadow' : 'text-gray-400 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

function DefaultsTab({ initial }: { initial: OrganizationSummary }) {
  const [companyName, setCompanyName] = useState(initial.companyName ?? '');
  const [defaultCurrency, setDefaultCurrency] = useState(initial.defaultCurrency);
  const [defaultTaxRatePct, setDefaultTaxRatePct] = useState(
    String(Math.round((initial.defaultTaxRate ?? 0) * 10000) / 100),
  );
  const [taxLabel, setTaxLabel] = useState(initial.taxLabel);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [website, setWebsite] = useState(initial.website ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/admin/organization', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName || null,
          defaultCurrency,
          defaultTaxRate: Number(defaultTaxRatePct) / 100,
          taxLabel,
          phone: phone || null,
          email: email || null,
          website: website || null,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setError(data?.error ?? 'Could not save defaults');
        return;
      }
      setMessage('Defaults saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Company name">
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Default currency">
          <select
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value)}
            className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default tax rate (%)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={defaultTaxRatePct}
            onChange={(e) => setDefaultTaxRatePct(e.target.value)}
            className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Tax label">
          <input
            value={taxLabel}
            onChange={(e) => setTaxLabel(e.target.value)}
            className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Contact email">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Contact phone">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Website">
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
          />
        </Field>
      </div>
      {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
      {message && <p className="text-sm font-bold text-primary">{message}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save defaults'}
        </button>
      </div>
      <p className="text-[11px] text-gray-500">
        These defaults apply when no brand profile is selected. Per-profile addresses,
        logos, and colors live under <strong>Brand profiles</strong>.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
        {label}
      </label>
      {children}
    </div>
  );
}

function BrandProfilesTab({ initial }: { initial: BrandProfileSummary[] }) {
  const router = useRouter();
  const [profiles, setProfiles] = useState(initial);
  const [editing, setEditing] = useState<BrandProfileSummary | null>(null);
  const [showNew, setShowNew] = useState(false);

  const refresh = async () => {
    const response = await fetch('/api/quotes/brand-profiles', { credentials: 'include' });
    const data = (await response.json().catch(() => null)) as
      | { profiles?: BrandProfileSummary[] }
      | null;
    if (data?.profiles) setProfiles(data.profiles);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-600">
          Each profile carries its own logo, color, and contact block printed on the PDF.
        </p>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="px-4 py-2 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary/90"
        >
          New profile
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {profiles.map((profile) => (
          <BrandProfileCard
            key={profile.id}
            profile={profile}
            onEdit={() => setEditing(profile)}
            onRefresh={refresh}
          />
        ))}
      </div>

      {showNew && (
        <BrandProfileForm
          initial={null}
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            refresh();
          }}
        />
      )}
      {editing && (
        <BrandProfileForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function BrandProfileCard({
  profile,
  onEdit,
  onRefresh,
}: {
  profile: BrandProfileSummary;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const handleSetDefault = async () => {
    await fetch(`/api/quotes/brand-profiles/${profile.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    });
    onRefresh();
  };

  const handleArchiveToggle = async () => {
    await fetch(`/api/quotes/brand-profiles/${profile.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: !profile.archived }),
    });
    onRefresh();
  };

  const handleDelete = async () => {
    if (!confirm(`Delete brand profile "${profile.name}"?`)) return;
    await fetch(`/api/quotes/brand-profiles/${profile.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    onRefresh();
  };

  return (
    <div
      className={`rounded-2xl border p-5 bg-white shadow-sm ${
        profile.archived ? 'opacity-60' : ''
      }`}
      style={{ borderColor: profile.primaryColor + '33' }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden"
          style={{ backgroundColor: profile.primaryColor }}
        >
          {profile.hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/quotes/brand-profiles/${profile.id}/logo`}
              alt=""
              className="w-full h-full object-contain bg-white"
            />
          ) : (
            <span className="text-white text-lg font-black">
              {profile.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-black text-gray-900 truncate">{profile.name}</p>
            {profile.isDefault && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-primary/5 text-primary">
                Default
              </span>
            )}
            {profile.archived && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-gray-100 text-gray-500">
                Archived
              </span>
            )}
          </div>
          {profile.companyName && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{profile.companyName}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-1 font-mono">{profile.primaryColor}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          onClick={onEdit}
          className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          Edit
        </button>
        {!profile.isDefault && !profile.archived && (
          <button
            type="button"
            onClick={handleSetDefault}
            className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-primary/5 text-primary rounded-lg hover:bg-primary/10"
          >
            Set default
          </button>
        )}
        <button
          type="button"
          onClick={handleArchiveToggle}
          className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          {profile.archived ? 'Restore' : 'Archive'}
        </button>
        {!profile.isDefault && (
          <button
            type="button"
            onClick={handleDelete}
            className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function BrandProfileForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: BrandProfileSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    companyName: initial?.companyName ?? '',
    addressLine1: initial?.addressLine1 ?? '',
    addressLine2: initial?.addressLine2 ?? '',
    city: initial?.city ?? '',
    region: initial?.region ?? '',
    postalCode: initial?.postalCode ?? '',
    country: initial?.country ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    website: initial?.website ?? '',
    primaryColor: initial?.primaryColor ?? '#03458f',
    isDefault: initial?.isDefault ?? false,
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<typeof form>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        companyName: form.companyName || null,
        addressLine1: form.addressLine1 || null,
        addressLine2: form.addressLine2 || null,
        city: form.city || null,
        region: form.region || null,
        postalCode: form.postalCode || null,
        country: form.country || null,
        email: form.email || '',
        phone: form.phone || null,
        website: form.website || null,
        primaryColor: form.primaryColor,
        isDefault: form.isDefault,
      };

      const url = initial
        ? `/api/quotes/brand-profiles/${initial.id}`
        : '/api/quotes/brand-profiles';
      const method = initial ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { profile?: BrandProfileSummary; error?: string }
        | null;
      if (!response.ok || !data?.profile) {
        setError(data?.error ?? 'Could not save profile');
        return;
      }

      if (logoFile) {
        const formData = new FormData();
        formData.append('logo', logoFile);
        const logoResponse = await fetch(
          `/api/quotes/brand-profiles/${data.profile.id}/logo`,
          { method: 'POST', credentials: 'include', body: formData },
        );
        if (!logoResponse.ok) {
          const logoData = (await logoResponse.json().catch(() => null)) as
            | { error?: string }
            | null;
          setError(logoData?.error ?? 'Profile saved but logo upload failed');
          return;
        }
      }

      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleClearLogo = async () => {
    if (!initial) return;
    await fetch(`/api/quotes/brand-profiles/${initial.id}/logo`, {
      method: 'DELETE',
      credentials: 'include',
    });
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-black text-gray-900">
            {initial ? 'Edit brand profile' : 'New brand profile'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Profile name">
              <input
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Company name (printed)">
              <input
                value={form.companyName}
                onChange={(e) => update({ companyName: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Address line 1">
              <input
                value={form.addressLine1}
                onChange={(e) => update({ addressLine1: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Address line 2">
              <input
                value={form.addressLine2}
                onChange={(e) => update({ addressLine2: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="City">
              <input
                value={form.city}
                onChange={(e) => update({ city: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Region">
              <input
                value={form.region}
                onChange={(e) => update({ region: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Postal code">
              <input
                value={form.postalCode}
                onChange={(e) => update({ postalCode: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Country">
              <input
                value={form.country}
                onChange={(e) => update({ country: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Contact email">
              <input
                value={form.email}
                onChange={(e) => update({ email: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Contact phone">
              <input
                value={form.phone}
                onChange={(e) => update({ phone: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Website">
              <input
                value={form.website}
                onChange={(e) => update({ website: e.target.value })}
                className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Primary color">
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="color"
                  value={form.primaryColor}
                  onChange={(e) => update({ primaryColor: e.target.value })}
                  className="h-12 w-16 rounded-xl border border-gray-200 bg-gray-50 cursor-pointer"
                />
                <input
                  value={form.primaryColor}
                  onChange={(e) => update({ primaryColor: e.target.value })}
                  className="flex-1 px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold font-mono focus:ring-2 focus:ring-primary"
                />
              </div>
            </Field>
          </div>
          <Field label="Logo (PNG, JPG, SVG, WebP — max 1MB)">
            <div className="mt-2 flex items-center gap-3">
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              {initial?.hasLogo && (
                <button
                  type="button"
                  onClick={handleClearLogo}
                  className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100"
                >
                  Remove logo
                </button>
              )}
            </div>
          </Field>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => update({ isDefault: e.target.checked })}
              className="w-4 h-4"
            />
            <span className="text-sm font-bold text-gray-700">
              Use as the default brand profile for new quotes
            </span>
          </label>
          {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border-2 border-gray-200 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="px-6 py-2.5 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
