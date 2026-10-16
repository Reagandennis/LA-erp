import 'server-only';

import type { AiSettings } from '@prisma/client';

import { recordAuditEvent } from './audit';
import { isEmailConfigured, sendEmail } from './email';
import { prisma } from './prisma';
import { enforceRateLimit } from './rate-limit';

/**
 * Keeping Gemini spending predictable.
 *
 * Every Gemini call (the assistant, its web searches, Intel reports, radio
 * transcription) is recorded with the tokens Google reports and a cost
 * estimated from Google's published prices. Before a feature calls Gemini it
 * asks `checkAiAllowed`: past the daily or monthly budget, AI features stop
 * until the period turns over. Per-person allowances cap how much any one
 * account — or a stolen session — can run up. Days and months are UTC.
 *
 * This is the app's own brake. The hard stop is Google's: a prepaid balance
 * in AI Studio, which halts every key when it reaches zero.
 */

export type AiFeature = 'chatbot' | 'web_search' | 'intel' | 'radio';

interface Price {
  /** USD per 1M tokens. */
  input: number;
  audio: number;
  cached: number;
  output: number;
}

/** Google's paid-tier prices (ai.google.dev/gemini-api/docs/pricing, October 2026). */
const PRICES: Array<{ match: RegExp; price: Price; from?: string }> = [
  // Flash 3.6 / 3.8 double on 1 January 2027; the later entry wins from that date.
  { match: /^gemini-3\.[68]-flash$/, price: { input: 0.75, audio: 0.75, cached: 0.075, output: 3.75 } },
  { match: /^gemini-3\.[68]-flash$/, price: { input: 1.5, audio: 1.5, cached: 0.15, output: 7.5 }, from: '2027-01-01' },
  { match: /^gemini-3-flash/, price: { input: 0.5, audio: 1.0, cached: 0.05, output: 3.0 } },
  { match: /^gemini-3\.5-flash-lite/, price: { input: 0.3, audio: 0.3, cached: 0.03, output: 2.5 } },
  { match: /^gemini-3\.1-flash-lite/, price: { input: 0.25, audio: 0.5, cached: 0.025, output: 1.5 } },
  { match: /^gemini-2\.5-flash-lite/, price: { input: 0.1, audio: 0.3, cached: 0.01, output: 0.4 } },
  { match: /^gemini-2\.5-flash/, price: { input: 0.3, audio: 1.0, cached: 0.03, output: 2.5 } },
];

/** An unlisted model is priced like the dearest Flash, so a budget is never underestimated. */
const UNKNOWN_PRICE: Price = { input: 1.5, audio: 3.0, cached: 0.15, output: 7.5 };

/** Grounding with Google Search: free allowance per month (shared by Gemini 3+), then per request. */
export const FREE_GROUNDED_PER_MONTH = 5000;
const GROUNDED_PRICE_USD = 14 / 1000;

export function priceFor(model: string, at: Date = new Date()): Price {
  const day = at.toISOString().slice(0, 10);
  let found: Price | null = null;
  for (const entry of PRICES) {
    if (entry.match.test(model) && (!entry.from || day >= entry.from)) found = entry.price;
  }
  return found ?? UNKNOWN_PRICE;
}

/** `usageMetadata` as Gemini's generateContent returns it. */
export interface GeminiUsage {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  /** Search results fed back to the model by grounding; billed as input. */
  toolUsePromptTokenCount?: number;
  promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
}

