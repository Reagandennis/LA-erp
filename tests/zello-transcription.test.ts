import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { checkAiAllowed, recordAiUsage } = vi.hoisted(() => ({ checkAiAllowed: vi.fn(), recordAiUsage: vi.fn() }));
vi.mock('../lib/ai-budget', () => ({ checkAiAllowed, recordAiUsage }));

import { transcribe, transcriptionModel, transmissionKey } from '../lib/zello-transcription';

const audio = Buffer.from('RIFF....WAVEfmt fake audio');
const answer = (text: string) =>
  Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ text, language: 'en', translation: text }) }] } }],
    usageMetadata: { promptTokenCount: 300 },
    modelVersion: 'gemini-3.1-flash-lite',
  });

describe('radio transcription', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    globalThis.zelloTranscriptCacheGlobal = undefined;
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.ZELLO_TRANSCRIBE_MODEL;
    checkAiAllowed.mockReset().mockResolvedValue({ ok: true });
    recordAiUsage.mockReset().mockResolvedValue(0);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('transcribes a transmission once, however many consoles ask at the same moment', async () => {
    let release!: () => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = () => resolve(answer('Unit 4 on scene')))));
    const key = transmissionKey('net/ops/1234/alpha', audio);

    const three = Promise.all([1, 2, 3].map((userId) => transcribe({ key, audio, mimeType: 'audio/wav', userId })));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release();
    const results = await three;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.text === 'Unit 4 on scene')).toBe(true);
    // A console asking a minute later is served from the result too.
    await transcribe({ key, audio, mimeType: 'audio/wav', userId: 4 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
  });

  it('keys on Zello’s transmission id, or on the audio itself without one', () => {
    expect(transmissionKey('net/ops/1/alpha', audio)).toBe('zello:net/ops/1/alpha');
    expect(transmissionKey(null, audio)).toBe(transmissionKey('', audio));
    expect(transmissionKey(null, audio)).not.toBe(transmissionKey(null, Buffer.from('other audio')));
  });

  it('uses a current, cheap audio model with no thinking, and keeps the key out of the URL', async () => {
    fetchMock.mockResolvedValue(answer('ok'));
    await transcribe({ key: 'k1', audio, mimeType: 'audio/wav', userId: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(transcriptionModel()).toBe('gemini-3.1-flash-lite');
    expect(String(url)).toContain('/models/gemini-3.1-flash-lite:generateContent');
    expect(String(url)).not.toContain('key=');
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
    expect(JSON.parse(String((init as RequestInit).body)).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
  });

  it('asks again without the thinking setting if a model refuses it', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'thinking_level is not supported' } }), { status: 400 }))
      .mockResolvedValueOnce(answer('retried'));
    const result = await transcribe({ key: 'k2', audio, mimeType: 'audio/wav', userId: 1 });
    expect(result.text).toBe('retried');
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body)).generationConfig.thinkingConfig).toBeUndefined();
  });

  it('stops when the AI budget is spent, without calling Gemini — and doesn’t remember the refusal', async () => {
    checkAiAllowed.mockResolvedValue({ ok: false, code: 'daily_budget', reason: 'Paused until tomorrow.' });
    const result = await transcribe({ key: 'k3', audio, mimeType: 'audio/wav', userId: 1 });
    expect(result.error).toMatch(/^ai-paused/);
    expect(fetchMock).not.toHaveBeenCalled();

    checkAiAllowed.mockResolvedValue({ ok: true });
    fetchMock.mockResolvedValue(answer('after midnight'));
    await new Promise((r) => setTimeout(r, 0));
    expect((await transcribe({ key: 'k3', audio, mimeType: 'audio/wav', userId: 1 })).text).toBe('after midnight');
  });
});
