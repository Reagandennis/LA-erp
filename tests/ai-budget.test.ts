import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { db, enforceRateLimit, sendEmail, recordAuditEvent } = vi.hoisted(() => ({
  db: {
    aiSettings: { upsert: vi.fn(), updateMany: vi.fn() },
    aiUsage: { aggregate: vi.fn(), count: vi.fn(), create: vi.fn() },
  },
  enforceRateLimit: vi.fn(),
  sendEmail: vi.fn(),
  recordAuditEvent: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit }));
vi.mock('../lib/email', () => ({ sendEmail, isEmailConfigured: () => true }));
vi.mock('../lib/audit', () => ({ recordAuditEvent }));

import {
  checkAiAllowed,
  consumeAllowance,
  priceFor,
  recordAiUsage,
  startOfMonth,
  tokenCostUsd,
  tokensFrom,
} from '../lib/ai-budget';

// A fixed mid-month moment, so "today" and "this month" are always distinct periods.
const NOW = new Date('2026-10-16T10:00:00Z');

const SETTINGS = {
  id: 1,
  enabled: true,
  dailyBudgetUsd: 2,
  monthlyBudgetUsd: 30,
  chatMessagesPerUserPerDay: 60,
  webSearchesPerDay: 150,
  intelReportsPerUserPerDay: 10,
  radioTranscription: true,
  alertEmails: 'owner@example.com',
  lastAlert: null as string | null,
  updatedById: null,
  updatedAt: new Date(),
};

/** Spend returned for "since start of day" and "since start of month", in that order. */
function spend(today: number, month: number) {
  db.aiUsage.aggregate.mockReset();
  db.aiUsage.aggregate.mockImplementation(async ({ where }: { where: { at: { gte: Date } } }) => ({
    _sum: { costUsd: where.at.gte.getTime() === startOfMonth(NOW).getTime() ? month : today },
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (const group of Object.values(db)) for (const fn of Object.values(group)) fn.mockReset();
  enforceRateLimit.mockReset();
  sendEmail.mockReset().mockResolvedValue({ messageId: 'x' });
  recordAuditEvent.mockReset().mockResolvedValue(undefined);
  db.aiSettings.upsert.mockResolvedValue({ ...SETTINGS });
  db.aiSettings.updateMany.mockResolvedValue({ count: 1 });
  db.aiUsage.create.mockResolvedValue({});
  db.aiUsage.count.mockResolvedValue(0);
});

describe('pricing', () => {
  it('prices what actually answered — gemini-3.5-flash is served by 3.6 — and its 2027 rise', () => {
    expect(priceFor('gemini-3.6-flash', new Date('2026-10-16'))).toMatchObject({ input: 0.75, output: 3.75 });
    expect(priceFor('gemini-3.6-flash', new Date('2027-01-01'))).toMatchObject({ input: 1.5, output: 7.5 });
    expect(priceFor('gemini-3.1-flash-lite')).toMatchObject({ input: 0.25, audio: 0.5, output: 1.5 });
  });

  it('prices an unknown model at least as high as the dearest Flash', () => {
    expect(priceFor('gemini-9-ultra').output).toBeGreaterThanOrEqual(priceFor('gemini-3.6-flash', new Date('2027-02-01')).output);
  });

  it('bills thinking as output, cached input cheaply, and audio at the audio rate', () => {
    const tokens = tokensFrom({
      promptTokenCount: 10_000,
      cachedContentTokenCount: 6_000,
      candidatesTokenCount: 200,
      thoughtsTokenCount: 800,
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10_000 }],
    });
    // 4,000 plain × $0.75 + 6,000 cached × $0.075 + 1,000 out × $3.75, per million
    expect(tokenCostUsd('gemini-3.6-flash', tokens, new Date('2026-10-16'))).toBeCloseTo((4000 * 0.75 + 6000 * 0.075 + 1000 * 3.75) / 1e6, 10);

    const audio = tokensFrom({ promptTokenCount: 1000, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 900 }, { modality: 'TEXT', tokenCount: 100 }] });
    expect(audio).toMatchObject({ inputTokens: 1000, audioTokens: 900 });
    expect(tokenCostUsd('gemini-3.1-flash-lite', audio)).toBeCloseTo((100 * 0.25 + 900 * 0.5) / 1e6, 10);
  });

  it('counts search results fed back by grounding as input', () => {
    expect(tokensFrom({ promptTokenCount: 50, toolUsePromptTokenCount: 2000 }).inputTokens).toBe(2050);
  });
});

