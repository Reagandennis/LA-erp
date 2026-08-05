'use client';

import { useState } from 'react';

import { useBanner } from '@/app/ui/banner';
import { GoogleAuthProvider, useGoogleAuth } from '@/app/ui/google-auth-provider';
import type { ContactSummary } from '@/lib/contacts';

interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  total: number;
  truncated: boolean;
}

function summarise(result: SyncResult): string {
  const parts: string[] = [];
  if (result.created) parts.push(`${result.created} added`);
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.skipped) parts.push(`${result.skipped} skipped`);
  if (parts.length === 0) parts.push('nothing to import');

  const summary = parts.join(', ');
  return result.truncated
    ? `${summary}. Only the first 2000 Google contacts were read — run it again to continue.`
    : summary;
}

function ImportControl({
  onImported,
}: Readonly<{ onImported: (contacts: ContactSummary[]) => void }>) {
  const { token, login, loading, error, gsiReady } = useGoogleAuth();
  const [syncing, setSyncing] = useState(false);
  const banner = useBanner();

  const runSync = async (accessToken: string) => {
    setSyncing(true);
    try {
      const response = await fetch('/api/contacts/google-sync', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          // The generic interceptor can't describe an import; we report it here.
          'x-silent-banner': '1',
        },
        body: JSON.stringify({ accessToken }),
      });

      const data = (await response.json().catch(() => null)) as
        | { result?: SyncResult; contacts?: ContactSummary[]; error?: string }
        | null;

      if (!response.ok || !data?.result) {
        banner.error(
          'Google contacts import failed',
          data?.error ?? 'Please try again.',
        );
        return;
      }

      if (data.contacts) onImported(data.contacts);
      banner.success('Google contacts imported', summarise(data.result));
    } catch {
      banner.error('Google contacts import failed', 'Check your connection and retry.');
    } finally {
      setSyncing(false);
    }
  };

  // Two explicit steps rather than auto-importing after consent: the button
  // says what it will do, and nothing fires as a side effect of a popup closing.
  const connected = Boolean(token);

  const handleClick = () => {
    if (token) {
      void runSync(token);
      return;
    }
    login();
  };

  const busy = syncing || loading;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || !gsiReady}
      title={error ?? undefined}
      className="self-start md:self-auto inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:border-[#03458f]/40 hover:text-[#03458f] disabled:opacity-50"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"
        />
        <path
          fill="#FBBC05"
          d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z"
        />
        <path
          fill="#EA4335"
          d="M12 4.8c1.8 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"
        />
      </svg>
      {syncing ? 'Importing…' : connected ? 'Import from Google' : 'Connect Google'}
    </button>
  );
}

/**
 * Wraps the control in its own Google auth provider so the contacts module can
 * request consent independently of the calendar module.
 */
export default function GoogleImportButton({
  onImported,
}: Readonly<{ onImported: (contacts: ContactSummary[]) => void }>) {
  return (
    <GoogleAuthProvider>
      <ImportControl onImported={onImported} />
    </GoogleAuthProvider>
  );
}
