'use client';

import { useEffect, useMemo, useState } from 'react';

export type StatusVariant =
  | 'online'
  | 'away'
  | 'offline'
  | 'busy'
  | 'success'
  | 'warning'
  | 'danger'
  | 'accent'
  | 'neutral';

const VARIANT_COLOR: Record<StatusVariant, string> = {
  online: 'bg-emerald-500',
  away: 'bg-amber-400',
  offline: 'bg-gray-300',
  busy: 'bg-rose-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-400',
  danger: 'bg-rose-500',
  accent: 'bg-primary',
  neutral: 'bg-gray-300',
};

const VARIANT_LABEL: Partial<Record<StatusVariant, string>> = {
  online: 'Online',
  away: 'Away',
  offline: 'Offline',
  busy: 'Busy',
};

const SIZES = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
} as const;

/**
 * A small coloured dot conveying state. `label` is required for meaning: it is
 * exposed to assistive tech and, when `showLabel` is set, rendered as text —
 * colour alone never carries the signal.
 */
export function StatusDot({
  variant,
  label,
  size = 'md',
  showLabel = false,
  pulse = false,
  className = '',
}: Readonly<{
  variant: StatusVariant;
  label?: string;
  size?: keyof typeof SIZES;
  showLabel?: boolean;
  pulse?: boolean;
  className?: string;
}>) {
  const text = label ?? VARIANT_LABEL[variant] ?? variant;
  const color = VARIANT_COLOR[variant] ?? VARIANT_COLOR.neutral;

  const dot = (
    <span className={`relative flex shrink-0 ${SIZES[size]}`}>
      {pulse && variant === 'online' && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color}`}
        />
      )}
      <span className={`relative inline-flex h-full w-full rounded-full ${color}`} />
    </span>
  );

  if (!showLabel) {
    return (
      <span className={`inline-flex ${className}`} title={text}>
        {dot}
        <span className="sr-only">{text}</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {dot}
      <span className="text-[11px] font-bold text-gray-500">{text}</span>
    </span>
  );
}

/**
 * A status dot pinned to the corner of an avatar. Wrap the avatar element:
 * `<AvatarStatus variant="online"><div className="w-10 h-10 …" /></AvatarStatus>`
 */
export function AvatarStatus({
  variant,
  label,
  children,
  size = 'md',
}: Readonly<{
  variant: StatusVariant;
  label?: string;
  children: React.ReactNode;
  size?: keyof typeof SIZES;
}>) {
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-[2px]">
        <StatusDot variant={variant} label={label} size={size} />
      </span>
    </span>
  );
}

// --- Presence -------------------------------------------------------------

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface UserPresence {
  userId: number;
  status: PresenceStatus;
  lastSeenAt: string | null;
}

const PRESENCE_POLL_MS = 45 * 1000;

/**
 * Polls presence for the given users. Pass an empty array (or omit) to fetch
 * every active user. Returns a map keyed by user id, defaulting to offline.
 */
export function usePresence(userIds?: number[]) {
  const [presence, setPresence] = useState<Map<number, UserPresence>>(new Map());

  // Serialise the ids so the effect re-runs on membership change, not identity.
  const key = useMemo(
    () => (userIds && userIds.length > 0 ? [...new Set(userIds)].sort((a, b) => a - b).join(',') : ''),
    [userIds],
  );
  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const query = key ? `?ids=${key}` : '';
        const response = await fetch(`/api/presence${query}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) return;

        const data = (await response.json().catch(() => null)) as
          | { presence?: UserPresence[] }
          | null;
        if (!active || !data?.presence) return;

        setPresence(new Map(data.presence.map((entry) => [entry.userId, entry])));
      } catch {
        // Presence is decorative; a failed poll just leaves the last known state.
      }
    };

    void load();
    const timer = window.setInterval(load, PRESENCE_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [key]);

  return presence;
}

export function presenceOf(
  presence: Map<number, UserPresence>,
  userId: number,
): PresenceStatus {
  return presence.get(userId)?.status ?? 'offline';
}
