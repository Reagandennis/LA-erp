import 'server-only';

import { parseOpenErApi, type RateTable } from './exchange-rates';
import { prisma } from './prisma';

/**
 * Daily USD-based rates from ExchangeRate-API's open endpoint: no key, one
 * update a day, attribution shown on the reports page. A single table quoted
 * per USD converts any pair.
 */
const SOURCE_URL = 'https://open.er-api.com/v6/latest/USD';
const BASE = 'USD';
/** The provider publishes daily; checking twice a day keeps within hours of it. */
const FRESH_MS = 12 * 60 * 60 * 1000;
/** After a failed fetch, serve the saved table and try the network again after this. */
const RETRY_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 5000;

export interface LiveRates extends RateTable {
  /** The last refresh failed, so this is the last saved table. */
  stale: boolean;
}

let memo: { table: LiveRates | null; nextCheck: number } | null = null;
let inflight: Promise<LiveRates | null> | null = null;

/**
 * The current rate table, or null if none has ever been fetched. Serves from
 * memory, then the saved snapshot, then the network, so a page view waits on
 * the provider about twice a day and never fails because of it.
 */
export async function getRates(): Promise<LiveRates | null> {
  if (memo && Date.now() < memo.nextCheck) return memo.table;
  inflight ??= refresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function refresh(): Promise<LiveRates | null> {
  const saved = await loadSnapshot();
  if (saved && Date.now() - saved.fetchedAt < FRESH_MS) {
    return remember({ ...saved.table, stale: false }, saved.fetchedAt + FRESH_MS);
  }
  try {
    const table = await fetchTable();
    await saveSnapshot(table);
    return remember({ ...table, stale: false }, Date.now() + FRESH_MS);
  } catch (error) {
    console.warn('[exchange-rates] refresh failed, using last saved rates:', error instanceof Error ? error.message : error);
    return remember(saved ? { ...saved.table, stale: true } : null, Date.now() + RETRY_MS);
  }
}

function remember(table: LiveRates | null, nextCheck: number): LiveRates | null {
  memo = { table, nextCheck };
  return table;
}

async function fetchTable(): Promise<RateTable> {
  const res = await fetch(SOURCE_URL, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const table = parseOpenErApi(await res.json());
  if (!table || table.base !== BASE) throw new Error('unexpected response');
  return table;
}

async function loadSnapshot(): Promise<{ table: RateTable; fetchedAt: number } | null> {
  try {
    const row = await prisma.exchangeRateSnapshot.findUnique({ where: { base: BASE } });
    if (!row || !row.rates || typeof row.rates !== 'object') return null;
    return {
      table: { base: row.base, rates: row.rates as Record<string, number>, asOf: row.asOf.toISOString() },
      fetchedAt: row.fetchedAt.getTime(),
    };
  } catch (error) {
    console.warn('[exchange-rates] could not read saved rates:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** Best effort: a failed save only costs a refetch after the next restart. */
async function saveSnapshot(table: RateTable): Promise<void> {
  const data = { rates: table.rates, asOf: new Date(table.asOf) };
  try {
    await prisma.exchangeRateSnapshot.upsert({ where: { base: table.base }, create: { base: table.base, ...data }, update: data });
  } catch (error) {
    console.warn('[exchange-rates] could not save rates:', error instanceof Error ? error.message : error);
  }
}
