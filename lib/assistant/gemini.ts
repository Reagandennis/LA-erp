import 'server-only';

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
}

interface GenerateResult {
  parts: GeminiPart[];
  text: string;
  error: string | null;
}

async function generate(args: GenerateArgs): Promise<GenerateResult> {
  const tools: Record<string, unknown>[] = [];
  if (args.functionDeclarations && args.functionDeclarations.length > 0) {
    tools.push({ functionDeclarations: args.functionDeclarations });
  }
  if (args.googleSearch) tools.push({ googleSearch: {} });

  const body: Record<string, unknown> = {
    contents: args.contents,
    generationConfig: { temperature: 0, maxOutputTokens: args.maxOutputTokens ?? 800 },
  };
  if (args.systemInstruction) {
    body.systemInstruction = { parts: [{ text: args.systemInstruction }] };
  }
  if (tools.length > 0) body.tools = tools;

  let res: Response;
  try {
    res = await fetch(`${GEMINI_API_URL}/models/${args.model}:generateContent?key=${apiKey()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return { parts: [], text: '', error: 'Could not reach the AI service.' };
  }

  const data = (await res.json().catch(() => null)) as
    | { candidates?: { content?: { parts?: GeminiPart[] } }[]; error?: { message?: string; status?: string } }
    | null;

  if (!res.ok || !data || data.error) {
    const reason = data?.error?.message ?? `AI request failed (${res.status})`;
    return { parts: [], text: '', error: reason };
  }

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  return { parts, text, error: null };
}

/** One reasoning turn with the user's scoped tools (no grounding — cost). */
export function generateWithTools(args: {
  systemInstruction: string;
  contents: GeminiContent[];
  functionDeclarations: FunctionDeclaration[];
}): Promise<GenerateResult> {
  return generate({
    model: assistantModel(),
    systemInstruction: args.systemInstruction,
    contents: args.contents,
    functionDeclarations: args.functionDeclarations,
  });
}

/**
 * Isolated grounded call for the `web_search` tool — one cheap flash-lite request
 * with Google Search enabled. Keeps grounding off the main loop (cost control).
 */
export async function webSearch(query: string): Promise<{ answer: string; error?: string }> {
  const result = await generate({
    model: searchModel(),
    contents: [{ role: 'user', parts: [{ text: query }] }],
    googleSearch: true,
    maxOutputTokens: 600,
  });
  if (result.error) return { answer: '', error: result.error };
  return { answer: result.text || 'No results found.' };
}
