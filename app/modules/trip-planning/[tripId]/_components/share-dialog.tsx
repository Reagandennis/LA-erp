'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useEffect, useState } from 'react';

import type { TripShareLink } from '../../types';

interface ShareDialogProps {
  tripId: number;
  customer: { name: string; email: string | null };
  onClose: () => void;
}

/** What the link (and, for the crew, the PDF) shows. */
interface Shows {
  includeCrew: boolean;
  includeAttachments: boolean;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(APP_LOCALE, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Share an active trip with its client: a live link, a PDF, or both by email. */
export function ShareDialog({ tripId, customer, onClose }: ShareDialogProps) {
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<TripShareLink | null>(null);
  const [shows, setShows] = useState<Shows>({ includeCrew: false, includeAttachments: true });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/trips/${tripId}/share`, { credentials: 'include' })
      .then((r) => r.json().then((data: { link?: TripShareLink | null; error?: string }) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) setError(data.error ?? 'Could not load the share link');
        setLink(data.link ?? null);
        if (data.link) {
          setShows({ includeCrew: data.link.includeCrew, includeAttachments: data.link.includeAttachments });
        }
      })
      .catch(() => !cancelled && setError('Network error'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const url = link ? `${window.location.origin}${link.path}` : '';

  const call = async (
    key: string,
    path: string,
    init: RequestInit,
    onDone: (data: { link?: TripShareLink | null; emailedTo?: string }) => void,
  ): Promise<boolean> => {
    setPending(key);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch(path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      const data = (await r.json().catch(() => null)) as
        | { link?: TripShareLink | null; emailedTo?: string; error?: string }
        | null;
      // An email that fails after the link was made still made the link.
      if (data && 'link' in data) setLink(data.link ?? null);
      if (!r.ok || !data) {
        setError(data?.error ?? 'Something went wrong');
        return false;
      }
      onDone(data);
      return true;
    } catch {
      setError('Network error');
      return false;
    } finally {
      setPending(null);
    }
  };

  const saveLink = (next: Shows, regenerate = false) =>
    call(
      regenerate ? 'regenerate' : 'save',
      `/api/trips/${tripId}/share`,
      { method: 'PUT', body: JSON.stringify({ ...next, regenerate }) },
      () => setNotice(regenerate ? 'New link made. The old one no longer works.' : null),
    );

  const toggle = (key: keyof Shows, value: boolean) => {
    const previous = shows;
    const next = { ...shows, [key]: value };
    setShows(next);
    // A live link changes what it shows straight away; before that it's just the choice to make it with.
    if (link) void saveLink(next).then((ok) => !ok && setShows(previous));
  };

  const regenerate = () => {
    if (!confirm('Make a new link? Anyone with the current link loses access.')) return;
    void saveLink(shows, true);
  };

  const revoke = () => {
    if (!confirm('Turn off this link? The client will no longer be able to open it.')) return;
    void call('revoke', `/api/trips/${tripId}/share`, { method: 'DELETE' }, () => setNotice('Link turned off.'));
  };

  const email = () =>
    call(
      'email',
      `/api/trips/${tripId}/share/email`,
      { method: 'POST', body: JSON.stringify(shows) },
      (data) => setNotice(`Sent the link and PDF to ${data.emailedTo}.`),
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied.');
    } catch {
      setError('Could not copy. Select the link and copy it instead.');
    }
  };

  const busy = loading || pending !== null;

  return (
    <>
      <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-[220]" onClick={() => (pending ? null : onClose())} />
      <div className="fixed inset-0 z-[230] flex items-stretch sm:items-center justify-center sm:p-4 pointer-events-none">
        <div className="bg-white w-full max-w-lg h-full sm:h-auto sm:max-h-[92vh] overflow-y-auto rounded-none sm:rounded-[2rem] shadow-2xl pointer-events-auto">
          <div className="p-6 sm:p-8 border-b border-gray-100 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-primary uppercase tracking-[0.3em]">Share with client</p>
              <h2 className="mt-1 text-xl font-black text-gray-900 tracking-tight truncate">{customer.name}</h2>
              <p className="text-xs text-gray-500 font-bold mt-2">
                The itinerary without costs, internal runs or the trip log.
              </p>
            </div>
            <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 rounded-xl" aria-label="Close">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            <div className="rounded-2xl border border-gray-100 divide-y divide-gray-50">
              <ShowToggle
                checked={shows.includeAttachments}
                disabled={busy}
                onChange={(value) => toggle('includeAttachments', value)}
                label="Include photos and documents"
                hint="Each stop's tickets, vouchers and photos on the link, and the photos in the PDF."
              />
              <ShowToggle
                checked={shows.includeCrew}
                disabled={busy}
                onChange={(value) => toggle('includeCrew', value)}
                label="Include crew and notes"
                hint="Driver and CPO names and phone numbers, vehicles, and each stop's notes, which often name passengers and security staff."
              />
            </div>

            <section>
              <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Live link</h3>
              {loading ? (
                <p className="mt-2 text-sm text-gray-400">Loading…</p>
              ) : link ? (
                <div className="mt-2 space-y-3">
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={url}
                      onFocus={(e) => e.target.select()}
                      className="min-w-0 flex-1 px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium text-gray-700"
                    />
                    <button
                      type="button"
                      onClick={copy}
                      className="px-4 py-3 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary/90"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    {link.viewCount > 0 && link.lastViewedAt
                      ? `Opened ${link.viewCount} time${link.viewCount === 1 ? '' : 's'}, last ${formatDateTime(link.lastViewedAt)}.`
                      : 'Not opened yet.'}{' '}
                    Works until the trip is no longer active.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 border-2 border-gray-200 text-gray-700 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-gray-50"
                    >
                      Open
                    </a>
                    <button
                      type="button"
                      onClick={regenerate}
                      disabled={busy}
                      className="px-4 py-2 border-2 border-gray-200 text-gray-700 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-gray-50 disabled:opacity-50"
                    >
                      {pending === 'regenerate' ? 'Making…' : 'New link'}
                    </button>
                    <button
                      type="button"
                      onClick={revoke}
                      disabled={busy}
                      className="px-4 py-2 text-rose-600 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-rose-50 disabled:opacity-50"
                    >
                      Turn off
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 space-y-3">
                  <p className="text-sm text-gray-600">
                    A private page the client can open on any device. It always shows the latest plan, and stops working
                    once the trip is no longer active.
                  </p>
                  <button
                    type="button"
                    onClick={() => saveLink(shows)}
                    disabled={busy}
                    className="px-6 py-3 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50"
                  >
                    {pending === 'save' ? 'Creating…' : 'Create link'}
                  </button>
                </div>
              )}
            </section>

            <section>
              <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">PDF</h3>
              <p className="mt-2 text-sm text-gray-600">A copy of today&apos;s itinerary to attach or print.</p>
              <a
                href={`/api/trips/${tripId}/pdf?crew=${shows.includeCrew ? 1 : 0}&photos=${shows.includeAttachments ? 1 : 0}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block px-6 py-3 border-2 border-gray-200 text-gray-700 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-50"
              >
                Download PDF
              </a>
            </section>

            <section>
              <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Email</h3>
              {customer.email ? (
                <>
                  <p className="mt-2 text-sm text-gray-600">
                    Send the link{link ? '' : ' (made now)'} with the PDF attached to{' '}
                    <span className="font-bold text-gray-900">{customer.email}</span>.
                  </p>
                  <button
                    type="button"
                    onClick={email}
                    disabled={busy}
                    className="mt-3 px-6 py-3 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50"
                  >
                    {pending === 'email' ? 'Sending…' : 'Email to client'}
                  </button>
                </>
              ) : (
                <p className="mt-2 text-sm text-gray-500">This client has no email address. Add one under Customers to email them.</p>
              )}
            </section>

            {notice && (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm font-bold text-emerald-700">{notice}</div>
            )}
            {error && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">{error}</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ShowToggle({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 p-4 hover:bg-gray-50/70">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
      />
      <span>
        <span className="block text-sm font-bold text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
    </label>
  );
}
