'use client';

import { useState } from 'react';

/**
 * Telegram account sign-in: phone → login code → optional 2FA password.
 *
 * Mirrors what Telegram Desktop asks for. The code arrives in the Telegram app
 * itself (or by SMS if no other session is active). Nothing here is persisted
 * client-side — the session string lives only on the server.
 */

type Stage = 'phone' | 'code' | 'password';

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';

export default function TelegramSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [stage, setStage] = useState<Stage>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (body: Record<string, string>) => {
    const r = await fetch('/api/telegram/auth', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await r.json().catch(() => null)) as
      | { ok?: boolean; stage?: string; error?: string }
      | null;
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (stage === 'phone') {
        const d = await post({ step: 'start', phoneNumber: phone });
        if (d?.ok) setStage('code');
        else setError(d?.error ?? 'Could not start the sign-in.');
        return;
      }
      if (stage === 'code') {
        const d = await post({ step: 'code', code });
        if (d?.stage === 'signed-in') onSignedIn();
        else if (d?.stage === 'password-needed') setStage('password');
        else setError(d?.error ?? 'That code was not accepted.');
        return;
      }
      const d = await post({ step: 'password', password });
      if (d?.stage === 'signed-in') onSignedIn();
      else setError(d?.error ?? 'That password was not accepted.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="text-base font-bold text-gray-900">Sign in to Telegram</h2>
      <p className="mt-1 text-xs text-gray-500">
        {stage === 'phone' && 'Connects your Telegram account so the console can show your chats.'}
        {stage === 'code' && `Enter the code Telegram sent to ${phone}.`}
        {stage === 'password' && 'This account has two-step verification enabled.'}
      </p>

      <div className="mt-4 space-y-3">
        {stage === 'phone' && (
          <input
            type="tel"
            autoFocus
            value={phone}
            placeholder="+254712345678"
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            className={inputClass}
          />
        )}
        {stage === 'code' && (
          <input
            type="text"
            autoFocus
            inputMode="numeric"
            value={code}
            placeholder="12345"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            className={inputClass}
          />
        )}
        {stage === 'password' && (
          <input
            type="password"
            autoFocus
            value={password}
            placeholder="Two-step verification password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            className={inputClass}
          />
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={
            busy ||
            (stage === 'phone' && !phone.trim()) ||
            (stage === 'code' && !code.trim()) ||
            (stage === 'password' && !password)
          }
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Working…' : stage === 'phone' ? 'Send code' : 'Continue'}
        </button>

        {stage !== 'phone' && (
          <button
            type="button"
            onClick={() => {
              setStage('phone');
              setCode('');
              setPassword('');
              setError(null);
            }}
            className="w-full text-xs text-gray-500 transition hover:text-gray-700"
          >
            Start over
          </button>
        )}
      </div>
    </div>
  );
}
