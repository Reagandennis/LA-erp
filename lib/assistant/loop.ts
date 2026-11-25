import 'server-only';

import type { AccessUser } from '@/lib/user';

import { type ConfirmPayload, type HeldCall, signConfirmation } from './confirm';
import { type Action, executeTool } from './execute';
import { fnResp, type GeminiContent, type GeminiPart, type GenerateResult } from './gemini';
import { RECORD_MARK, stripRecordMarks } from './history';
import { buildSystemInstruction } from './prompt';
import { ALL_TOOLS, areaOfTool } from './registry';
import { type AreaAccess, canUseTool } from './scope';
import type { FunctionDeclaration, ToolContext, ToolDefinition } from './types';

/** Room for: load an area, find the record, read it, change it, check, and answer. */
export const MAX_TOOL_ROUNDS = 8;

const USE_AREA = 'use_area';

/** What the turn did, counted by the server from the tools' own results. */
export interface Outcome {
  /** Changes that were made. */
  changed: number;
  /** Steps (of any kind) that were refused or failed. */
  failed: number;
}

export interface PendingConfirmation {
  token: string;
  tool: string;
  label: string;
}

export interface TurnResult {
  reply: string;
  actions: Action[];
  outcome: Outcome;
  /** The platform's own account of the turn, sent back with the history so later turns know what really ran. */
  record: string;
  pendingConfirmation?: PendingConfirmation;
}

export interface LoopDeps {
  generate: (args: {
    systemInstruction: string;
    contents: GeminiContent[];
    functionDeclarations: FunctionDeclaration[];
    userId: number;
  }) => Promise<GenerateResult>;
  /** The AI budget, re-checked before each further step. */
  budget: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  now: () => Date;
}

export interface TurnInput {
  user: AccessUser;
  ctx: ToolContext;
  /** The conversation so far, ending with the user's message. Added to as the turn runs. */
  contents: GeminiContent[];
  access: AreaAccess;
  /** Areas to hold from the first step. */
  preload?: string[];
  /** What already ran in this turn before the model was asked (a confirmed action). */
  seedActions?: Action[];
  deps: LoopDeps;
}

const readable = (tool: string) => tool.replace(/_/g, ' ').replace(/\bcustomer(s?)\b/g, 'client$1');

const errorOf = (action: Action) => String((action.result as { error?: unknown } | null)?.error ?? 'failed');

/** The record's own name for itself, when the result carries one. */
function identifierOf(result: unknown): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  const r = result as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['reference', 'number', 'id', 'tripId', 'eventId', 'dayId']) {
    const value = r[key];
    if (typeof value === 'string' || typeof value === 'number') parts.push(`${key}=${value}`);
  }
  return parts.slice(0, 3).join(' ');
}

/** How many rows a lookup returned, when it is a list; a single record has no count. */
function countOf(result: unknown): number | null {
  if (Array.isArray(result)) return result.length;
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (typeof r.total === 'number') return r.total;
  for (const key of ['results', 'items', 'rows']) {
    if (Array.isArray(r[key])) return (r[key] as unknown[]).length;
  }
  return null;
}

