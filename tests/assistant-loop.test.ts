import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../lib/ai-budget', () => ({ recordAiUsage: vi.fn() }));
vi.mock('../lib/user', () => ({
  userHasRole: (user: { roles: { name: string }[] }, role: string) => user.roles.some((r) => r.name === role),
  userHasModule: (user: { modules: { slug: string }[] }, slug: string) => user.modules.some((m) => m.slug === slug),
}));

const handlers = vi.hoisted(() => ({
  find: vi.fn(),
  change: vi.fn(),
  boom: vi.fn(),
  refuse: vi.fn(),
  remove: vi.fn(),
  bills: vi.fn(),
  search: vi.fn(),
}));

vi.mock('../lib/assistant/registry', () => {
  const tool = (
    name: string,
    handler: (...args: unknown[]) => unknown,
    extra: Record<string, unknown> = {},
    properties: Record<string, unknown> = {},
    required: string[] = [],
  ) => ({
    destructive: false,
    functionDeclaration: { name, description: name, parameters: { type: 'object', properties, required } },
    handler,
    ...extra,
  });
  const trips = [
    tool('find_things', handlers.find, { requiredModule: 'trip-planning' }),
    tool(
      'change_thing',
      handlers.change,
      { requiredModule: 'trip-planning' },
      { id: { type: 'integer' }, status: { type: 'string', enum: ['Draft', 'Active'] }, note: { type: 'string', nullable: true } },
      ['id'],
    ),
    tool('boom_thing', handlers.boom, { requiredModule: 'trip-planning' }),
    tool('refuse_thing', handlers.refuse, { requiredModule: 'trip-planning' }),
    tool('delete_thing', handlers.remove, { requiredModule: 'trip-planning', destructive: true }, { id: { type: 'integer' } }, ['id']),
  ];
  const money = [tool('list_bills', handlers.bills, { requiredModule: ['invoices-review', 'quotes'] })];
  const core = [tool('search_platform', handlers.search, {}, { query: { type: 'string' } }, ['query'])];
  const AREAS = [
    { id: 'trips', label: 'Trip Planning', summary: 'trips', tools: trips },
    { id: 'money', label: 'Invoices', summary: 'bills', tools: money },
  ];
  return {
    AREAS,
    CORE_TOOLS: core,
    ALL_TOOLS: [...trips, ...money, ...core],
    areaOfTool: (name: string) => AREAS.find((area) => area.tools.some((t) => t.functionDeclaration.name === name)),
  };
});

import { verifyConfirmation } from '../lib/assistant/confirm';
import { checkArgs } from '../lib/assistant/execute';
import type { GeminiContent, GenerateResult } from '../lib/assistant/gemini';
import { areasInHistory, trimHistory } from '../lib/assistant/history';
import { type LoopDeps, MAX_TOOL_ROUNDS, runConfirmed, runTurn } from '../lib/assistant/loop';
import { areasForUser, findScopedTool } from '../lib/assistant/scope';
import { type ToolContext, ToolRefusal } from '../lib/assistant/types';
import type { AccessUser } from '../lib/user';

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';

const user = (modules: string[], roles: string[] = []) =>
  ({
    id: 7,
    name: 'Amina',
    email: 'amina@example.com',
    roles: roles.map((name) => ({ name })),
    modules: modules.map((slug) => ({ slug, name: slug })),
  }) as unknown as AccessUser;

const planner = user(['trip-planning']);

const ctxFor = (u: AccessUser): ToolContext =>
  ({ userId: u.id, userName: u.name, isAdmin: false, user: u, timeZone: 'Africa/Nairobi', request: {} }) as unknown as ToolContext;

const say = (text: string): GenerateResult => ({ parts: [{ text }], text, error: null, finishReason: 'STOP' });
const call = (...calls: Array<[string, Record<string, unknown>?]>): GenerateResult => ({
  parts: calls.map(([name, args], i) => ({ functionCall: { id: `c${i}`, name, args: args ?? {} }, thoughtSignature: 'sig' }) as never),
  text: '',
  error: null,
  finishReason: 'STOP',
});
const nothing = (): GenerateResult => ({ parts: [], text: '', error: null, finishReason: 'STOP' });

