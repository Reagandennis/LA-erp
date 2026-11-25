import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ALL_TOOLS, AREAS, CORE_TOOLS } from '../lib/assistant/registry';
import { type JsonSchema, toolKind } from '../lib/assistant/types';
import { API_ACCESS } from '../lib/api-access';
import { DEFAULT_MODULES } from '../lib/module-catalog';
import { DEFAULT_ROLES } from '../lib/rbac';

/**
 * Every tool the assistant can be handed, checked as a set. These are the
 * mistakes that don't show until a user hits them: a gate naming a module that
 * doesn't exist (nobody but admins can ever use the tool), a `required` field
 * the schema doesn't have (the call can never succeed), a nested object with
 * no fields (every argument is refused), a delete that runs without Confirm.
 */

const moduleSlugs = new Set<string>(DEFAULT_MODULES.map((m) => m.slug));
const roleNames = new Set<string>(DEFAULT_ROLES.map((r) => r.name));
const name = (tool: (typeof ALL_TOOLS)[number]) => tool.functionDeclaration.name;

function schemaProblems(schema: JsonSchema, path: string, top = false): string[] {
  const problems: string[] = [];
  if (schema.type === 'object') {
    const properties = schema.properties ?? {};
    if (!top && Object.keys(properties).length === 0) problems.push(`${path}: an object parameter needs its fields declared`);
    for (const key of schema.required ?? []) {
      if (!(key in properties)) problems.push(`${path}: requires "${key}", which it does not declare`);
    }
    for (const [key, child] of Object.entries(properties)) problems.push(...schemaProblems(child, `${path}.${key}`));
  }
  if (schema.type === 'array') {
    if (!schema.items) problems.push(`${path}: a list parameter needs its item type`);
    else problems.push(...schemaProblems(schema.items, `${path}[]`));
  }
  if (schema.enum && (schema.enum.length === 0 || schema.enum.some((v) => typeof v !== 'string' || v === ''))) {
    problems.push(`${path}: enum values must be non-empty strings`);
  }
  if (schema.enum && schema.type !== 'string') problems.push(`${path}: only text parameters take an enum`);
  return problems;
}

describe('the assistant\'s tools, as a set', () => {
  it('names each tool once, in a form the model API accepts', () => {
    const names = ALL_TOOLS.map(name);
    const repeated = names.filter((n, i) => names.indexOf(n) !== i);
    expect(repeated).toEqual([]);
    expect(names.filter((n) => !/^[a-z][a-z0-9_]{2,62}$/.test(n))).toEqual([]);
    // Reserved for the loop's own area loader.
    expect(names).not.toContain('use_area');
  });

  it('declares schemas a call can actually satisfy', () => {
    const problems = ALL_TOOLS.flatMap((tool) => {
      const parameters = tool.functionDeclaration.parameters;
      return parameters.type === 'object' ? schemaProblems(parameters, name(tool), true) : [`${name(tool)}: parameters must be an object`];
    });
    expect(problems).toEqual([]);
  });

  it('describes every tool', () => {
    expect(ALL_TOOLS.filter((tool) => tool.functionDeclaration.description.trim().length < 15).map(name)).toEqual([]);
  });

  it('gates tools only on modules and roles that exist', () => {
    const unknown = ALL_TOOLS.flatMap((tool) => {
      const gates = typeof tool.requiredModule === 'string' ? [tool.requiredModule] : [...(tool.requiredModule ?? [])];
      return [
        ...gates.filter((slug) => !moduleSlugs.has(slug)).map((slug) => `${name(tool)}: module "${slug}"`),
        ...(tool.requiredRole && !roleNames.has(tool.requiredRole) ? [`${name(tool)}: role "${tool.requiredRole}"`] : []),
      ];
    });
    expect(unknown).toEqual([]);
    // The pages' own access map names real modules too.
    expect(Object.values(API_ACCESS).flat().filter((slug) => !moduleSlugs.has(slug))).toEqual([]);
  });

  it('leaves no area tool open to everyone', () => {
    // Only the core tools (search, the web) are for anyone who can open the assistant.
    const ungated = AREAS.flatMap((area) => area.tools).filter((tool) => !tool.requiredModule && !tool.requiredRole);
    expect(ungated.map(name)).toEqual([]);
  });

  it('holds anything that removes, sends or signs off for the user\'s Confirm', () => {
    const risky = /^(delete|remove|void|send|approve|decline|decide|acknowledge|record_.*payment|cancel)_|_payment$/;
    const unheld = ALL_TOOLS.filter((tool) => risky.test(name(tool)) && !tool.destructive)
      // Taking one line off a draft quote or invoice is an edit to a draft, shown in the result.
      .filter((tool) => !/^remove_(quote|invoice)_line$/.test(name(tool)));
    expect(unheld.map(name)).toEqual([]);
    expect(ALL_TOOLS.filter((tool) => tool.destructive && toolKind(tool) !== 'write').map(name)).toEqual([]);
  });

  it('never holds a lookup for Confirm, and counts lookups as reads', () => {
    const lookups = ALL_TOOLS.filter((tool) => /^(list|get|find|search)_/.test(name(tool)));
    expect(lookups.filter((tool) => tool.destructive).map(name)).toEqual([]);
    expect(lookups.filter((tool) => toolKind(tool) !== 'read').map(name)).toEqual([]);
  });

  it('puts every tool in exactly one area, or in the core', () => {
    const counts = new Map<string, number>();
    for (const tool of [...AREAS.flatMap((area) => area.tools), ...CORE_TOOLS]) counts.set(name(tool), (counts.get(name(tool)) ?? 0) + 1);
    expect([...counts].filter(([, n]) => n !== 1)).toEqual([]);
    expect(new Set(AREAS.map((area) => area.id)).size).toBe(AREAS.length);
    expect(AREAS.filter((area) => !/^[a-z][a-z_-]*$/.test(area.id) || area.tools.length === 0).map((area) => area.id)).toEqual([]);
  });

  it('keeps each area small enough to be worth loading on its own', () => {
    // Declarations are sent to the model on every step. An area that grows
    // past this should be split, or have its descriptions cut down.
    const LIMIT = 11_000;
    const sizes = AREAS.map((area) => ({
      id: area.id,
      chars: JSON.stringify(area.tools.map((tool) => tool.functionDeclaration)).length,
    }));
    expect(sizes.filter((size) => size.chars > LIMIT)).toEqual([]);
    const core = JSON.stringify(CORE_TOOLS.map((tool) => tool.functionDeclaration)).length;
    expect(core).toBeLessThan(2_500);
  });
});
