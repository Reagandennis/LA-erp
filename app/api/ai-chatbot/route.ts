import { NextRequest, NextResponse } from 'next/server';

import { checkAiAllowed, consumeAllowance } from '@/lib/ai-budget';
import { OFFICE_ZONE } from '@/lib/flight-zones';
import { claimOnce, enforceRateLimit } from '@/lib/rate-limit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { isValidTimeZone } from '@/lib/zoned-time';
import { CONFIRM_WINDOW_MS, verifyConfirmation } from '@/lib/assistant/confirm';
import { generateWithTools, isConfigured } from '@/lib/assistant/gemini';
import { areasInHistory, MAX_PROMPT_CHARS, trimHistory } from '@/lib/assistant/history';
import { type LoopDeps, runConfirmed, runTurn } from '@/lib/assistant/loop';
import { areasForUser, type AreaAccess, findScopedTool } from '@/lib/assistant/scope';
import type { ToolContext } from '@/lib/assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const deps: LoopDeps = {
  generate: generateWithTools,
  budget: () => checkAiAllowed('chatbot'),
  now: () => new Date(),
};

/**
 * The areas worth holding from the first step: the ones the last reply had
 * loaded, the ones the message names, and the modules the user attached as
 * context. A miss costs one extra step (the model asks with use_area); a
 * needless hit costs that area's tool list once.
 */
function areasToPreload(access: AreaAccess, prompt: string, history: unknown, moduleNames: Map<string, string>): string[] {
  const wanted = new Set(areasInHistory(history));
  const context = /^\[Context: ([^\]]+)\]/.exec(prompt)?.[1] ?? '';
  const slugs = context
    .split(',')
    .map((name) => moduleNames.get(name.trim().toLowerCase()))
    .filter((slug): slug is string => Boolean(slug));
  for (const area of access.open) {
    if (area.hint?.test(prompt)) wanted.add(area.id);
    const gates = area.tools.flatMap((tool) =>
      typeof tool.requiredModule === 'string' ? [tool.requiredModule] : [...(tool.requiredModule ?? [])],
    );
    if (slugs.some((slug) => gates.includes(slug))) wanted.add(area.id);
  }
  return [...wanted];
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
    | { prompt?: string; history?: unknown; confirmToken?: string; timeZone?: unknown }
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
  const access = areasForUser(auth.user);
  // Wall-clock times are read where the person is; the office's zone when the browser doesn't say.
  const timeZone = typeof body.timeZone === 'string' && isValidTimeZone(body.timeZone) ? body.timeZone : OFFICE_ZONE;
  const ctx: ToolContext = { userId: auth.user.id, userName: auth.user.name, isAdmin, user: auth.user, timeZone, request };
  const contents = trimHistory(body.history);
  const moduleNames = new Map(auth.user.modules.map((m) => [m.name.toLowerCase(), m.slug]));

  // Confirmation: run the action that was held for the user's say-so.
  if (typeof body.confirmToken === 'string' && body.confirmToken) {
    const payload = verifyConfirmation(body.confirmToken, auth.user.id);
    if (!payload) {
      return NextResponse.json({ error: 'This confirmation has expired. Nothing was changed. Please ask again.' }, { status: 400 });
    }
    const tool = findScopedTool(auth.user, payload.tool);
    if (!tool || !tool.destructive) {
      return NextResponse.json({ error: 'That action is no longer available. Nothing was changed.' }, { status: 400 });
    }
    // One press, one run: a second request with the same token does nothing.
    if (!(await claimOnce({ scope: 'ai.confirm', key: payload.id, ttlMs: CONFIRM_WINDOW_MS }))) {
      return NextResponse.json(
        { error: 'That confirmation was already used, so it was not run again. Check the record before asking once more.' },
        { status: 409 },
      );
    }
    const outcome = await runConfirmed({
      user: auth.user,
      ctx,
      contents,
      access,
      preload: areasToPreload(access, '', body.history, moduleNames),
      payload,
      tool,
      deps,
    });
    return NextResponse.json(outcome);
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  const last = contents.at(-1);
  if (last?.role === 'user') last.parts.push({ text: prompt });
  else contents.push({ role: 'user', parts: [{ text: prompt }] });

  const outcome = await runTurn({
    user: auth.user,
    ctx,
    contents,
    access,
    preload: areasToPreload(access, prompt, body.history, moduleNames),
    deps,
  });
  return NextResponse.json(outcome);
}
