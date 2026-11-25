import 'server-only';

import type { NextRequest } from 'next/server';

import type { AccessUser } from '@/lib/user';

/** OpenAPI-subset schema Gemini accepts for a function parameter. */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: string[];
  required?: string[];
  /** An explicit null is meaningful (it clears the field). */
  nullable?: boolean;
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolContext {
  userId: number;
  userName: string;
  isAdmin: boolean;
  /** The signed-in person, for the libs that decide access from the whole user. */
  user: AccessUser;
  /** The person's IANA time zone; wall-clock times in tool arguments are read in it. */
  timeZone: string;
  request: NextRequest;
}

/** A read looks something up; a write changes the platform. */
export type ToolKind = 'read' | 'write';

export interface ToolDefinition {
  functionDeclaration: FunctionDeclaration;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  /** Module slug(s) the user must hold, any one of them (admins bypass). */
  requiredModule?: string | readonly string[];
  /** Role the user must have (admins bypass). */
  requiredRole?: string;
  /** Delete / void / send / approve — requires a confirmation round-trip. */
  destructive: boolean;
  /** Left out, it follows from the name: list_, get_, find_ and search tools read. */
  kind?: ToolKind;
  /** What the Confirm card says will happen, e.g. "Approve invoice #12". */
  confirmLabel?: (args: Record<string, unknown>) => string;
}

/**
 * A handler's way of saying no: the message goes back to the model as the
 * tool's error. Anything else a handler throws is a fault, and is logged.
 */
export class ToolRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolRefusal';
  }
}

export function toolKind(tool: ToolDefinition): ToolKind {
  if (tool.kind) return tool.kind;
  if (tool.destructive) return 'write';
  return /^(list_|get_|find_|search_|web_search$|use_area$)/.test(tool.functionDeclaration.name) ? 'read' : 'write';
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
