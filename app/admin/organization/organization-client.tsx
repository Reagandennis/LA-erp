'use client';

import { useEffect, useRef, useState } from 'react';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];

export interface OrganizationSettings {
  companyName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  defaultCurrency: string;
  defaultTaxRate: number;
  taxLabel: string;
  hasLogo: boolean;
  logoMimeType: string | null;
  updatedAt: string;
}

interface OrganizationClientProps {
  initialSettings: OrganizationSettings;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function OrganizationClient({ initialSettings }: OrganizationClientProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [companyName, setCompanyName] = useState(settings.companyName ?? '');
  const [addressLine1, setAddressLine1] = useState(settings.addressLine1 ?? '');
  const [addressLine2, setAddressLine2] = useState(settings.addressLine2 ?? '');
  const [city, setCity] = useState(settings.city ?? '');
  const [region, setRegion] = useState(settings.region ?? '');
  const [postalCode, setPostalCode] = useState(settings.postalCode ?? '');
  const [country, setCountry] = useState(settings.country ?? '');
  const [email, setEmail] = useState(settings.email ?? '');
  const [phone, setPhone] = useState(settings.phone ?? '');
  const [website, setWebsite] = useState(settings.website ?? '');
  const [defaultCurrency, setDefaultCurrency] = useState(settings.defaultCurrency);
  const [defaultTaxRatePct, setDefaultTaxRatePct] = useState(
    String(round2(settings.defaultTaxRate * 100)),
  );
  const [taxLabel, setTaxLabel] = useState(settings.taxLabel);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const logoFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (success) {
      const timeout = setTimeout(() => setSuccess(null), 2500);
      return () => clearTimeout(timeout);
    }
  }, [success]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      const response = await fetch('/api/admin/organization', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim() || null,
          addressLine1: addressLine1.trim() || null,
          addressLine2: addressLine2.trim() || null,
          city: city.trim() || null,
          region: region.trim() || null,
          postalCode: postalCode.trim() || null,
          country: country.trim() || null,
          email: email.trim(),
          phone: phone.trim() || null,
          website: website.trim() || null,
          defaultCurrency,
          defaultTaxRate: (Number(defaultTaxRatePct) || 0) / 100,
          taxLabel: taxLabel.trim() || 'Tax',
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { settings?: OrganizationSettings; error?: string }
        | null;
      if (!response.ok || !data?.settings) {
        setError(data?.error ?? 'Could not save');
        return;
      }
      setSettings(data.settings);
      setSuccess('Branding saved');
    } catch {
      setError('Network error');
    } finally {
      setPending(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    setError(null);
    setSuccess(null);
    const formData = new FormData();
    formData.append('logo', file);
    const response = await fetch('/api/admin/organization/logo', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const data = (await response.json().catch(() => null)) as
      | { settings?: OrganizationSettings; error?: string }
      | null;
    if (!response.ok || !data?.settings) {
      setError(data?.error ?? 'Could not upload logo');
      return;
    }
    setSettings(data.settings);
    setLogoVersion((v) => v + 1);
    setSuccess('Logo updated');
  };

  const handleLogoClear = async () => {
    if (!confirm('Remove the saved logo?')) return;
    setError(null);
    const response = await fetch('/api/admin/organization/logo', {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = (await response.json().catch(() => null)) as
      | { settings?: OrganizationSettings; error?: string }
      | null;
    if (!response.ok || !data?.settings) {
      setError(data?.error ?? 'Could not remove logo');
      return;
    }
    setSettings(data.settings);
    setLogoVersion((v) => v + 1);
    setSuccess('Logo removed');
  };

  return (
    <div className="space-y-8">
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-black text-gray-900 uppercase tracking-widest">Company logo</h2>
        <div className="flex items-start gap-6 flex-wrap">
          <div className="w-32 h-32 bg-gray-50 border border-gray-100 rounded-xl flex items-center justify-center overflow-hidden">
            {settings.hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/admin/organization/logo?v=${logoVersion}`}
                alt="Company logo"
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                No logo
              </span>
            )}
          </div>
          <div className="space-y-3 flex-1 min-w-[240px]">
            <input
              ref={logoFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleLogoUpload(file);
                event.target.value = '';
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => logoFileRef.current?.click()}
              className="px-5 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black"
            >
              Upload logo
            </button>
            {settings.hasLogo && (
              <button
                type="button"
                onClick={handleLogoClear}
                className="ml-2 px-5 py-2.5 text-rose-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-rose-50"
              >
                Remove
              </button>
            )}
            <p className="text-xs text-gray-500">
              PNG, JPEG, WebP or SVG. SVG is shown in the app but won&apos;t embed in PDFs — supply a
              raster format if you need it on the printable quote.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-black text-gray-900 uppercase tracking-widest">Company details</h2>
        <Field label="Company name">
          <input
            type="text"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Address line 1">
            <input
              type="text"
              value={addressLine1}
              onChange={(event) => setAddressLine1(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
          <Field label="Address line 2">
            <input
              type="text"
              value={addressLine2}
              onChange={(event) => setAddressLine2(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
          <Field label="City">
            <input
              type="text"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
          <Field label="Region / State">
            <input
              type="text"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
          <Field label="Postal code">
            <input
              type="text"
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
          <Field label="Country">
            <input
              type="text"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
          <Field label="Phone">
            <input
              type="text"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
          <Field label="Website">
            <input
              type="text"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-black text-gray-900 uppercase tracking-widest">
          Quote defaults
        </h2>
        <p className="text-xs text-gray-500">
          Used to pre-fill the builder for new quotes. Existing quotes are unchanged.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Default currency">
            <select
              value={defaultCurrency}
              onChange={(event) => setDefaultCurrency(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            >
              {CURRENCIES.includes(defaultCurrency) ? null : (
                <option value={defaultCurrency}>{defaultCurrency}</option>
              )}
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default tax rate (%)">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={defaultTaxRatePct}
              onChange={(event) => setDefaultTaxRatePct(event.target.value)}
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
          <Field label="Tax label">
            <input
              type="text"
              value={taxLabel}
              onChange={(event) => setTaxLabel(event.target.value)}
              placeholder="VAT, GST, Sales tax…"
              className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
            />
          </Field>
        </div>
      </section>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}
      {success && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm font-bold text-emerald-700">
          {success}
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={pending}
        className="w-full md:w-auto px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
