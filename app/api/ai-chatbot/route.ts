import { NextRequest, NextResponse } from 'next/server';

import { checkAiAllowed, consumeAllowance } from '@/lib/ai-budget';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole, type AccessUser } from '@/lib/user';
import { signConfirmation, verifyConfirmation } from '@/lib/assistant/confirm';
import {
  fnResp,
  generateWithTools,
  isConfigured,
  type GeminiContent,
  type GeminiPart,
} from '@/lib/assistant/gemini';
import { MAX_PROMPT_CHARS, trimHistory } from '@/lib/assistant/history';
import { findScopedTool, scopeToolsForUser } from '@/lib/assistant/scope';
import type { ToolContext, ToolDefinition } from '@/lib/assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_TOOL_ROUNDS = 5;
interface Action {
  tool: string;
  result: unknown;
}

function buildSystemInstruction(user: AccessUser): string {
  const today = new Date().toISOString().slice(0, 10);
  const modules = user.modules.map((m) => m.name).join(', ') || 'none';
  return [
    'You are Jarvis, the operations assistant with full command of this ERP platform.',
    `Today is ${today}. You are assisting ${user.name}.`,
    'You can run the whole business from chat: clients and the CRM pipeline (deals, stages, activities, entities), quotes (create, submit, approve, send), invoices (create, submit for approval, approve/decline, send, record payments), trips and fleet, products, calendar, personal tasks and notes, contacts, files, contracts/NDAs, personnel, shift handovers, cross-platform due dates, and feedback.',
    `Areas this user can access: ${modules}.`,
    'Permissions: every tool call runs as the requesting user, and the server enforces their module access, role, and workflow rights. Examples: an invoice must be submitted to an approver and approved by someone OTHER than its creator before it can be sent or paid; only the assigned approver (or another admin) may approve. If an action is refused, relay the reason — never try to work around a permission or workflow rule.',
    'Rules:',
    '- To act on a specific record, first call the relevant list_* tool to find its numeric ID. Never invent IDs.',
    '- Only call web_search for information outside the platform (news, current facts, external lookups).',
    '- After tools run, confirm briefly in plain language what you did. Never claim success unless a tool returned it.',
    '- If a tool returns an "error" field, explain it to the user and suggest a fix. Be concise.',
  ].join('\n');
}

function confirmationLabel(name: string, args: Record<string, unknown>): string {
  const idKey = Object.keys(args).find((k) => k.toLowerCase().endsWith('id'));
  const idPart = idKey ? ` #${args[idKey]}` : '';
  // Tool names keep the `customer` identifier; users see the business term "client".
  const readable = name.replace(/_/g, ' ').replace(/\bcustomer(s?)\b/g, 'client$1');
  return `${readable}${idPart}`;
}

interface LoopOutcome {
  reply: string;
  actions: Action[];
  pendingConfirmation?: { token: string; tool: string; label: string };
}

