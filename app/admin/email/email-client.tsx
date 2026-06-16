'use client';

import { useState } from 'react';

interface EmailConfigStatus {
  configured: boolean;
  host: string | null;
  port: number | null;
  secure: boolean | null;
  user: string | null;
  from: string | null;
  replyTo: string | null;
}

interface EmailSettingsClientProps {
  status: EmailConfigStatus;
  suggestedTo: string;
}

export default function EmailSettingsClient({ status, suggestedTo }: EmailSettingsClientProps) {
  const [to, setTo] = useState(suggestedTo);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const sendTest = async () => {
    setSending(true);
    setResult(null);
    try {
      const response = await fetch('/api/admin/email/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim() }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string; to?: string } | null;
      if (!response.ok) {
        setResult({ ok: false, message: data?.error ?? 'Could not send the test email.' });
      } else {
        setResult({ ok: true, message: `Test email sent to ${data?.to ?? to}. Check the inbox.` });
      }
    } catch {
      setResult({ ok: false, message: 'Network error. Try again.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Status card */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Connection status</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              status.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${status.configured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {status.configured ? 'Configured' : 'Not configured'}
          </span>
        </div>

        {status.configured ? (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Field label="SMTP host" value={status.host} />
            <Field label="Port" value={status.port != null ? `${status.port}${status.secure ? ' (TLS)' : ' (STARTTLS)'}` : null} />
            <Field label="Username" value={status.user} />
            <Field label="From address" value={status.from} />
            {status.replyTo && <Field label="Reply-to" value={status.replyTo} />}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-gray-500">
            Email isn&apos;t set up yet. Add the SMTP environment variables below and restart the app, then send a test
            to confirm it works.
          </p>
        )}
      </div>

      {/* Test send */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:p-6">
        <h2 className="text-sm font-semibold text-gray-900">Send a test email</h2>
        <p className="mt-0.5 text-xs text-gray-400">Verify delivery before relying on invoice and quote emails.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="button"
            onClick={sendTest}
            disabled={sending || !status.configured || to.trim().length === 0}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send test'}
          </button>
        </div>
        {!status.configured && (
          <p className="mt-2 text-xs text-amber-600">Configure SMTP first — the test button is disabled until then.</p>
        )}
        {result && (
          <p className={`mt-3 text-sm font-medium ${result.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{result.message}</p>
        )}
      </div>

      {/* Setup guide */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:p-6">
        <h2 className="text-sm font-semibold text-gray-900">Google Workspace setup</h2>
        <p className="mt-0.5 text-xs text-gray-400">Add these to your <code className="rounded bg-gray-100 px-1">.env</code>, then restart the app.</p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Option A — Gmail App Password (quickest)</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
          <li>Use a dedicated Workspace mailbox (e.g. <code className="rounded bg-gray-100 px-1">noreply@yourdomain.com</code>).</li>
          <li>Enable 2-Step Verification on that account.</li>
          <li>Create an <strong>App Password</strong> (Google Account → Security → App passwords).</li>
          <li>Use the values below with <code className="rounded bg-gray-100 px-1">smtp.gmail.com</code>.</li>
        </ol>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Option B — Workspace SMTP relay (higher volume)</p>
        <p className="mt-2 text-sm text-gray-600">
          In the Google Admin console, configure the SMTP relay service, then set{' '}
          <code className="rounded bg-gray-100 px-1">SMTP_HOST=smtp-relay.gmail.com</code>. The same variables apply.
        </p>

        <pre className="mt-4 overflow-x-auto rounded-xl bg-gray-900 p-4 text-xs leading-relaxed text-gray-100">
{`SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your-app-password
EMAIL_FROM="Your Company <noreply@yourdomain.com>"
EMAIL_REPLY_TO=ops@yourdomain.com   # optional`}
        </pre>
        <p className="mt-3 text-xs text-gray-400">
          For good deliverability to clients, make sure SPF, DKIM, and DMARC are set for your domain in Google Workspace.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <dt className="text-xs font-medium text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-gray-900">{value ?? '—'}</dd>
    </div>
  );
}
