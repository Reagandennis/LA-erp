import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { recordAiUsage } = vi.hoisted(() => ({ recordAiUsage: vi.fn() }));
vi.mock('../lib/ai-budget', () => ({ recordAiUsage }));

import { generateWithTools, webSearch } from '../lib/assistant/gemini';
import { MAX_PROMPT_CHARS, trimHistory } from '../lib/assistant/history';

describe('conversation history sent to Gemini', () => {
  it('shortens each turn and drops the oldest until it fits', () => {
    const long = 'x'.repeat(5000);
    const history = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `${i}:${long}` }));
    const contents = trimHistory(history);
    const total = contents.reduce((n, c) => n + (c.parts[0]!.text ?? '').length, 0);

    expect(contents.every((c) => (c.parts[0]!.text ?? '').length <= 1501)).toBe(true);
    expect(total).toBeLessThanOrEqual(9000);
    // The most recent turns are the ones kept.
    expect(contents.at(-1)!.parts[0]!.text!.startsWith('7:')).toBe(true);
    expect(contents.at(-1)!.role).toBe('model');
  });

  it('caps a single message', () => {
    expect(MAX_PROMPT_CHARS).toBe(4000);
  });
});

describe('Gemini requests', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.AI_ASSISTANT_API_KEY;
    delete process.env.AI_ASSISTANT_THINKING;
    recordAiUsage.mockReset().mockResolvedValue(0);
    fetchMock.mockReset().mockResolvedValue(
      Response.json({
        candidates: [{ content: { parts: [{ text: 'Done' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 6000, thoughtsTokenCount: 40, candidatesTokenCount: 5 },
        modelVersion: 'gemini-3.6-flash',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  it('thinks at "low" for the assistant, sends the key in a header, and bills the answering model', async () => {
    await generateWithTools({ systemInstruction: 'sys', contents: [], functionDeclarations: [], userId: 7 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain('key=');
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
    expect(JSON.parse(String((init as RequestInit).body)).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'chatbot', userId: 7, model: 'gemini-3.6-flash', grounded: undefined }),
    );
  });

  it('runs web search with no thinking, as a grounded call billed to the person', async () => {
    await webSearch('weather in Nairobi', 9);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
    expect(body.tools).toEqual([{ googleSearch: {} }]);
    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ feature: 'web_search', userId: 9, grounded: true }));
  });

  it('asks again without the thinking setting if a model refuses it', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Thinking level is not supported for this model.' } }), { status: 400 }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await generateWithTools({ systemInstruction: 's', contents: [], functionDeclarations: [], userId: 1 });
    warn.mockRestore();
    expect(result.text).toBe('ok');
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body)).generationConfig.thinkingConfig).toBeUndefined();
  });
});