async function runLoop(
  contents: GeminiContent[],
  scopedTools: ToolDefinition[],
  systemInstruction: string,
  ctx: ToolContext,
  seedActions: Action[],
): Promise<LoopOutcome> {
  const declarations = scopedTools.map((t) => t.functionDeclaration);
  const actions: Action[] = [...seedActions];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    // A long chain of tool steps must not run past the budget either.
    if (round > 0) {
      const allowed = await checkAiAllowed('chatbot');
      if (!allowed.ok) return { reply: allowed.reason, actions };
    }
    const res = await generateWithTools({ systemInstruction, contents, functionDeclarations: declarations, userId: ctx.userId });
    if (res.error) return { reply: `The assistant hit an error: ${res.error}`, actions };

    const calls = res.parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      if (!res.text && res.finishReason === 'MAX_TOKENS') {
        return { reply: 'That answer ran too long and was cut off. Try asking for something more specific.', actions };
      }
      return { reply: res.text || 'Done.', actions };
    }

    // Echo the model's tool-call turn before sending tool results back.
    contents.push({ role: 'model', parts: res.parts });
    const responseParts: GeminiPart[] = [];

    for (const part of calls) {
      const call = part.functionCall!;
      const tool = scopedTools.find((t) => t.functionDeclaration.name === call.name);
      if (!tool) {
        responseParts.push(fnResp(call, { error: 'unknown_or_not_permitted_tool' }));
        continue;
      }
      if (tool.destructive) {
        // Pause and ask the user to confirm before executing anything destructive.
        return {
          reply: res.text || `Please confirm: ${confirmationLabel(call.name, call.args ?? {})}.`,
          actions,
          pendingConfirmation: {
            token: signConfirmation(ctx.userId, call.name, call.args ?? {}),
            tool: call.name,
            label: confirmationLabel(call.name, call.args ?? {}),
          },
        };
      }
      const result = await tool.handler(call.args ?? {}, ctx);
      actions.push({ tool: call.name, result });
      responseParts.push(fnResp(call, result));
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  return { reply: 'I stopped after several steps to avoid looping. Please refine the request.', actions };
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'ai-chatbot')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Each call can fan out to several Gemini tool rounds — keep it bounded.
  const rateLimit = await enforceRateLimit({
    scope: 'ai.chat',
    key: `${auth.user.id}`,
    limit: 20,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many assistant requests. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  if (!isConfigured()) {
    return NextResponse.json({ error: 'The AI assistant is not configured (missing GEMINI_API_KEY).' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | { prompt?: string; history?: unknown; confirmToken?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  if (typeof body.prompt === 'string' && body.prompt.trim().length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      { error: `Messages are limited to ${MAX_PROMPT_CHARS.toLocaleString('en-US')} characters. Shorten it, or ask about one part at a time.` },
      { status: 413 },
    );
  }

  // The AI budget (Admin → Settings → AI usage), then this person's daily allowance.
  const allowed = await checkAiAllowed('chatbot');
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.reason, retryAfterSeconds: allowed.retryAfterSeconds }, { status: 429 });
  }
  const allowance = await consumeAllowance('chat', auth.user.id);
  if (!allowance.ok) {
    return NextResponse.json({ error: allowance.reason, retryAfterSeconds: allowance.retryAfterSeconds }, { status: 429 });
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const scopedTools = scopeToolsForUser(auth.user);
  const ctx: ToolContext = { userId: auth.user.id, userName: auth.user.name, isAdmin, request };
  const systemInstruction = buildSystemInstruction(auth.user);
  const contents = trimHistory(body.history);

  // Confirmation re-invoke: execute the previously-held destructive call, then
  // let the model summarise the result.
  if (typeof body.confirmToken === 'string' && body.confirmToken) {
    const payload = verifyConfirmation(body.confirmToken, auth.user.id);
    if (!payload) {
      return NextResponse.json({ error: 'This confirmation has expired. Please ask again.' }, { status: 400 });
    }
    const tool = findScopedTool(auth.user, payload.tool);
    if (!tool || !tool.destructive) {
      return NextResponse.json({ error: 'That action is no longer available.' }, { status: 400 });
    }
    const result = await tool.handler(payload.args, ctx);
    const seedActions: Action[] = [{ tool: payload.tool, result }];
    // Seed a synthetic call/response pair so the model can phrase a reply.
    contents.push({ role: 'model', parts: [{ functionCall: { name: payload.tool, args: payload.args } }] });
    contents.push({ role: 'user', parts: [fnResp({ name: payload.tool, args: payload.args }, result)] });
    const outcome = await runLoop(contents, scopedTools, systemInstruction, ctx, seedActions);
    return NextResponse.json(outcome);
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  contents.push({ role: 'user', parts: [{ text: prompt }] });

  const outcome = await runLoop(contents, scopedTools, systemInstruction, ctx, []);
  return NextResponse.json(outcome);
}