describe('checkAiAllowed', () => {
  it('allows a feature inside both budgets', async () => {
    spend(0.5, 10);
    expect(await checkAiAllowed('chatbot')).toEqual({ ok: true });
  });

  it('pauses everything once the month or the day is spent', async () => {
    spend(0.1, 30);
    expect(await checkAiAllowed('chatbot')).toMatchObject({ ok: false, code: 'monthly_budget' });
    spend(2.01, 12);
    expect(await checkAiAllowed('intel')).toMatchObject({ ok: false, code: 'daily_budget' });
  });

  it('honours the master switch and the radio switch', async () => {
    spend(0, 0);
    db.aiSettings.upsert.mockResolvedValue({ ...SETTINGS, enabled: false });
    expect(await checkAiAllowed('chatbot')).toMatchObject({ ok: false, code: 'disabled' });
    db.aiSettings.upsert.mockResolvedValue({ ...SETTINGS, radioTranscription: false });
    expect(await checkAiAllowed('radio')).toMatchObject({ ok: false, code: 'feature_off' });
    expect(await checkAiAllowed('chatbot')).toEqual({ ok: true });
  });
});

describe('consumeAllowance', () => {
  it('counts assistant messages per person, and web searches across everyone, per day', async () => {
    enforceRateLimit.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 10 });
    await consumeAllowance('chat', 7);
    await consumeAllowance('web_search', 7);
    expect(enforceRateLimit.mock.calls[0]![0]).toMatchObject({ scope: 'ai.daily.chat', key: '7', limit: 60, windowMs: 86_400_000 });
    expect(enforceRateLimit.mock.calls[1]![0]).toMatchObject({ scope: 'ai.daily.web_search', key: 'everyone', limit: 150 });

    enforceRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 3600 });
    expect(await consumeAllowance('intel', 7)).toMatchObject({ ok: false, code: 'allowance', retryAfterSeconds: 3600 });
  });
});

describe('recordAiUsage', () => {
  it('adds the per-search charge only beyond the free monthly allowance', async () => {
    spend(0, 0);
    db.aiUsage.count.mockResolvedValue(10);
    const free = await recordAiUsage({ feature: 'web_search', model: 'gemini-3.1-flash-lite', usage: { promptTokenCount: 0 }, grounded: true });
    expect(free).toBe(0);

    db.aiUsage.count.mockResolvedValue(5000);
    const paid = await recordAiUsage({ feature: 'web_search', model: 'gemini-3.1-flash-lite', usage: { promptTokenCount: 0 }, grounded: true });
    expect(paid).toBeCloseTo(0.014, 10);
  });

  it('emails once at 80% and once at 100% of the monthly budget', async () => {
    spend(1, 25); // 83%
    await recordAiUsage({ feature: 'chatbot', model: 'gemini-3.6-flash', usage: {} });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].subject).toMatch(/80%/);
    const month = NOW.toISOString().slice(0, 7);
    expect(db.aiSettings.updateMany.mock.calls[0]![0].data).toEqual({ lastAlert: `${month}:80` });

    // Already alerted at 80% this month: nothing more until 100%.
    db.aiSettings.upsert.mockResolvedValue({ ...SETTINGS, lastAlert: `${month}:80` });
    await recordAiUsage({ feature: 'chatbot', model: 'gemini-3.6-flash', usage: {} });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    spend(1, 31);
    await recordAiUsage({ feature: 'chatbot', model: 'gemini-3.6-flash', usage: {} });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls[1]![0].subject).toMatch(/reached/);
  });

  it('never breaks the feature when recording fails', async () => {
    db.aiUsage.create.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordAiUsage({ feature: 'radio', model: 'x', usage: {} })).resolves.toBe(0);
    spy.mockRestore();
  });
});
