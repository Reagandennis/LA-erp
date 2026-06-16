import 'server-only';

import { asBool, asNumber, asString, type JsonSchema } from '../types';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Normalise a model-supplied date to an ISO date string, or a fallback. */
export function dateIso(value: unknown, fallback: string | null): string | null {
  const s = asString(value);
  if (!s) return fallback;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? fallback : s;
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxable?: boolean;
}

/** Coerce a model-supplied items array into validated line items. */
export function parseLineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return [];
  const out: LineItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const description = asString(r.description);
    const quantity = asNumber(r.quantity) ?? 1;
    const unitPrice = asNumber(r.unitPrice) ?? asNumber(r.price) ?? 0;
    if (!description) continue;
    out.push({ description, quantity, unitPrice, taxable: asBool(r.taxable) });
  }
  return out;
}

/** Shared JSON schema for a quote/invoice line-items array. */
export const lineItemsSchema: JsonSchema = {
  type: 'array',
  description: 'Line items to bill.',
  items: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      quantity: { type: 'number' },
      unitPrice: { type: 'number' },
      taxable: { type: 'boolean' },
    },
    required: ['description', 'quantity', 'unitPrice'],
  },
};
