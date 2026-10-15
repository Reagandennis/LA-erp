/**
 * Currency conversion against a table of rates quoted per one base currency.
 *
 * Client-safe and free of side effects so it can be unit-tested. The live
 * table comes from `exchange-rates-server.ts`.
 */

export interface RateTable {
  /** Currency every rate is quoted against, e.g. USD. */
  base: string;
  /** Currency code → units per 1 `base`. */
  rates: Record<string, number>;
  /** When the provider published these rates (ISO). */
  asOf: string;
}

/** Where the rates come from; the provider's terms ask for this attribution. */
export const RATES_SOURCE = { name: 'ExchangeRate-API', url: 'https://www.exchangerate-api.com' } as const;

/**
 * Units of `to` per 1 `from`. Same-currency is 1 even without a table; a
 * missing table or currency gives null, never a guess.
 */
export function crossRate(table: RateTable | null, from: string, to: string): number | null {
  if (from === to) return 1;
  if (!table) return null;
  const perBaseFrom = from === table.base ? 1 : table.rates[from];
  const perBaseTo = to === table.base ? 1 : table.rates[to];
  if (!perBaseFrom || !perBaseTo) return null;
  return perBaseTo / perBaseFrom;
}

/**
 * "1 USD = 129.73 KES" — always quoted from the stronger currency, so a
 * shilling report and a dollar report describe the same rate the same way.
 */
export function describeRate(from: string, to: string, rate: number): string {
  return rate >= 1 ? `1 ${from} = ${rate.toFixed(2)} ${to}` : `1 ${to} = ${(1 / rate).toFixed(2)} ${from}`;
}

/** Validate an ExchangeRate-API open-access `/v6/latest/<base>` response. */
export function parseOpenErApi(body: unknown): RateTable | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { result?: unknown; base_code?: unknown; time_last_update_unix?: unknown; rates?: unknown };
  if (b.result !== 'success' || typeof b.base_code !== 'string' || typeof b.time_last_update_unix !== 'number') {
    return null;
  }
  if (!b.rates || typeof b.rates !== 'object') return null;
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(b.rates)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) rates[code] = value;
  }
  if (Object.keys(rates).length === 0) return null;
  return { base: b.base_code, rates, asOf: new Date(b.time_last_update_unix * 1000).toISOString() };
}
