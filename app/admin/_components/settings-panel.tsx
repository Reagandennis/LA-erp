'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { adminFetch, errorMessage } from './admin-api';
import { Card, primaryButton } from './admin-ui';

const UPLOAD_LIMIT_FIELDS = [
  { key: 'fileMb', label: 'Files & attachments', description: 'File manager uploads and task attachments' },
  { key: 'photoMb', label: 'Photos', description: 'Personnel, contact, and fleet photos' },
  { key: 'documentMb', label: 'Documents', description: 'Contract and driver licence documents' },
  { key: 'audioMb', label: 'Radio audio', description: 'Zello recordings and transcription clips' },
  { key: 'logoMb', label: 'Logos', description: 'Organization and quote brand logos' },
] as const;

type UploadLimitKey = (typeof UPLOAD_LIMIT_FIELDS)[number]['key'];
type UploadLimits = Record<UploadLimitKey, number>;
type UploadLimitsDraft = Record<UploadLimitKey, string>;

function toDraft(limits: UploadLimits): UploadLimitsDraft {
  return Object.fromEntries(UPLOAD_LIMIT_FIELDS.map((f) => [f.key, String(limits[f.key])])) as UploadLimitsDraft;
}

function parseLimitMb(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

const LINKS = [
  {
    href: '/admin/organization',
    title: 'Organization profile',
    detail: 'Company details, logo, default currency and tax used on quotes and invoices.',
  },
  {
    href: '/admin/email',
    title: 'Email delivery',
    detail: 'Check the mail server settings and send a test email.',
  },
];

export default function SettingsPanel({ notify }: { notify: (message: { error?: string; success?: string }) => void }) {
  const [draft, setDraft] = useState<UploadLimitsDraft | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    adminFetch<{ limits: UploadLimits }>('/api/admin/upload-limits')
      .then((payload) => alive && setDraft(toDraft(payload.limits)))
      .catch((err) => alive && setLoadError(errorMessage(err, 'Upload limits could not be loaded.')));
    return () => {
      alive = false;
    };
  }, []);

  const invalid = !draft || UPLOAD_LIMIT_FIELDS.some((f) => parseLimitMb(draft[f.key]) === null);

  const save = async () => {
    if (!draft || invalid) return;
    setSaving(true);
    try {
      const body = Object.fromEntries(UPLOAD_LIMIT_FIELDS.map((f) => [f.key, parseLimitMb(draft[f.key])]));
      const payload = await adminFetch<{ limits: UploadLimits }>('/api/admin/upload-limits', { method: 'PUT', body: JSON.stringify(body) });
      setDraft(toDraft(payload.limits));
      notify({ success: 'Upload limits saved.' });
    } catch (err) {
      notify({ error: errorMessage(err, 'Could not save upload limits.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card
        title="Upload limits"
        description="Largest file people can upload, in megabytes (1–100). Applies to everyone immediately."
        className="lg:col-span-3"
      >
        {!draft ? (
          <p className="text-sm text-gray-500">{loadError || 'Loading…'}</p>
        ) : (
          <div className="space-y-2.5">
            {UPLOAD_LIMIT_FIELDS.map((field) => {
              const bad = parseLimitMb(draft[field.key]) === null;
              return (
                <label key={field.key} className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{field.label}</span>
                    <span className="block text-xs text-gray-500">{field.description}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={draft[field.key]}
                      onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                      aria-invalid={bad}
                      className={`w-20 rounded-lg border bg-white px-3 py-2 text-right text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 ${bad ? 'border-rose-300' : 'border-gray-200'}`}
                    />
                    <span className="w-7 text-xs text-gray-500">MB</span>
                  </span>
                </label>
              );
            })}
            <button type="button" onClick={() => void save()} disabled={saving || invalid} className={`${primaryButton} w-full`}>
              {saving ? 'Saving…' : 'Save limits'}
            </button>
          </div>
        )}
      </Card>

      <div className="space-y-3 lg:col-span-2">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 transition hover:border-[#03458f]/30 hover:shadow-sm"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900">{link.title}</span>
              <span className="mt-0.5 block text-xs text-gray-500">{link.detail}</span>
            </span>
            <svg className="h-5 w-5 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-[#03458f]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}
