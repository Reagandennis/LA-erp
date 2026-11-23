/**
 * Parking Cards, the Fleet module under Vehicles: KAPS, PAYTECH, PARK n GO and
 * Express Way cards. People log parking and top-ups against a card here; a
 * balance is the sum of the card's entries, never stored. No server imports,
 * so the page uses it too; the database side is lib/parking-cards-server.ts.
 */

export const PARKING_PROVIDERS = ['KAPS', 'PAYTECH', 'PARK n GO', 'Express Way', 'Other'] as const;
export type ParkingProvider = (typeof PARKING_PROVIDERS)[number];

/** Parking: money paid, logged as a positive amount and stored negative. Top-up: money loaded.
 *  Balance check: what the card showed (by USSD, app or at a pay station). */
export const PARKING_ENTRY_KINDS = ['Parking', 'Top-up', 'Balance check'] as const;
export type ParkingEntryKind = (typeof PARKING_ENTRY_KINDS)[number];

/** Cards should keep at least KES 500, the Express Way card KES 10,000 (the fleet's own rule). */
export function defaultParkingThreshold(provider: string): number {
  return provider === 'Express Way' ? 10000 : 500;
}

export type ParkingCardDto = {
  id: number;
  name: string;
  provider: string;
  vehicle: { id: number; registration: string } | null;
  cardNumber: string | null;
  lowBalanceThreshold: number;
  active: boolean;
  notes: string | null;
  balance: number;
  /** When the card was last used, topped up or checked. */
  lastEntryAt: string | null;
  entries: number;
};

export type ParkingEntryDto = {
  id: number;
  cardId: number;
  kind: string;
  /** Signed: money in is positive, parking negative. */
  amount: number;
  observedBalance: number | null;
  occurredAt: string;
  vehicle: { id: number; registration: string } | null;
  location: string | null;
  reference: string | null;
  notes: string | null;
  createdBy: { id: number; name: string } | null;
};

export type ParkingStatementLine = ParkingEntryDto & { balanceAfter: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Newest first, with the balance after each entry. Money in comes before money out at the same moment. */
export function parkingStatement(entries: ParkingEntryDto[]): ParkingStatementLine[] {
  const ordered = [...entries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || b.amount - a.amount || a.id - b.id);
  let running = 0;
  return ordered
    .map((entry) => {
      running = round2(running + entry.amount);
      return { ...entry, balanceAfter: running };
    })
    .reverse();
}

export function isParkingLow(card: Pick<ParkingCardDto, 'balance' | 'lowBalanceThreshold' | 'active'>): boolean {
  return card.active && card.balance < card.lowBalanceThreshold;
}