/** "Please confirm: decide invoice #12 (decision: approve)". */
export function confirmationLabel(tool: ToolDefinition, args: Record<string, unknown>): string {
  if (tool.confirmLabel) return tool.confirmLabel(args);
  const idKey = Object.keys(args).find((key) => key.toLowerCase().endsWith('id'));
  const rest = Object.entries(args)
    .filter(([key, value]) => key !== idKey && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 60)}`);
  return `${readable(tool.functionDeclaration.name)}${idKey ? ` #${args[idKey]}` : ''}${rest.length ? ` (${rest.join(', ')})` : ''}`;
}

export function outcomeOf(actions: Action[]): Outcome {
  return {
    changed: actions.filter((action) => action.kind === 'write' && action.ok).length,
    failed: actions.filter((action) => !action.ok).length,
  };
}

/**
 * What happened, said from the tools' results alone. Used whenever the model
 * has nothing usable to say, so that the reply is still true.
 */
export function factualReply(actions: Action[]): string {
  const done = actions.filter((action) => action.kind === 'write' && action.ok);
  const failed = actions.filter((action) => !action.ok);
  const name = (action: Action) => action.summary ?? `${readable(action.tool)} ${identifierOf(action.result)}`.trim();
  const parts: string[] = [];
  if (done.length > 0) {
    parts.push(`${done.length === 1 ? '1 change was made' : `${done.length} changes were made`}: ${done.map(name).join('; ')}.`);
  } else {
    parts.push('Nothing was changed.');
  }
  if (failed.length > 0) {
    parts.push(
      `${failed.length === 1 ? '1 step failed' : `${failed.length} steps failed`}: ${failed.map((action) => `${readable(action.tool)} (${errorOf(action)})`).join('; ')}.`,
    );
  }
  return parts.join(' ');
}

/** The turn as one line for the next turn's history. */
export function recordOf(actions: Action[], areas: Iterable<string>, held?: { label: string; then: HeldCall[] }): string {
  const steps = actions.map((action) => {
    if (!action.ok) return `${action.tool} FAILED (${errorOf(action).slice(0, 120)})`;
    if (action.kind === 'read') {
      const count = countOf(action.result);
      return `${action.tool} ok${count === null ? '' : ` (${count} found)`}`;
    }
    const id = identifierOf(action.result);
    return `${action.tool} DONE${id ? ` [${id}]` : ''}`;
  });
  if (held) {
    steps.push(`"${held.label}" is WAITING for the user to press Confirm and has NOT run`);
    if (held.then.length > 0) steps.push(`not run either: ${held.then.map((call) => call.tool).join(', ')}`);
  }
  const used = [...areas];
  return `${steps.length > 0 ? steps.join('; ') : 'no tools ran, nothing was changed'}${used.length > 0 ? ` | areas: ${used.join(',')}` : ''}`;
}

/**
 * One turn: ask the model, run the tools it calls, feed the results back,
 * until it answers in words. The reply's wording is the model's; whether
 * anything happened is decided here, from what the tools returned.
 */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const { user, ctx, contents, access, deps } = input;
  const actions: Action[] = [...(input.seedActions ?? [])];
  const openById = new Map(access.open.map((area) => [area.id, area]));
  const loaded = new Set((input.preload ?? []).filter((id) => openById.has(id)));

  const useArea: ToolDefinition | null =
    access.open.length + access.closed.length === 0
      ? null
      : {
          destructive: false,
          kind: 'read',
          functionDeclaration: {
            name: USE_AREA,
            description:
              'Load the tools for one or more areas of the platform. Call this before working in an area whose tools you do not hold yet; they are in your hands on the next step.',
            parameters: {
              type: 'object',
              properties: {
                areas: {
                  type: 'array',
                  items: { type: 'string', enum: [...access.open, ...access.closed].map((area) => area.id) },
                },
              },
              required: ['areas'],
            },
          },
          async handler(args) {
            const asked = Array.isArray(args.areas) ? (args.areas as string[]) : [];
            const noAccess = access.closed.filter((area) => asked.includes(area.id)).map((area) => area.label);
            const opened = asked.filter((id) => openById.has(id));
            for (const id of opened) loaded.add(id);
            return {
              loaded: opened,
              tools: opened.flatMap((id) => openById.get(id)!.tools.map((tool) => tool.functionDeclaration.name)),
              ...(noAccess.length > 0
                ? { noAccess, note: `The user has no access to ${noAccess.join(', ')}. Tell them to ask IT for permission.` }
                : {}),
            };
          },
        };

  const inHand = (): ToolDefinition[] => [
    ...(useArea ? [useArea] : []),
    ...access.core,
    ...[...loaded].flatMap((id) => openById.get(id)!.tools),
  ];

  /** The tool a call names: one in hand, or one this person may use in an area not loaded yet. */
  const resolve = (name: string): ToolDefinition | { error: string } => {
    const held = inHand().find((tool) => tool.functionDeclaration.name === name);
    if (held) return held;
    const known = ALL_TOOLS.find((tool) => tool.functionDeclaration.name === name);
    if (!known) return { error: `There is no tool called ${name}.` };
    const area = areaOfTool(name);
    if (!canUseTool(user, known)) {
      return { error: `The user has no access to ${area?.label ?? 'that area'}. Tell them to ask IT for permission.` };
    }
    if (area) loaded.add(area.id);
    return known;
  };

  /**
   * The areas the next turn should start with: those whose tools this turn
   * actually used. An area that was loaded and never touched is not carried,
   * or every conversation would end up holding everything.
   */
  const areasUsed = (held?: PendingConfirmation): string[] => {
    const names = [...actions.map((action) => action.tool), ...(held ? [held.tool] : [])];
    const used = new Set(names.map((name) => areaOfTool(name)?.id).filter((id): id is string => Boolean(id) && loaded.has(id!)));
    // A turn that only talked keeps what it was given, so a follow-up question still has its tools.
    return used.size > 0 ? [...used] : [...loaded].filter((id) => (input.preload ?? []).includes(id));
  };

  const finish = (reply: string, held?: { pending: PendingConfirmation; then: HeldCall[] }): TurnResult => ({
    reply: stripRecordMarks(reply) || factualReply(actions),
    actions,
    outcome: outcomeOf(actions),
    record: recordOf(actions, areasUsed(held?.pending), held ? { label: held.pending.label, then: held.then } : undefined),
    ...(held ? { pendingConfirmation: held.pending } : {}),
  });

  const ask = () =>
    deps.generate({
      systemInstruction: buildSystemInstruction({
        userName: user.name,
        now: deps.now(),
        timeZone: ctx.timeZone,
        open: access.open,
        closed: access.closed,
        loaded: [...loaded],
      }),
      contents,
      functionDeclarations: inHand().map((tool) => tool.functionDeclaration),
      userId: ctx.userId,
    });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    // A long chain of tool steps must not run past the budget either.
    if (round > 0) {
      const allowed = await deps.budget();
      if (!allowed.ok) return finish(`${allowed.reason} ${factualReply(actions)}`);
    }

    let res = await ask();
    // An answer with neither words nor a tool call is the model stumbling, not
    // an answer. Ask once more before giving up on it.
    if (!res.error && res.parts.every((part) => !part.functionCall) && !res.text && res.finishReason !== 'MAX_TOKENS') {
      res = await ask();
    }
    if (res.error) {
      return finish(
        actions.length > 0
          ? `${factualReply(actions)} (I couldn't write a fuller summary: ${res.error})`
          : `The assistant hit an error: ${res.error} Nothing was changed.`,
      );
    }

    const calls = res.parts.filter((part) => part.functionCall);
    if (calls.length === 0) {
      if (res.text) return finish(res.text);
      if (res.finishReason === 'MAX_TOKENS') {
        return finish(`That answer ran too long and was cut off. ${factualReply(actions)} Try asking for one part at a time.`);
      }
      return finish(`I didn't get an answer for that. ${factualReply(actions)} Please try again.`);
    }

    // Echo the model's tool-call turn before sending tool results back.
    contents.push({ role: 'model', parts: res.parts });
    const responseParts: GeminiPart[] = [];

    for (const [index, part] of calls.entries()) {
      const call = part.functionCall!;
      const tool = resolve(call.name);
      if ('error' in tool) {
        actions.push({ tool: call.name, args: call.args ?? {}, result: tool, ok: false, kind: 'read' });
        responseParts.push(fnResp(call, tool));
        continue;
      }
      if (tool.destructive) {
        // Held for the user's own Confirm. Whatever the model wrote beside the
        // call is dropped: it was written before anything ran. Calls lined up
        // after it are not run; the model hears about them once this one has.
        const args = call.args ?? {};
        const then = calls.slice(index + 1).map((later) => ({ tool: later.functionCall!.name, args: later.functionCall!.args ?? {} }));
        const label = confirmationLabel(tool, args);
        return finish(`Please confirm: ${label}.${then.length > 0 ? ' The remaining steps wait until you do.' : ''}`, {
          pending: { token: signConfirmation(ctx.userId, call.name, args, then), tool: call.name, label },
          then,
        });
      }
      const action = await executeTool(tool, call.args, ctx);
      // Loading an area is plumbing, not something the user asked to see.
      if (call.name !== USE_AREA) actions.push(action);
      responseParts.push(fnResp(call, action.result));
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  return finish(`I stopped after ${MAX_TOOL_ROUNDS} steps without finishing. ${factualReply(actions)} Tell me what to do next.`);
}

