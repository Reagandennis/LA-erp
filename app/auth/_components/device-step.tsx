'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  DeviceCheckFailure,
  confirmThisDevice,
  deviceCheckProblem,
  reportDeviceCheckProblem,
  deviceCheckSupported,
  registerThisDevice,
  suggestDeviceLabel,
} from '@/app/ui/device-check-client';

const buttonStyle = (disabled: boolean) => ({
  width: '100%',
  padding: '10px',
  backgroundColor: disabled ? '#ccc' : '#000',
  color: '#fff',
  border: '1px solid #000',
  fontSize: '14px',
  fontWeight: 'bold' as const,
  cursor: disabled ? ('not-allowed' as const) : ('pointer' as const),
});

const linkButtonStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: '#666',
  textDecoration: 'underline',
  fontSize: '12px',
  cursor: 'pointer',
};

/**
 * Shown after a correct password when the account is limited to approved work
 * devices. The person either confirms the computer they are on (which signs
 * them in) or registers it and waits for an administrator to approve it.
 */
export function DeviceStep({
  hasDevices,
  onExpired,
  onCancel,
}: Readonly<{
  /** Whether this account already has a device registered (on any computer). */
  hasDevices: boolean;
  /** The password step is too old to continue from; start over. */
  onExpired: (message: string) => void;
  onCancel: () => void;
}>) {
  const router = useRouter();
  const [view, setView] = useState<'confirm' | 'register' | 'registered'>(hasDevices ? 'confirm' : 'register');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(true);

  // Read from the browser after mount so the first render matches the server's.
  useEffect(() => {
    const timer = setTimeout(() => {
      const ok = deviceCheckSupported();
      setSupported(ok);
      if (!ok) reportDeviceCheckProblem('login');
      setLabel((current) => current || suggestDeviceLabel());
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const fail = (caught: unknown) => {
    const failure = caught instanceof DeviceCheckFailure ? caught : null;
    if (failure?.code === 'expired') {
      onExpired(failure.message);
      return;
    }
    if (failure?.code === 'no-devices') setView('register');
    setError(failure?.message ?? 'The device check failed. Please try again.');
  };

  const confirm = async () => {
    setError('');
    setBusy(true);
    try {
      await confirmThisDevice();
      router.push('/dashboard');
      router.refresh();
    } catch (caught) {
      fail(caught);
      setBusy(false);
    }
  };

  const register = async () => {
    setError('');
    setBusy(true);
    try {
      await registerThisDevice('login', label);
      setView('registered');
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <p style={{ fontSize: '14px', color: '#333', lineHeight: 1.5, margin: 0 }}>
        Your account can only be used from approved work devices.
      </p>

      {!supported && (
        <div style={{ padding: '12px', backgroundColor: '#fee', border: '1px solid #fcc', color: '#c00', fontSize: '14px' }}>
          {deviceCheckProblem()}
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: '12px', backgroundColor: '#fee', border: '1px solid #fcc', color: '#c00', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {view === 'confirm' && (
        <>
          <button type="button" onClick={() => void confirm()} disabled={busy || !supported} style={buttonStyle(busy || !supported)}>
            {busy ? 'Checking this device…' : 'Confirm this device'}
          </button>
          <p style={{ fontSize: '12px', color: '#666', margin: 0, lineHeight: 1.5 }}>
            You will be asked for this computer&apos;s fingerprint, face or PIN.{' '}
            <button type="button" style={linkButtonStyle} onClick={() => { setError(''); setView('register'); }}>
              This is a new work device
            </button>
          </p>
        </>
      )}

      {view === 'register' && (
        <>
          <div>
            <label htmlFor="device-label" style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500' }}>
              Name for this device
            </label>
            <input
              id="device-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={60}
              placeholder="e.g. Front office laptop"
              style={{ width: '100%', padding: '8px', border: '1px solid #ccc', fontSize: '14px' }}
            />
          </div>
          <button type="button" onClick={() => void register()} disabled={busy || !supported} style={buttonStyle(busy || !supported)}>
            {busy ? 'Registering…' : 'Register this device'}
          </button>
          <p style={{ fontSize: '12px', color: '#666', margin: 0, lineHeight: 1.5 }}>
            Only do this on a computer the company gave you. An administrator has to approve it before you can sign in from it.
            {hasDevices && (
              <>
                {' '}
                <button type="button" style={linkButtonStyle} onClick={() => { setError(''); setView('confirm'); }}>
                  This device is already registered
                </button>
              </>
            )}
          </p>
        </>
      )}

      {view === 'registered' && (
        <>
          <div style={{ padding: '12px', backgroundColor: '#f4f9f4', border: '1px solid #cde5cd', color: '#1d5d1d', fontSize: '14px', lineHeight: 1.5 }}>
            This device is registered and waiting for approval. Ask an administrator to approve it, then confirm it here.
          </div>
          <button type="button" onClick={() => void confirm()} disabled={busy} style={buttonStyle(busy)}>
            {busy ? 'Checking this device…' : 'It has been approved: sign me in'}
          </button>
        </>
      )}

      <p style={{ textAlign: 'center', fontSize: '12px', margin: 0 }}>
        <button type="button" style={linkButtonStyle} onClick={onCancel}>
          Sign in as someone else
        </button>
      </p>
    </div>
  );
}