export interface UsageTokens {
  inputTokens: number;
  cachedTokens: number;
  audioTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export function tokensFrom(usage: GeminiUsage | null | undefined): UsageTokens {
  const audio = (usage?.promptTokensDetails ?? [])
    .filter((d) => d.modality === 'AUDIO')
    .reduce((sum, d) => sum + (d.tokenCount ?? 0), 0);
  return {
    inputTokens: (usage?.promptTokenCount ?? 0) + (usage?.toolUsePromptTokenCount ?? 0),
    cachedTokens: usage?.cachedContentTokenCount ?? 0,
    audioTokens: audio,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    thinkingTokens: usage?.thoughtsTokenCount ?? 0,
  };
}

/** Token cost in USD (grounding is added separately). Thinking is billed as output. */
export function tokenCostUsd(model: string, tokens: UsageTokens, at: Date = new Date()): number {
  const price = priceFor(model, at);
  const plainInput = Math.max(0, tokens.inputTokens - tokens.cachedTokens - tokens.audioTokens);
  return (
    (plainInput * price.input +
      tokens.audioTokens * price.audio +
      tokens.cachedTokens * price.cached +
      (tokens.outputTokens + tokens.thinkingTokens) * price.output) /
    1_000_000
  );
}

// --- Periods (UTC) -------------------------------------------------------------

export function startOfDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// --- Settings ------------------------------------------------------------------

export async function getAiSettings(): Promise<AiSettings> {
  return prisma.aiSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export async function spentSince(since: Date): Promise<number> {
  const { _sum } = await prisma.aiUsage.aggregate({ where: { at: { gte: since } }, _sum: { costUsd: true } });
  return _sum.costUsd ?? 0;
}

// --- Guards --------------------------------------------------------------------

export type AiRefusal = {
  ok: false;
  code: 'disabled' | 'feature_off' | 'daily_budget' | 'monthly_budget' | 'allowance';
  reason: string;
  retryAfterSeconds?: number;
};

const FEATURE_NAMES: Record<AiFeature, string> = {
  chatbot: 'The assistant',
  web_search: 'Web search',
  intel: 'Intel reports',
  radio: 'Radio transcription',
};

/** May this feature call Gemini right now? Budgets apply to every feature alike. */
export async function checkAiAllowed(feature: AiFeature): Promise<{ ok: true } | AiRefusal> {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    return { ok: false, code: 'disabled', reason: 'AI features are switched off by an administrator.' };
  }
  if (feature === 'radio' && !settings.radioTranscription) {
    return { ok: false, code: 'feature_off', reason: 'Radio transcription is switched off by an administrator.' };
  }

  const now = new Date();
  const [today, month] = await Promise.all([spentSince(startOfDay(now)), spentSince(startOfMonth(now))]);
  if (month >= settings.monthlyBudgetUsd) {
    return {
      ok: false,
      code: 'monthly_budget',
      reason: `${FEATURE_NAMES[feature]} is paused: this month's AI budget ($${settings.monthlyBudgetUsd.toFixed(2)}) has been used. An administrator can raise it in Admin → Settings → AI usage.`,
    };
  }
  if (today >= settings.dailyBudgetUsd) {
    const resume = Math.ceil((startOfDay(now).getTime() + DAY_MS - now.getTime()) / 1000);
    return {
      ok: false,
      code: 'daily_budget',
      reason: `${FEATURE_NAMES[feature]} is paused until tomorrow: today's AI budget ($${settings.dailyBudgetUsd.toFixed(2)}) has been used.`,
      retryAfterSeconds: resume,
    };
  }
  return { ok: true };
}

export type Allowance = 'chat' | 'web_search' | 'intel';

/**
 * Use one of today's allowance. Chat and Intel are per person; web search is
 * shared by everyone. The count resets at midnight UTC.
 */
export async function consumeAllowance(kind: Allowance, userId: number): Promise<{ ok: true } | AiRefusal> {
  const settings = await getAiSettings();
  const config = {
    chat: { limit: settings.chatMessagesPerUserPerDay, key: `${userId}`, what: 'assistant messages' },
    web_search: { limit: settings.webSearchesPerDay, key: 'everyone', what: 'web searches' },
    intel: { limit: settings.intelReportsPerUserPerDay, key: `${userId}`, what: 'Intel reports' },
  }[kind];

  const result = await enforceRateLimit({ scope: `ai.daily.${kind}`, key: config.key, limit: config.limit, windowMs: DAY_MS });
  if (result.allowed) return { ok: true };
  return {
    ok: false,
    code: 'allowance',
    reason: `Today's limit of ${config.limit} ${config.what} has been reached${kind === 'web_search' ? ' for everyone' : ''}. It resets at midnight UTC.`,
    retryAfterSeconds: result.retryAfterSeconds,
  };
}

// --- Recording -----------------------------------------------------------------

export async function recordAiUsage(input: {
  feature: AiFeature;
  model: string;
  userId?: number | null;
  usage: GeminiUsage | null | undefined;
  grounded?: boolean;
}): Promise<number> {
  try {
    const now = new Date();
    const tokens = tokensFrom(input.usage);
    let cost = tokenCostUsd(input.model, tokens, now);
    if (input.grounded) {
      const used = await prisma.aiUsage.count({ where: { grounded: true, at: { gte: startOfMonth(now) } } });
      if (used >= FREE_GROUNDED_PER_MONTH) cost += GROUNDED_PRICE_USD;
    }
    await prisma.aiUsage.create({
      data: {
        feature: input.feature,
        model: input.model,
        userId: input.userId ?? null,
        ...tokens,
        grounded: Boolean(input.grounded),
        costUsd: cost,
      },
    });
    await alertIfNearBudget(now);
    return cost;
  } catch (error) {
    // Losing a usage row must never break the feature that made the call.
    console.error('[ai-budget] could not record usage:', error instanceof Error ? error.message : error);
    return 0;
  }
}

/** Email the alert list once at 80%, and once at 100%, of each month's budget. */
async function alertIfNearBudget(now: Date): Promise<void> {
  const settings = await getAiSettings();
  const spent = await spentSince(startOfMonth(now));
  const level = spent >= settings.monthlyBudgetUsd ? 100 : spent >= settings.monthlyBudgetUsd * 0.8 ? 80 : 0;
  if (level === 0) return;

  const month = now.toISOString().slice(0, 7);
  const [lastMonth, lastLevel] = (settings.lastAlert ?? '').split(':');
  if (lastMonth === month && Number(lastLevel) >= level) return;

  // Claim this alert first, so concurrent calls don't each send one.
  const claimed = await prisma.aiSettings.updateMany({
    where: { id: 1, lastAlert: settings.lastAlert },
    data: { lastAlert: `${month}:${level}` },
  });
  if (claimed.count === 0) return;

  const message =
    level === 100
      ? `This month's AI budget of $${settings.monthlyBudgetUsd.toFixed(2)} has been reached ($${spent.toFixed(2)} so far). AI features are paused until next month, or until the budget is raised.`
      : `AI spending has reached ${Math.round((spent / settings.monthlyBudgetUsd) * 100)}% of this month's $${settings.monthlyBudgetUsd.toFixed(2)} budget ($${spent.toFixed(2)} so far).`;

  await recordAuditEvent({
    action: level === 100 ? 'ai.budget.reached' : 'ai.budget.warning',
    entityType: 'settings',
    entityId: 'ai',
    metadata: { month, spentUsd: Number(spent.toFixed(4)), budgetUsd: settings.monthlyBudgetUsd },
  }).catch(() => {});

  const to = settings.alertEmails.split(',').map((e) => e.trim()).filter(Boolean);
  if (to.length === 0 || !isEmailConfigured()) return;
  await sendEmail({
    to,
    subject: level === 100 ? 'LA-ERP: AI budget reached — AI paused' : 'LA-ERP: AI budget at 80%',
    html: `<p>${message}</p><p>Details: Admin → Settings → AI usage.</p>`,
    text: `${message}\n\nDetails: Admin → Settings → AI usage.`,
  }).catch((error) => console.error('[ai-budget] could not send the alert:', error instanceof Error ? error.message : error));
}

// --- Overview (admin) ----------------------------------------------------------

export async function aiUsageOverview() {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const since30 = new Date(startOfDay(now).getTime() - 29 * DAY_MS);
  const settings = await getAiSettings();

  const [today, month, byFeature, byUser, grounded, recent] = await Promise.all([
    spentSince(startOfDay(now)),
    spentSince(monthStart),
    prisma.aiUsage.groupBy({
      by: ['feature'],
      where: { at: { gte: monthStart } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true, thinkingTokens: true },
      _count: { _all: true },
    }),
    prisma.aiUsage.groupBy({
      by: ['userId'],
      where: { at: { gte: monthStart } },
      _sum: { costUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { costUsd: 'desc' } },
      take: 10,
    }),
    prisma.aiUsage.count({ where: { grounded: true, at: { gte: monthStart } } }),
    prisma.aiUsage.findMany({ where: { at: { gte: since30 } }, select: { at: true, costUsd: true } }),
  ]);

  const names = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: byUser.map((u) => u.userId).filter((id): id is number => id !== null) } },
        select: { id: true, name: true, email: true },
      })
    ).map((u) => [u.id, u.name || u.email]),
  );

  const days = Array.from({ length: 30 }, (_, i) => {
    const start = new Date(since30.getTime() + i * DAY_MS);
    return { day: start.toISOString().slice(0, 10), costUsd: 0 };
  });
  for (const row of recent) {
    const index = Math.floor((startOfDay(row.at).getTime() - since30.getTime()) / DAY_MS);
    if (days[index]) days[index]!.costUsd += row.costUsd;
  }

  return {
    settings: {
      enabled: settings.enabled,
      dailyBudgetUsd: settings.dailyBudgetUsd,
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      chatMessagesPerUserPerDay: settings.chatMessagesPerUserPerDay,
      webSearchesPerDay: settings.webSearchesPerDay,
      intelReportsPerUserPerDay: settings.intelReportsPerUserPerDay,
      radioTranscription: settings.radioTranscription,
      alertEmails: settings.alertEmails,
    },
    todayUsd: today,
    monthUsd: month,
    groundedThisMonth: grounded,
    freeGroundedPerMonth: FREE_GROUNDED_PER_MONTH,
    byFeature: byFeature.map((f) => ({
      feature: f.feature,
      calls: f._count._all,
      costUsd: f._sum.costUsd ?? 0,
      inputTokens: f._sum.inputTokens ?? 0,
      outputTokens: (f._sum.outputTokens ?? 0) + (f._sum.thinkingTokens ?? 0),
    })),
    byUser: byUser.map((u) => ({
      userId: u.userId,
      name: u.userId === null ? 'System' : names.get(u.userId) ?? `User ${u.userId}`,
      calls: u._count._all,
      costUsd: u._sum.costUsd ?? 0,
    })),
    days,
  };
}

export type AiUsageOverview = Awaited<ReturnType<typeof aiUsageOverview>>;
