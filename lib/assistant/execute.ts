import 'server-only';

import { type JsonSchema, type ToolContext, type ToolDefinition, type ToolKind, ToolRefusal, toolKind } from './types';

/** One tool call and what came of it, as the server saw it. */
export interface Action {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  /** False when the tool refused or failed; the screen and the model both go by this, not by the reply's wording. */
  ok: boolean;
  kind: ToolKind;
  /** One line a person can read: "Added Airport pickup to BRG-ZAF-NOV-2668". */
  summary?: string;
  /** Where the record lives in the app. */
  href?: string;
}

const describeType = (schema: JsonSchema) => (schema.enum ? `one of: ${schema.enum.join(', ')}` : schema.type);

/**
 * Checks a value against a declared parameter and returns it cleaned, or says
 * what is wrong. Numbers and booleans that arrive as text are let through for
 * the handlers' own coercion; everything else has to match.
 */
function check(schema: JsonSchema, value: unknown, path: string): { value: unknown } | { problem: string } {
  if (value === null) {
    return schema.nullable ? { value: null } : { problem: `${path} cannot be empty` };
  }
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string' && typeof value !== 'number') return { problem: `${path} must be text` };
      const text = String(value);
      if (schema.enum && !schema.enum.includes(text)) {
        return { problem: `${path} must be ${describeType(schema)} (got "${text.slice(0, 40)}")` };
      }
      return { value: typeof value === 'number' ? text : value };
    }
    case 'integer':
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { problem: `${path} must be a number` };
      if (schema.type === 'integer' && !Number.isInteger(n)) return { problem: `${path} must be a whole number` };
      return { value: n };
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { value };
      if (value === 'true') return { value: true };
      if (value === 'false') return { value: false };
      return { problem: `${path} must be true or false` };
    }
    case 'array': {
      if (!Array.isArray(value)) return { problem: `${path} must be a list` };
      if (!schema.items) return { value };
      const out: unknown[] = [];
      for (const [index, item] of value.entries()) {
        const checked = check(schema.items, item, `${path}[${index + 1}]`);
        if ('problem' in checked) return checked;
        out.push(checked.value);
      }
      return { value: out };
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return { problem: `${path} must be an object` };
      return checkObject(schema, value as Record<string, unknown>, path);
    }
  }
}

function checkObject(
  schema: JsonSchema,
  raw: Record<string, unknown>,
  path: string,
): { value: Record<string, unknown> } | { problem: string } {
  const properties = schema.properties ?? {};
  const at = (key: string) => (path ? `${path}.${key}` : key);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const property = properties[key];
    if (!property) {
      const known = Object.keys(properties);
      return {
        problem: `${at(key)} is not something this tool can set${known.length ? ` (it takes: ${known.join(', ')})` : ''}`,
      };
    }
    if (value === undefined) continue;
    // A null for a field that can't be cleared carries nothing: read it as left out.
    if (value === null && !property.nullable) continue;
    const checked = check(property, value, at(key));
    if ('problem' in checked) return checked;
    out[key] = checked.value;
  }
  for (const key of schema.required ?? []) {
    if (out[key] === undefined || out[key] === null || out[key] === '') return { problem: `${at(key)} is required` };
  }
  return { value: out };
}

/** The call's arguments against the tool's own declaration: cleaned, or why not. */
export function checkArgs(
  schema: JsonSchema,
  args: Record<string, unknown>,
): { args: Record<string, unknown> } | { problem: string } {
  const checked = checkObject(schema, args, '');
  return 'problem' in checked ? checked : { args: checked.value };
}

function pick(result: unknown, key: 'summary' | 'href'): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const value = (result as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : undefined;
}

export function isFailure(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && typeof (result as { error?: unknown }).error === 'string');
}

/**
 * Runs one tool call. Every call goes through here, from the loop and from a
 * confirmation alike: arguments the tool never declared are refused rather
 * than dropped, a refusal comes back as the tool's error, and a fault is
 * logged and reported instead of taking the whole reply down with it.
 */
export async function executeTool(
  tool: ToolDefinition,
  rawArgs: Record<string, unknown> | undefined,
  ctx: ToolContext,
): Promise<Action> {
  const name = tool.functionDeclaration.name;
  const kind = toolKind(tool);
  const args = rawArgs ?? {};

  const checked = checkArgs(tool.functionDeclaration.parameters, args);
  if ('problem' in checked) {
    return { tool: name, args, ok: false, kind, result: { error: `${checked.problem}. Nothing was changed.` } };
  }

  let result: unknown;
  try {
    result = await tool.handler(checked.args, ctx);
  } catch (error) {
    if (error instanceof ToolRefusal) {
      result = { error: error.message };
    } else {
      console.error(`[assistant] ${name} failed:`, error);
      result = {
        error:
          kind === 'write'
            ? 'That failed unexpectedly. It may not have been saved: check the record before trying again.'
            : 'That lookup failed unexpectedly.',
      };
    }
  }

  return {
    tool: name,
    args: checked.args,
    result,
    ok: !isFailure(result),
    kind,
    summary: pick(result, 'summary'),
    href: pick(result, 'href'),
  };
}
