'use client';

import { useState } from 'react';

import { type AlertSettings, updateAlertSettings, useAlertSettings } from '@/app/ui/messaging-alerts-store';

/**
 * Per-browser alert preferences for new chat messages: sound, system
 * notifications while the ERP is in the background, and whether alerts show
 * the text (off for screens others can see). Applies to every messaging
 * module; the alerts themselves come from app/ui/messaging-alerts.tsx.
 */

type Permission = NotificationPermission | 'unsupported';

function currentPermission(): Permission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`}
      >
        <span className={`h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

export default function AlertsMenu() {
  const settings = useAlertSettings();
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<Permission>('default');

  const set = (patch: Partial<AlertSettings>) => updateAlertSettings(patch);

  const toggleDesktop = async (next: boolean) => {
    if (!next) {
      set({ desktop: false });
      return;
    }
    let granted = currentPermission();
    // Asked only from this click: browsers ignore prompts nobody asked for.
    if (granted === 'default') granted = await Notification.requestPermission();
    setPermission(granted);
    set({ desktop: granted === 'granted' });
  };

  const desktopHint =
    permission === 'unsupported'
      ? 'This browser does not support notifications.'
      : permission === 'denied'
        ? 'Blocked for this site — allow notifications in the browser settings.'
        : 'Pops up on your computer while the ERP is in another tab.';

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setPermission(currentPermission());
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V4a2 2 0 10-4 0v1.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 01-6 0"
          />
        </svg>
        Alerts
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close alert settings"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Message alerts"
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-2 shadow-xl"
          >
            <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              New message alerts · this browser
            </p>
            <Toggle
              label="Sound"
              hint="A short chime when a message arrives."
              checked={settings.sound}
              onChange={(sound) => set({ sound })}
            />
            <Toggle
              label="Desktop notifications"
              hint={desktopHint}
              checked={settings.desktop && permission === 'granted'}
              disabled={permission === 'unsupported' || permission === 'denied'}
              onChange={(next) => void toggleDesktop(next)}
            />
            <Toggle
              label="Show message text"
              hint="Turn off on screens other people can see."
              checked={settings.preview}
              onChange={(preview) => set({ preview })}
            />
          </div>
        </>
      )}
    </div>
  );
}
