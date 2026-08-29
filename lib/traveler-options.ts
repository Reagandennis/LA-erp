/**
 * Traveller option sets. Deliberately separate from `lib/travelers.ts`, which is
 * `server-only` — the client directory needs these values at runtime, and
 * importing a `server-only` module from a client component throws at build time.
 */

export const TRAVELER_STATUSES = ['Active', 'Inactive'] as const;
export const RISK_LEVELS = ['Standard', 'Elevated', 'High'] as const;

export type TravelerStatus = (typeof TRAVELER_STATUSES)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
