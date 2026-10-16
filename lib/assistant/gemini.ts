import 'server-only';

import { type AiFeature, type GeminiUsage, recordAiUsage } from '../ai-budget';
import type { FunctionDeclaration } from './types';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

function apiKey(): string {
  // Dedicated assistant key if set, else the shared Gemini key.
  return process.env.AI_ASSISTANT_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
}

/** Main reasoning model (accuracy); overridable via env. */
export function assistantModel(): string {
  return process.env.AI_ASSISTANT_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash';
}

/** Cheap model used only for the isolated grounded web-search call. */
function searchModel(): string {
  return process.env.AI_SEARCH_MODEL?.trim() || 'gemini-3.1-flash-lite';
}

/**
 * How much the model thinks before answering. Thinking is billed as output —
 * the dearest tokens — and left unset a Flash model thinks at "medium". "low"
 * is enough to pick the right tool; plain lookups need none ("minimal").
 */
function assistantThinking(): string {
  return process.env.AI_ASSISTANT_THINKING?.trim() || 'low';
}
function searchThinking(): string {
  return process.env.AI_SEARCH_THINKING?.trim() || 'minimal';
}

export function isConfigured(): boolean {
  return apiKey().length > 0;
}

/** Build a functionResponse part; Gemini requires `response` to be an object. */
export function fnResp(call: GeminiFunctionCall, result: unknown): GeminiPart {
  const response = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : { result };
  return { functionResponse: { id: call.id, name: call.name, response } };
}

interface GenerateArgs {
  model: string;
  systemInstruction?: string;
  contents: GeminiContent[];
  functionDeclarations?: FunctionDeclaration[];
  googleSearch?: boolean;
  maxOutputTokens?: number;
  thinkingLevel?: string;
  /** Which feature and person to bill the call to, in the AI budget. */
  usage: { feature: AiFeature; userId?: number | null };
}

interface GenerateResult {
  parts: GeminiPart[];
  text: string;
  error: string | null;
  finishReason?: string;
}

async function generate(args: GenerateArgs): Promise<GenerateResult> {
  const tools: Record<string, unknown>[] = [];
  if (args.functionDeclarations && args.functionDeclarations.length > 0) {
    tools.push({ functionDeclarations: args.functionDeclarations });
  }
  if (args.googleSearch) tools.push({ googleSearch: {} });

  const generationConfig: Record<string, unknown> = { temperature: 0, maxOutputTokens: args.maxOutputTokens ?? 1024 };
  if (args.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: args.thinkingLevel };
  const body: Record<string, unknown> = { contents: args.contents, generationConfig };
  if (args.systemInstruction) {
    body.systemInstruction = { parts: [{ text: args.systemInstruction }] };
  }
  if (tools.length > 0) body.tools = tools;

  type Reply = {
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
    usageMetadata?: GeminiUsage;
    modelVersion?: string;
    error?: { message?: string; status?: string };
  };
  const send = async (payload: Record<string, unknown>) => {
    const res = await fetch(`${GEMINI_API_URL}/models/${args.model}:generateContent`, {
      method: 'POST',
      // In a header rather than the URL, so the key never lands in proxy or error logs.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    return { res, data: (await res.json().catch(() => null)) as Reply | null };
  };

  let reply: Awaited<ReturnType<typeof send>>;
  try {
    reply = await send(body);
    // A model that doesn't take this thinking level refuses the whole request;
    // ask again without it rather than lose the answer.
    if (reply.res.status === 400 && args.thinkingLevel && /think/i.test(reply.data?.error?.message ?? '')) {
      console.warn(`[assistant] ${args.model} refused thinkingLevel "${args.thinkingLevel}"; retrying without it.`);
      reply = await send({ ...body, generationConfig: { ...generationConfig, thinkingConfig: undefined } });
    }
  } catch {
    return { parts: [], text: '', error: 'Could not reach the AI service.' };
  }

  const { res, data } = reply;
  if (!res.ok || !data || data.error) {
    const reason = data?.error?.message ?? `AI request failed (${res.status})`;
    return { parts: [], text: '', error: reason };
  }

  await recordAiUsage({
    feature: args.usage.feature,
    model: data.modelVersion || args.model,
    userId: args.usage.userId,
    usage: data.usageMetadata,
    grounded: args.googleSearch,
  });

  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  return { parts, text, error: null, finishReason: candidate?.finishReason };
}

/** One reasoning turn with the user's scoped tools (no grounding — cost). */
export function generateWithTools(args: {
  systemInstruction: string;
  contents: GeminiContent[];
  functionDeclarations: FunctionDeclaration[];
  userId: number;
}): Promise<GenerateResult> {
  return generate({
    model: assistantModel(),
    systemInstruction: args.systemInstruction,
    contents: args.contents,
    functionDeclarations: args.functionDeclarations,
    thinkingLevel: assistantThinking(),
    usage: { feature: 'chatbot', userId: args.userId },
  });
}

/**
 * Isolated grounded call for the `web_search` tool — one cheap flash-lite request
 * with Google Search enabled. Keeps grounding off the main loop (cost control).
 */
export async function webSearch(query: string, userId: number): Promise<{ answer: string; error?: string }> {
  const result = await generate({
    model: searchModel(),
    contents: [{ role: 'user', parts: [{ text: query }] }],
    googleSearch: true,
    maxOutputTokens: 600,
    thinkingLevel: searchThinking(),
    usage: { feature: 'web_search', userId },
  });
  if (result.error) return { answer: '', error: result.error };
  return { answer: result.text || 'No results found.' };
}