/**
 * The user pressed Confirm: run the held call, then let the model put the
 * outcome into words. The model is told what ran as a plain record rather
 * than shown a tool call it never made, which Gemini rejects; and if it has
 * nothing to say, the reply comes from the result itself, because by then the
 * action has happened whether or not anyone can describe it.
 */
export async function runConfirmed(
  input: Omit<TurnInput, 'seedActions'> & { payload: ConfirmPayload; tool: ToolDefinition },
): Promise<TurnResult> {
  const { payload, tool, contents, ctx } = input;
  const action = await executeTool(tool, payload.args, ctx);
  const label = confirmationLabel(tool, payload.args);

  const result = JSON.stringify(action.result) ?? 'null';
  const then =
    payload.then.length > 0
      ? ` These were NOT run and are still to do if the user still wants them: ${payload.then
          .map((call) => `${call.tool} ${JSON.stringify(call.args)}`)
          .join('; ')
          .slice(0, 800)}. Carry on with them now.`
      : ' Tell the user the outcome in a sentence or two. Do not run it again.';
  const text = `${RECORD_MARK} The user pressed Confirm on "${label}". ${payload.tool} ${JSON.stringify(payload.args)} ${
    action.ok ? 'ran' : 'was attempted and FAILED'
  }. Result: ${result.length > 1500 ? `${result.slice(0, 1500)}…` : result}.${then}`;

  const last = contents.at(-1);
  if (last?.role === 'user') last.parts.push({ text });
  else contents.push({ role: 'user', parts: [{ text }] });

  const area = areaOfTool(payload.tool);
  return runTurn({
    ...input,
    seedActions: [action],
    preload: [...(input.preload ?? []), ...(area ? [area.id] : [])],
  });
}
