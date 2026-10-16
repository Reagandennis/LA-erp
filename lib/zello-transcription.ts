import 'server-only';

import { createHash } from 'crypto';

import { checkAiAllowed, type GeminiUsage, recordAiUsage } from './ai-budget';

/**
 * Radio transmissions → text, once each.
 *
 * Every open radio console hears every transmission and asks for its
 * transcript, so three dispatchers on a channel used to pay for each one
 * three times. Results are kept for a few minutes under Zello's id for the
 * transmission (or a hash of the audio when a caller doesn't send one), and a
 * request arriving while the same transmission is still being transcribed
 * waits for that result instead of starting another.
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';
const CACHE_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

const PROMPT =
  'This audio is a short two-way radio (push-to-talk) transmission from a private security ' +
  'operations channel. Transcribe the speech as accurately as possible, verbatim, in the ' +
  'language actually spoken (it may be English, Swahili, Amharic, or another language). ' +
  'If the speech is not in English, also give a faithful English translation; if it is already ' +
  'English, repeat the transcript as the translation. If there is no intelligible speech, return ' +
  'empty strings. Respond ONLY with strict JSON of the form ' +
  '{"text": string, "language": string, "translation": string}.';

export interface Transcript {
  text?: string;
  language?: string;
  translation?: string;
  error?: string;
}

declare global {
  var zelloTranscriptCacheGlobal: Map<string, { at: number; result: Promise<Transcript> }> | undefined;
}

function cache() {
  globalThis.zelloTranscriptCacheGlobal ??= new Map();
  return globalThis.zelloTranscriptCacheGlobal;
}

/** The transmission's identity: Zello's own when sent, else the audio itself. */
export function transmissionKey(header: string | null, audio: Buffer): string {
  const given = (header ?? '').trim();
  if (given && given.length <= 300) return `zello:${given}`;
  return `audio:${createHash('sha256').update(audio).digest('hex')}`;
}

/** gemini-3.1-flash-lite is the cheapest Gemini for audio ($0.50 per 1M audio tokens). */
export function transcriptionModel(): string {
  return process.env.ZELLO_TRANSCRIBE_MODEL?.trim() || 'gemini-3.1-flash-lite';
}

export async function transcribe(input: {
  key: string;
  audio: Buffer;
  mimeType: string;
  userId: number;
}): Promise<Transcript> {
  const entries = cache();
  const now = Date.now();
  for (const [k, v] of entries) if (now - v.at > CACHE_MS) entries.delete(k);

  const known = entries.get(input.key);
  if (known) return known.result;

  const result = run(input);
  entries.set(input.key, { at: now, result });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  // A failure is not remembered: the next console to ask tries again.
  void result.then((r) => {
    if (r.error) entries.delete(input.key);
  });
  return result;
}

async function run(input: { audio: Buffer; mimeType: string; userId: number }): Promise<Transcript> {
  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!apiKey) return { error: 'not-configured' };

  const allowed = await checkAiAllowed('radio');
  if (!allowed.ok) return { error: `ai-paused: ${allowed.reason}` };

  const model = transcriptionModel();
  const body = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: input.mimeType, data: input.audio.toString('base64') } }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      // Writing down what was said needs no deliberation; thinking is billed as output.
      thinkingConfig: { thinkingLevel: process.env.ZELLO_TRANSCRIBE_THINKING?.trim() || 'minimal' },
    },
  };

  const send = (payload: object) =>
    fetch(`${GEMINI_API_URL}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

  try {
    let res = await send(body);
    // A model that doesn't take this thinking level refuses the request; ask again without it.
    if (res.status === 400 && /think/i.test(await res.clone().text())) {
      res = await send({ ...body, generationConfig: { ...body.generationConfig, thinkingConfig: undefined } });
    }
    if (!res.ok) return { error: `gemini_http_${res.status}` };

    const data = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: GeminiUsage;
      modelVersion?: string;
    } | null;
    await recordAiUsage({ feature: 'radio', model: data?.modelVersion || model, userId: input.userId, usage: data?.usageMetadata });

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let parsed: Transcript = {};
    try {
      parsed = JSON.parse(raw) as Transcript;
    } catch {
      // If the model didn't return clean JSON, treat the whole thing as the transcript.
      parsed = { text: raw.replace(/^```(?:json)?|```$/g, '').trim() };
    }
    const text = (parsed.text ?? '').trim();
    const translation = (parsed.translation ?? '').trim();
    return {
      text,
      language: (parsed.language ?? '').trim(),
      // Only surface a translation when it actually differs from the transcript.
      translation: translation && translation !== text ? translation : '',
    };
  } catch {
    return { error: 'unreachable' };
  }
}
