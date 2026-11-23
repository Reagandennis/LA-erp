import { APP_LOCALE } from './locale';

/**
 * Fuel Cards, the Fleet module under Car Fuel: prepaid cards the internal
 * fleet fills up on. No server imports, so the pages use it too; the database
 * side is lib/fuel-cards-server.ts.
 *
 * A card's balance is never stored. It is its top-ups and adjustments less the
 * cost of every fill-up paid with it, so editing or deleting a fill-up puts
 * the balance right without anyone having to.
 */

/** Fuel is bought, and fuel cards are loaded, in Kenyan shillings only. */
export const FUEL_CURRENCY = 'KES';

export const FUEL_CARD_PROVIDERS = ['Shell', 'TotalEnergies', 'Other'] as const;
export type FuelCardProvider = (typeof FUEL_CARD_PROVIDERS)[number];

/** The companies a card can be held by: the same entities customers are split into (lib/crm.ts). */
export const FUEL_CARD_ENTITIES = ['LADYASKARI', 'LIONESS', 'STARLLWART'] as const;
export type FuelCardEntity = (typeof FUEL_CARD_ENTITIES)[number];

export const FUEL_CARD_ENTITY_LABELS: Record<FuelCardEntity, string> = {
  LADYASKARI: 'Lady Askari',
  LIONESS: 'Lioness Alliance',
  STARLLWART: 'Starllwart',
};

/** Top-up: money loaded, always positive. Adjustment: a correction either way, to match the provider's statement. */
export const TOP_UP_KINDS = ['Top-up', 'Adjustment'] as const;
export type TopUpKind = (typeof TOP_UP_KINDS)[number];

/** Admins are alerted when a card falls below this, unless the card says otherwise. */
export const DEFAULT_LOW_BALANCE_THRESHOLD = 5000;

export function entityLabel(entity: string): string {
  return FUEL_CARD_ENTITY_LABELS[entity as FuelCardEntity] ?? entity;
}

/** What the fill-up forms offer under "Paid with". */
export type FuelCardOption = {
  id: number;
  name: string;
  provider: string;
  entity: string;
  /** The vehicle the card is issued to; null for a spare any internal vehicle can use. */
  vehicle: { id: number; registration: string } | null;
  balance: number;
  lowBalanceThreshold: number;
};

/**
 * The cards a vehicle can fill up on: its own first, then the spares. A card
 * issued to another vehicle is never offered.
 */
export function cardsForVehicle<T extends Pick<FuelCardOption, 'vehicle' | 'name'>>(cards: T[], vehicleId: number | null): T[] {
  const own = cards.filter((c) => c.vehicle != null && c.vehicle.id === vehicleId);
  const spares = cards.filter((c) => c.vehicle == null);
  return [...own, ...spares];
}

export type FuelCardDto = FuelCardOption & {
  cardNumber: string | null;
  active: boolean;
  notes: string | null;
  /** Everything loaded (top-ups and adjustments, net). */
  loaded: number;
  /** The cost of every fill-up paid with the card. */
  spent: number;
  fills: number;
  createdAt: string;
};

export type TopUpDto = {
  id: number;
  cardId: number;
  kind: string;
  amount: number;
  occurredAt: string;
  reference: string | null;
  notes: string | null;
  createdBy: { id: number; name: string } | null;
};

/** A fill-up paid with the card, as its statement shows it. */
export type CardFillDto = {
  id: number;
  filledAt: string;
  vehicle: string;
  litres: number;
  cost: number;
  station: string | null;
  filledBy: string | null;
};

export type StatementEntry = {
  key: string;
  kind: 'Top-up' | 'Adjustment' | 'Fill-up';
  at: string;
  /** Signed: money in is positive, a fill-up negative. */
  amount: number;
  balanceAfter: number;
  title: string;
  detail: string | null;
  topUp?: TopUpDto;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isLowBalance(balance: number, threshold: number): boolean {
  return balance < threshold;
}

/**
 * A card's history, newest first, with the balance after each entry. Entries
 * at the same moment put money in before taking it out, so a top-up and the
 * fill-up it paid for read in a sensible order.
 */
export function buildStatement(topUps: TopUpDto[], fills: CardFillDto[]): StatementEntry[] {
  const entries: Omit<StatementEntry, 'balanceAfter'>[] = [
    ...topUps.map((t) => ({
      key: `t${t.id}`,
      kind: (t.kind === 'Adjustment' ? 'Adjustment' : 'Top-up') as StatementEntry['kind'],
      at: t.occurredAt,
      amount: t.amount,
      title: t.kind === 'Adjustment' ? 'Adjustment' : 'Top-up',
      detail: [t.reference, t.notes].filter(Boolean).join(' · ') || null,
      topUp: t,
    })),
    ...fills.map((f) => ({
      key: `f${f.id}`,
      kind: 'Fill-up' as const,
      at: f.filledAt,
      amount: -f.cost,
      title: `${f.vehicle} · ${f.litres.toLocaleString(APP_LOCALE, { maximumFractionDigits: 2 })} L`,
      detail: [f.station, f.filledBy].filter(Boolean).join(' · ') || null,
    })),
  ];
  entries.sort((a, b) => a.at.localeCompare(b.at) || b.amount - a.amount || a.key.localeCompare(b.key));
  let running = 0;
  const withBalance = entries.map((entry) => {
    running = round2(running + entry.amount);
    return { ...entry, balanceAfter: running };
  });
  return withBalance.reverse();
}

export function formatKes(value: number): string {
  return value.toLocaleString(APP_LOCALE, { style: 'currency', currency: FUEL_CURRENCY, maximumFractionDigits: 2 });
}

/** The line in the bell and the email. */
export function lowBalanceMessage(card: { name: string; entity: string }, balance: number, threshold: number): string {
  return `${card.name} (${entityLabel(card.entity)}) is down to ${formatKes(balance)}, below the ${formatKes(threshold)} alert level. Top it up in Fuel Cards.`;
}
