'use client';

import { useEffect, useMemo, useState } from 'react';

import { deviceCheckSupported, suggestDeviceLabel } from '@/app/ui/device-check-client';

import type { AdminDevice, AdminUser } from './admin-types';
import {
  Avatar,
  Card,
  EmptyState,
  SearchInput,
  describeDevice,
  formatDateTime,
  inputClass,
  primaryButton,
  relativeTime,
  secondaryButton,
} from './admin-ui';

export type DeviceAction = 'approve' | 'revoke' | 'remove';

const STATUS_STYLES: Record<AdminDevice['status'], { pill: string; label: string }> = {
  pending: { pill: 'bg-amber-50 text-amber-800 ring-amber-600/20', label: 'Waiting for approval' },
  approved: { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', label: 'Approved' },
  revoked: { pill: 'bg-gray-100 text-gray-600 ring-gray-500/15', label: 'Revoked' },
};

export function DeviceStatusPill({ status }: { status: AdminDevice['status'] }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.revoked;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.pill}`}>
      {style.label}
    </span>
  );
}

const CONFIRMATIONS: Partial<Record<DeviceAction, (d: AdminDevice) => string>> = {
  revoke: (d) => `Revoke "${d.label}" for ${d.user.name}? They are signed out of it straight away.`,
  remove: (d) => `Remove "${d.label}" for ${d.user.name}? It has to be registered and approved again before it can be used.`,
};

/** Approve / Revoke / Remove for one device, shared by the Devices tab and the user drawer. */
export function DeviceActions({
  device,
  busy,
  onAction,
}: {
  device: AdminDevice;
  busy: boolean;
  onAction: (deviceId: string, action: DeviceAction) => Promise<void>;
}) {
  const run = (action: DeviceAction) => {
    const question = CONFIRMATIONS[action]?.(device);
    if (question && !window.confirm(question)) return;
    void onAction(device.id, action);
  };
  const subtle = 'rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40';

  return (
    <div className="flex shrink-0 items-center gap-1">
      {device.status !== 'approved' && (
        <button type="button" disabled={busy} onClick={() => run('approve')} className={`${subtle} bg-[#03458f] text-white hover:bg-[#03458f]/90`}>
          Approve
        </button>
      )}
      {device.status === 'approved' && !device.current && (
        <button type="button" disabled={busy} onClick={() => run('revoke')} className={`${subtle} text-rose-600 hover:bg-rose-50`}>
          Revoke
        </button>
      )}
      {!device.current && (
        <button type="button" disabled={busy} onClick={() => run('remove')} className={`${subtle} text-gray-500 hover:bg-gray-100`}>
          Remove
        </button>
      )}
    </div>
  );
}

export default function DevicesPanel({
  devices,
  users,
  currentUserId,
  now,
  onAction,
  onRegisterThisDevice,
  onRequireEveryone,
  onOpenUser,
}: {
  devices: AdminDevice[];
  users: AdminUser[];
  currentUserId: number;
  now: number;
  onAction: (deviceId: string, action: DeviceAction) => Promise<void>;
  /** Registers the computer the admin is on, for the admin's own account. */
  onRegisterThisDevice: (label: string) => Promise<void>;
  onRequireEveryone: (required: boolean) => Promise<void>;
  onOpenUser: (userId: number) => void;
}) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [supported, setSupported] = useState(true);

  // Read from the browser after mount so the first render matches the server's.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSupported(deviceCheckSupported());
      setLabel((current) => current || suggestDeviceLabel());
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(
      (d) =>
        d.user.name.toLowerCase().includes(q) ||
        d.user.email.toLowerCase().includes(q) ||
        d.label.toLowerCase().includes(q) ||
        d.status.includes(q),
    );
  }, [devices, search]);

  const active = users.filter((u) => u.status === 'active');
  const required = active.filter((u) => u.requireApprovedDevice).length;
  const pending = devices.filter((d) => d.status === 'pending').length;
  const iHaveApproved = devices.some((d) => d.user.id === currentUserId && d.status === 'approved');

  const guard = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  };

  const requireEveryone = (on: boolean) => {
    const question = on
      ? iHaveApproved
        ? 'Require an approved work device for everyone? Anyone signed in from a device that is not approved is signed out now and has to register theirs.'
        : 'Require an approved work device for everyone else? You have no approved device yet, so your own account is left out until you register and approve one.'
      : 'Stop requiring approved devices? Everyone can sign in from any device again.';
    if (!window.confirm(question)) return;
    void guard('policy', () => onRequireEveryone(on));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Who must use an approved device"
          description="People with this rule can only sign in from a work device you have approved here. Set it per person in their profile, or for everyone at once."
        >
          <p className="text-sm text-gray-900">
            <span className="text-2xl font-semibold tabular-nums">{required}</span>
            <span className="text-gray-500"> of {active.length} active {active.length === 1 ? 'person' : 'people'}</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => requireEveryone(true)} disabled={busy !== null || required === active.length} className={primaryButton}>
              Require for everyone
            </button>
            <button type="button" onClick={() => requireEveryone(false)} disabled={busy !== null || required === 0} className={secondaryButton}>
              Stop requiring
            </button>
          </div>
        </Card>

        <Card
          title="Register this device"
          description="Adds the computer you are on to your own account. Do this, then approve it below, before requiring devices for yourself."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              placeholder="e.g. Office MacBook"
              aria-label="Name for this device"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void guard('register', () => onRegisterThisDevice(label))}
              disabled={busy !== null || !supported}
              className={`${primaryButton} shrink-0`}
            >
              {busy === 'register' ? 'Registering…' : 'Register'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {supported
              ? 'You will be asked for this computer’s fingerprint, face or PIN. Passkeys that sync to other devices are refused.'
              : 'This browser cannot register a device. Use an up-to-date Chrome, Edge or Safari.'}
          </p>
        </Card>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by person, device or status…" className="sm:w-80" />
        <p className="text-xs text-gray-500">
          {devices.length} device{devices.length === 1 ? '' : 's'}
          {pending > 0 && <span className="font-medium text-amber-700"> · {pending} waiting for approval</span>}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        {filtered.length === 0 ? (
          <EmptyState
            title={search ? 'No devices match' : 'No devices registered yet'}
            detail={search ? undefined : 'People register their work computer the first time they sign in after the rule is switched on for them.'}
          />
        ) : (
          <ul className="divide-y divide-gray-50">
            {filtered.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
                <button type="button" onClick={() => onOpenUser(d.user.id)} className="flex min-w-0 items-center gap-3 text-left sm:w-64">
                  <Avatar name={d.user.name} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">{d.user.name}</span>
                    <span className="block truncate text-xs text-gray-500">{d.user.email}</span>
                  </span>
                </button>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-900">
                    <span className="truncate font-medium">{d.label}</span>
                    <DeviceStatusPill status={d.status} />
                    {d.current && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">This device</span>}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {describeDevice(d.userAgent)} · registered {formatDateTime(d.createdAt)}
                    {d.lastUsedAt ? ` · last used ${relativeTime(d.lastUsedAt, now).toLowerCase()}` : ' · never used to sign in'}
                  </p>
                </div>
                <DeviceActions device={d} busy={busy !== null} onAction={(id, action) => guard(id, () => onAction(id, action))} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
