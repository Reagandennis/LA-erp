import 'server-only';

import type { NextRequest } from 'next/server';

/** OpenAPI-subset schema Gemini accepts for a function parameter. */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: string[];
  required?: string[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolContext {
  userId: number;
  isAdmin: boolean;
  request: NextRequest;
}

export interface ToolDefinition {
  functionDeclaration: FunctionDeclaration;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  /** Module slug the user must have (admins bypass). */
  requiredModule?: string;
  /** Role the user must have (admins bypass). */
  requiredRole?: string;
  /** Delete / void / send / approve — requires a confirmation round-trip. */
  destructive: boolean;
}

// --- Small coercion helpers (Gemini args are untyped JSON) -----------------

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const v = value.trim();
    return v.length > 0 ? v : undefined;
  }
  if (typeof value === 'number') return String(value);
  return undefined;
}

export function asNullableString(value: unknown): string | null {
  return asString(value) ?? null;
}

export function asInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function asBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}