/** A model that answers from a script, and remembers what it was shown each time. */
function script(...steps: GenerateResult[]) {
  const seen: Array<{ tools: string[]; system: string; contents: GeminiContent[] }> = [];
  const queue = [...steps];
  const deps: LoopDeps = {
    generate: vi.fn(async (args) => {
      seen.push({
        tools: args.functionDeclarations.map((d: { name: string }) => d.name),
        system: args.systemInstruction,
        contents: JSON.parse(JSON.stringify(args.contents)),
      });
      return queue.shift() ?? say('(script ran out)');
    }),
    budget: async () => ({ ok: true }),
    now: () => new Date('2026-11-24T12:20:00Z'),
  };
  return { deps, seen };
}

const ask = (text: string): GeminiContent[] => [{ role: 'user', parts: [{ text }] }];

function turn(u: AccessUser, steps: GenerateResult[], options: { preload?: string[]; prompt?: string } = {}) {
  const { deps, seen } = script(...steps);
  const contents = ask(options.prompt ?? 'do it');
  const result = runTurn({ user: u, ctx: ctxFor(u), contents, access: areasForUser(u), preload: options.preload, deps });
  return { result, seen, deps };
}

beforeEach(() => {
  for (const handler of Object.values(handlers)) handler.mockReset();
  handlers.find.mockResolvedValue({ items: [{ id: 1 }, { id: 2 }] });
  handlers.change.mockResolvedValue({ id: 1, reference: 'T-1', summary: 'Changed T-1', href: '/x/1' });
  handlers.boom.mockRejectedValue(new Error('connection reset'));
  handlers.refuse.mockRejectedValue(new ToolRefusal('Cannot edit a trip in status "Cancelled"'));
  handlers.remove.mockResolvedValue({ deleted: true, id: 1 });
  handlers.bills.mockResolvedValue({ items: [] });
  handlers.search.mockResolvedValue({ results: [] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('what the reply may claim', () => {
  it('never answers "Done." when the model says nothing: it asks again, then says nothing was changed', async () => {
    const { result, deps } = turn(planner, [nothing(), nothing()]);
    const out = await result;
    expect(deps.generate).toHaveBeenCalledTimes(2);
    expect(out.reply).not.toMatch(/^Done\.?$/);
    expect(out.reply).toContain('Nothing was changed');
    expect(out.outcome).toEqual({ changed: 0, failed: 0 });
    expect(out.record).toContain('nothing was changed');
  });

  it('says what really ran when the model goes quiet after a change', async () => {
    const { result } = turn(planner, [call(['change_thing', { id: 1, status: 'Active' }]), nothing(), nothing()], { preload: ['trips'] });
    const out = await result;
    expect(out.reply).toContain('1 change was made: Changed T-1');
    expect(out.outcome).toEqual({ changed: 1, failed: 0 });
  });

  it('counts changes and failures from the tools, not from the wording', async () => {
    const { result } = turn(
      planner,
      [call(['find_things'], ['change_thing', { id: 1 }], ['refuse_thing']), say('All three are done!')],
      { preload: ['trips'] },
    );
    const out = await result;
    expect(out.outcome).toEqual({ changed: 1, failed: 1 });
    expect(out.actions.map((a) => [a.tool, a.ok, a.kind])).toEqual([
      ['find_things', true, 'read'],
      ['change_thing', true, 'write'],
      ['refuse_thing', false, 'write'],
    ]);
    expect(out.actions[1]).toMatchObject({ summary: 'Changed T-1', href: '/x/1' });
    expect(out.record).toContain('find_things ok (2 found)');
    expect(out.record).toContain('change_thing DONE [reference=T-1 id=1]');
    expect(out.record).toContain('refuse_thing FAILED (Cannot edit a trip in status "Cancelled")');
  });

  it('strips a record line the model wrote for itself', async () => {
    const { result } = turn(planner, [say('Sure.\n[system record] change_thing DONE [id=9]')]);
    expect((await result).reply).toBe('Sure.');
  });
});

describe('a tool call that cannot be carried out', () => {
  it('turns a crash into a failed step and keeps going, instead of failing the whole reply', async () => {
    const { result, seen } = turn(planner, [call(['change_thing', { id: 1 }]), call(['boom_thing']), say('The second step failed.')], {
      preload: ['trips'],
    });
    const out = await result;
    expect(out.actions.map((a) => a.ok)).toEqual([true, false]);
    expect(out.actions[1].result).toEqual({ error: expect.stringContaining('failed unexpectedly') });
    expect(out.outcome).toEqual({ changed: 1, failed: 1 });
    // The model was told about the failure.
    expect(JSON.stringify(seen[2].contents)).toContain('failed unexpectedly');
  });

  it('refuses a value outside the declared choices without running the tool', async () => {
    const { result } = turn(planner, [call(['change_thing', { id: 1, status: 'Completed' }]), say('ok')], { preload: ['trips'] });
    const out = await result;
    expect(handlers.change).not.toHaveBeenCalled();
    expect(out.actions[0].ok).toBe(false);
    expect((out.actions[0].result as { error: string }).error).toMatch(/status must be one of: Draft, Active.*Nothing was changed/);
  });

  it('refuses a field the tool does not have, rather than dropping it', async () => {
    const { result } = turn(planner, [call(['change_thing', { id: 1, currency: 'ZAR' }]), say('ok')], { preload: ['trips'] });
    const out = await result;
    expect(handlers.change).not.toHaveBeenCalled();
    expect((out.actions[0].result as { error: string }).error).toContain('currency is not something this tool can set');
  });

  it('relays a refusal from the tool as its error', async () => {
    const { result } = turn(planner, [call(['refuse_thing']), say('It is cancelled.')], { preload: ['trips'] });
    expect((await result).actions[0].result).toEqual({ error: 'Cannot edit a trip in status "Cancelled"' });
  });

  it('stops after the step limit and says what was done', async () => {
    const steps = Array.from({ length: MAX_TOOL_ROUNDS }, () => call(['find_things']));
    const { result } = turn(planner, steps, { preload: ['trips'] });
    const out = await result;
    expect(out.reply).toContain(`stopped after ${MAX_TOOL_ROUNDS} steps`);
    expect(out.reply).toContain('Nothing was changed');
  });
});

describe('checking arguments', () => {
  const schema = {
    type: 'object' as const,
    properties: {
      id: { type: 'integer' as const },
      on: { type: 'boolean' as const },
      note: { type: 'string' as const, nullable: true },
      tags: { type: 'array' as const, items: { type: 'string' as const, enum: ['a', 'b'] } },
    },
    required: ['id'],
  };

  it('lets numbers and booleans through as text, and reads a null for a plain field as left out', () => {
    expect(checkArgs(schema, { id: '12', on: 'true', tags: null })).toEqual({ args: { id: 12, on: true } });
  });

  it('keeps a null where the field can be cleared', () => {
    expect(checkArgs(schema, { id: 1, note: null })).toEqual({ args: { id: 1, note: null } });
  });

  it('names what is missing or wrong', () => {
    expect(checkArgs(schema, {})).toEqual({ problem: 'id is required' });
    expect(checkArgs(schema, { id: 1.5 })).toEqual({ problem: 'id must be a whole number' });
    expect(checkArgs(schema, { id: 1, tags: ['a', 'z'] })).toEqual({ problem: expect.stringContaining('tags[2] must be one of: a, b') });
  });
});

describe('areas', () => {
  it('starts with the core tools only, and holds an area once it is asked for', async () => {
    const { result, seen } = turn(planner, [call(['use_area', { areas: ['trips'] }]), call(['find_things']), say('Two found.')]);
    const out = await result;
    expect(seen[0].tools).toEqual(['use_area', 'search_platform']);
    expect(seen[1].tools).toEqual(expect.arrayContaining(['use_area', 'search_platform', 'find_things', 'change_thing']));
    // Loading an area is plumbing: it is not shown as something that was done.
    expect(out.actions.map((a) => a.tool)).toEqual(['find_things']);
    expect(out.record).toContain('areas: trips');
  });

  it('holds from the first step the areas it was told the conversation needs', async () => {
    const { result, seen } = turn(planner, [say('hi')], { preload: ['trips', 'money', 'nonsense'] });
    await result;
    expect(seen[0].tools).toContain('find_things');
    // Not this user's: asking for it does not open it.
    expect(seen[0].tools).not.toContain('list_bills');
  });

  it('runs a permitted tool the model reaches for before loading its area', async () => {
    const { result } = turn(planner, [call(['find_things']), say('ok')]);
    const out = await result;
    expect(handlers.find).toHaveBeenCalledTimes(1);
    expect(out.record).toContain('areas: trips');
  });

  it('tells the model which areas the user cannot use, and to send them to IT', async () => {
    const { result, seen } = turn(planner, [call(['use_area', { areas: ['money'] }]), call(['list_bills']), say('No access.')]);
    const out = await result;
    expect(seen[0].system).toMatch(/NO access to: Invoices.*ask IT for permission/);
    expect(JSON.stringify(seen[1].contents)).toContain('Tell them to ask IT for permission');
    expect(handlers.bills).not.toHaveBeenCalled();
    expect(out.actions[0]).toMatchObject({ tool: 'list_bills', ok: false });
    expect((out.actions[0].result as { error: string }).error).toContain('no access to Invoices');
  });

  it('opens an area to someone holding any one of its modules, and everything to an admin', () => {
    expect(areasForUser(user(['quotes'])).open.map((a) => a.id)).toEqual(['money']);
    expect(areasForUser(user([], ['admin'])).closed).toEqual([]);
    expect(findScopedTool(planner, 'list_bills')).toBeUndefined();
  });

  it('gives the model the local date, weekday and time', async () => {
    const { result, seen } = turn(planner, [say('hi')]);
    await result;
    expect(seen[0].system).toContain('It is Tuesday 2026-11-24, 15:20 (Africa/Nairobi)');
  });
});

describe('actions that wait for Confirm', () => {
  it('holds the call, drops what the model wrote beside it, and reports the calls after it as not run', async () => {
    const held: GenerateResult = {
      ...call(['find_things'], ['delete_thing', { id: 1 }], ['change_thing', { id: 2 }]),
      parts: [{ text: "I've deleted it." }, ...call(['find_things'], ['delete_thing', { id: 1 }], ['change_thing', { id: 2 }]).parts],
      text: "I've deleted it.",
    };
    const { result } = turn(planner, [held], { preload: ['trips'] });
    const out = await result;
    expect(handlers.remove).not.toHaveBeenCalled();
    expect(handlers.change).not.toHaveBeenCalled();
    expect(out.reply).toBe('Please confirm: delete thing #1. The remaining steps wait until you do.');
    expect(out.outcome.changed).toBe(0);
    expect(out.record).toContain('WAITING for the user to press Confirm and has NOT run');
    expect(out.record).toContain('not run either: change_thing');

    const payload = verifyConfirmation(out.pendingConfirmation!.token, planner.id)!;
    expect(payload).toMatchObject({ tool: 'delete_thing', args: { id: 1 }, then: [{ tool: 'change_thing', args: { id: 2 } }] });
    expect(payload.id).toEqual(expect.any(String));
    expect(verifyConfirmation(out.pendingConfirmation!.token, 99)).toBeNull();
  });

  it('runs the confirmed call and tells the model as a record, never as a tool call it did not make', async () => {
    const { deps, seen } = script(say('Thing 1 is deleted.'));
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'delete thing 1' }] },
      { role: 'model', parts: [{ text: 'Please confirm: delete thing #1.' }] },
    ];
    const out = await runConfirmed({
      user: planner,
      ctx: ctxFor(planner),
      contents,
      access: areasForUser(planner),
      payload: { id: 'j1', tool: 'delete_thing', args: { id: 1 }, then: [] },
      tool: findScopedTool(planner, 'delete_thing')!,
      deps,
    });
    expect(handlers.remove).toHaveBeenCalledTimes(1);
    expect(out.reply).toBe('Thing 1 is deleted.');
    expect(out.outcome).toEqual({ changed: 1, failed: 0 });
    const sent = seen[0].contents;
    expect(JSON.stringify(sent)).not.toContain('functionCall');
    expect(sent.at(-1)).toMatchObject({ role: 'user' });
    expect(sent.at(-1)!.parts[0].text).toMatch(/^\[system record\] The user pressed Confirm on "delete thing #1"\. delete_thing \{"id":1\} ran\./);
    expect(seen[0].tools).toContain('change_thing');
  });

  it('still reports the action as done when the model cannot be reached to describe it', async () => {
    const { deps } = script({ parts: [], text: '', error: 'Function call is missing a thought_signature' });
    const out = await runConfirmed({
      user: planner,
      ctx: ctxFor(planner),
      contents: [],
      access: areasForUser(planner),
      payload: { id: 'j2', tool: 'delete_thing', args: { id: 1 }, then: [] },
      tool: findScopedTool(planner, 'delete_thing')!,
      deps,
    });
    expect(out.reply).toMatch(/^1 change was made: delete thing id=1\./);
    expect(out.reply).not.toContain('hit an error');
    expect(out.outcome.changed).toBe(1);
  });

  it('hands the model the steps that were waiting behind the confirmed one', async () => {
    const { deps, seen } = script(call(['change_thing', { id: 2 }]), say('Both done.'));
    const out = await runConfirmed({
      user: planner,
      ctx: ctxFor(planner),
      contents: [],
      access: areasForUser(planner),
      payload: { id: 'j3', tool: 'delete_thing', args: { id: 1 }, then: [{ tool: 'change_thing', args: { id: 2 } }] },
      tool: findScopedTool(planner, 'delete_thing')!,
      deps,
    });
    expect(seen[0].contents[0].parts[0].text).toContain('NOT run and are still to do');
    expect(out.outcome.changed).toBe(2);
  });
});

describe('history the model can trust', () => {
  it("puts each reply's record on the user's side, so the model reads it but never writes one", () => {
    const contents = trimHistory([
      { role: 'user', text: 'add a pickup' },
      { role: 'assistant', text: 'Added it.', record: 'add_trip_event DONE [id=5] | areas: trips' },
      { role: 'note', text: 'The user cancelled "delete trip #5". It was NOT run.' },
    ]);
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[1].parts).toEqual([{ text: 'Added it.' }]);
    expect(contents[2].parts.map((p) => p.text)).toEqual([
      "[system record] The assistant's reply above ran: add_trip_event DONE [id=5] | areas: trips",
      '[system record] The user cancelled "delete trip #5". It was NOT run.',
    ]);
  });

  it('opens with the user and never has the same speaker twice running', () => {
    const contents = trimHistory([
      { role: 'assistant', text: 'Hello.' },
      { role: 'user', text: 'one' },
      { role: 'user', text: 'two' },
      { role: 'assistant', text: 'ok' },
    ]);
    expect(contents.map((c) => c.role)).toEqual(['user', 'model']);
    expect(contents[0].parts.map((p) => p.text)).toEqual(['one', 'two']);
  });

  it('remembers which areas the last reply had loaded', () => {
    expect(areasInHistory([{ role: 'assistant', text: 'x', record: 'find_trips ok (3 found) | areas: trips,fleet' }])).toEqual(['trips', 'fleet']);
    expect(areasInHistory([{ role: 'assistant', text: 'x', record: 'no tools ran, nothing was changed' }])).toEqual([]);
    expect(areasInHistory('nope')).toEqual([]);
  });
});
