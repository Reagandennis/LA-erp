import 'server-only';

import { type GeminiUsage, recordAiUsage } from '@/lib/ai-budget';
import { prisma } from '@/lib/prisma';

// ---------------------------------------------------------------------------
// Intel — AI location/security assessments.
//
// Pipeline: geocode the place -> pull a static map + street-view image ->
// run a grounded Gemini call (Google Search) for an accurate, sourced report
// -> persist everything as an IntelAssessment.
// ---------------------------------------------------------------------------

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GOOGLE_MAPS_BASE = 'https://maps.googleapis.com/maps/api';

export const RISK_LEVELS = ['Low', 'Moderate', 'High', 'Extreme'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

function geminiKey(): string {
  return process.env.AI_ASSISTANT_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
}
function geminiModel(): string {
  return process.env.AI_ASSISTANT_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash';
}
function mapsKey(): string {
  return (
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
    ''
  ).trim();
}

export function isConfigured(): boolean {
  return geminiKey().length > 0;
}

// --- Serialized shapes -----------------------------------------------------

export type AssessmentSection = { heading: string; body: string };
export type AssessmentSource = { title: string; url: string };

export type AssessmentSummary = {
  id: number;
  location: string;
  formattedAddress: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  title: string;
  riskLevel: string;
  status: string;
  hasMap: boolean;
  hasStreet: boolean;
  createdAt: string;
  createdBy: { id: number; name: string } | null;
};

export type AssessmentDetail = AssessmentSummary & {
  context: string | null;
  summary: string;
  sections: AssessmentSection[];
  recommendations: string[];
  sources: AssessmentSource[];
  model: string | null;
};

export type IntelStats = {
  total: number;
  high: number;
  recent: number;
};

const SUMMARY_SELECT = {
  id: true,
  location: true,
  formattedAddress: true,
  country: true,
  latitude: true,
  longitude: true,
  title: true,
  riskLevel: true,
  status: true,
  mapImageMime: true,
  streetImageMime: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

type SummaryRow = {
  id: number;
  location: string;
  formattedAddress: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  title: string;
  riskLevel: string;
  status: string;
  mapImageMime: string | null;
  streetImageMime: string | null;
  createdAt: Date;
  createdBy: { id: number; name: string } | null;
};

function serializeSummary(row: SummaryRow): AssessmentSummary {
  return {
    id: row.id,
    location: row.location,
    formattedAddress: row.formattedAddress,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    title: row.title,
    riskLevel: row.riskLevel,
    status: row.status,
    hasMap: Boolean(row.mapImageMime),
    hasStreet: Boolean(row.streetImageMime),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function asSections(value: unknown): AssessmentSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((s) => {
      const o = s as Record<string, unknown>;
      return { heading: String(o?.heading ?? '').trim(), body: String(o?.body ?? '').trim() };
    })
    .filter((s) => s.heading || s.body);
}
function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? '').trim()).filter(Boolean);
}
function asSources(value: unknown): AssessmentSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((s) => {
      const o = s as Record<string, unknown>;
      return { title: String(o?.title ?? '').trim(), url: String(o?.url ?? '').trim() };
    })
    .filter((s) => s.url);
}

// --- Reads -----------------------------------------------------------------

export async function listAssessments(): Promise<AssessmentSummary[]> {
  const rows = await prisma.intelAssessment.findMany({
    orderBy: [{ createdAt: 'desc' }],
    select: SUMMARY_SELECT,
  });
  return rows.map(serializeSummary);
}

export async function getAssessment(id: number): Promise<AssessmentDetail | null> {
  const row = await prisma.intelAssessment.findUnique({
    where: { id },
    select: {
      ...SUMMARY_SELECT,
      context: true,
      summary: true,
      sections: true,
      recommendations: true,
      sources: true,
      model: true,
    },
  });
  if (!row) return null;
  return {
    ...serializeSummary(row as unknown as SummaryRow),
    context: row.context,
    summary: row.summary,
    sections: asSections(row.sections),
    recommendations: asStringList(row.recommendations),
    sources: asSources(row.sources),
    model: row.model,
  };
}

export async function getAssessmentImage(
  id: number,
  kind: 'map' | 'street',
): Promise<{ mime: string; content: Buffer } | null> {
  const row = await prisma.intelAssessment.findUnique({
    where: { id },
    select: { mapImage: true, mapImageMime: true, streetImage: true, streetImageMime: true },
  });
  if (!row) return null;
  const content = kind === 'map' ? row.mapImage : row.streetImage;
  const mime = kind === 'map' ? row.mapImageMime : row.streetImageMime;
  if (!content || !mime) return null;
  return { mime, content: Buffer.from(content) };
}

export async function deleteAssessment(id: number): Promise<boolean> {
  const existing = await prisma.intelAssessment.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.intelAssessment.delete({ where: { id } });
  return true;
}

export function computeStats(rows: AssessmentSummary[]): IntelStats {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return {
    total: rows.length,
    high: rows.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Extreme').length,
    recent: rows.filter((r) => new Date(r.createdAt).getTime() >= weekAgo).length,
  };
}

// --- Geocoding -------------------------------------------------------------

type GeoResult = {
  formattedAddress: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
};

async function geocode(query: string): Promise<GeoResult> {
  const empty: GeoResult = { formattedAddress: null, country: null, latitude: null, longitude: null };

  // Prefer Google when a maps key is available (precise, returns country).
  const key = mapsKey();
  if (key) {
    try {
      const url = `${GOOGLE_MAPS_BASE}/geocode/json?address=${encodeURIComponent(query)}&key=${key}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as {
        status?: string;
        results?: Array<{
          formatted_address?: string;
          geometry?: { location?: { lat?: number; lng?: number } };
          address_components?: Array<{ long_name?: string; types?: string[] }>;
        }>;
      } | null;
      const top = data?.results?.[0];
      if (data?.status === 'OK' && top?.geometry?.location) {
        const country =
          top.address_components?.find((c) => c.types?.includes('country'))?.long_name ?? null;
        return {
          formattedAddress: top.formatted_address ?? null,
          country,
          latitude: top.geometry.location.lat ?? null,
          longitude: top.geometry.location.lng ?? null,
        };
      }
    } catch {
      // fall through to Open-Meteo
    }
  }

  // Free fallback (no key) — city/place granularity.
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = (await res.json().catch(() => null)) as {
      results?: Array<{ name?: string; country?: string; latitude?: number; longitude?: number; admin1?: string }>;
    } | null;
    const top = data?.results?.[0];
    if (top) {
      const parts = [top.name, top.admin1, top.country].filter(Boolean);
      return {
        formattedAddress: parts.join(', ') || null,
        country: top.country ?? null,
        latitude: top.latitude ?? null,
        longitude: top.longitude ?? null,
      };
    }
  } catch {
    // ignore
  }
  return empty;
}

// --- Imagery ---------------------------------------------------------------

function isImage(res: Response): boolean {
  const ct = res.headers.get('content-type') ?? '';
  return ct.startsWith('image/') && !ct.includes('svg');
}

async function fetchStaticMap(lat: number, lng: number): Promise<{ mime: string; content: Buffer } | null> {
  const key = mapsKey();
  if (!key) return null;
  const url =
    `${GOOGLE_MAPS_BASE}/staticmap?center=${lat},${lng}&zoom=13&size=640x360&scale=2` +
    `&maptype=roadmap&markers=color:0x03458f%7C${lat},${lng}&key=${key}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok || !isImage(res)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    return { mime: res.headers.get('content-type') ?? 'image/png', content: buf };
  } catch {
    return null;
  }
}

async function fetchStreetView(lat: number, lng: number): Promise<{ mime: string; content: Buffer } | null> {
  const key = mapsKey();
  if (!key) return null;
  // Check imagery exists before spending a (billed) image request.
  try {
    const metaUrl = `${GOOGLE_MAPS_BASE}/streetview/metadata?location=${lat},${lng}&key=${key}`;
    const metaRes = await fetch(metaUrl, { cache: 'no-store' });
    const meta = (await metaRes.json().catch(() => null)) as { status?: string } | null;
    if (meta?.status !== 'OK') return null;
    const url = `${GOOGLE_MAPS_BASE}/streetview?size=640x360&location=${lat},${lng}&fov=90&key=${key}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok || !isImage(res)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    return { mime: res.headers.get('content-type') ?? 'image/jpeg', content: buf };
  } catch {
    return null;
  }
}

// --- AI generation ---------------------------------------------------------

type GeneratedReport = {
  title: string;
  riskLevel: RiskLevel;
  summary: string;
  sections: AssessmentSection[];
  recommendations: string[];
  sources: AssessmentSource[];
};

/** Pull the first balanced JSON object out of a model response (handles ``` fences and prose). */
function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

type GeminiCandidate = {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
  groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
};

/**
 * How much each step thinks (billed as output, the dearest tokens). Research
 * benefits from a little; turning prose into JSON needs none.
 */
function researchThinking(): string {
  return process.env.INTEL_RESEARCH_THINKING?.trim() || 'low';
}
function structureThinking(): string {
  return process.env.INTEL_STRUCTURE_THINKING?.trim() || 'minimal';
}

/** POST to Gemini generateContent and return the first candidate's text + candidate. */
async function callGemini(
  body: Record<string, unknown>,
  meta: { userId: number; grounded?: boolean; thinkingLevel?: string },
): Promise<{ text: string; candidate: GeminiCandidate }> {
  const key = geminiKey();
  if (!key) throw new Error('The AI service is not configured. Set AI_ASSISTANT_API_KEY.');

  type Reply = { candidates?: GeminiCandidate[]; usageMetadata?: GeminiUsage; modelVersion?: string; error?: { message?: string } };
  const send = async (payload: Record<string, unknown>) => {
    const res = await fetch(`${GEMINI_API_URL}/models/${geminiModel()}:generateContent`, {
      method: 'POST',
      // In a header rather than the URL, so the key never lands in proxy or error logs.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    return { res, data: (await res.json().catch(() => null)) as Reply | null };
  };

  const config = (body.generationConfig ?? {}) as Record<string, unknown>;
  const withThinking = meta.thinkingLevel
    ? { ...body, generationConfig: { ...config, thinkingConfig: { thinkingLevel: meta.thinkingLevel } } }
    : body;

  let reply: Awaited<ReturnType<typeof send>>;
  try {
    reply = await send(withThinking);
    // A model that doesn't take this thinking level refuses the request; ask again without it.
    if (reply.res.status === 400 && meta.thinkingLevel && /think/i.test(reply.data?.error?.message ?? '')) {
      reply = await send(body);
    }
  } catch {
    throw new Error('Could not reach the AI service.');
  }

  const { res, data } = reply;
  if (!res.ok || !data || data.error) {
    throw new Error(data?.error?.message ?? `AI request failed (${res.status})`);
  }
  await recordAiUsage({
    feature: 'intel',
    model: data.modelVersion || geminiModel(),
    userId: meta.userId,
    usage: data.usageMetadata,
    grounded: meta.grounded,
  });

  const candidate = data.candidates?.[0] ?? {};
  const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  return { text, candidate };
}

function extractGroundingSources(candidate: GeminiCandidate): AssessmentSource[] {
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: AssessmentSource[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({ title: chunk.web?.title?.trim() || uri, url: uri });
  }
  return sources;
}

const RESEARCH_PROMPT = `You are a corporate security and travel-risk analyst working for a close-protection company. You produce factual, decision-ready location threat assessments for security teams planning trips and protective details.

Use the Google Search tool to ground every claim in current, real information. Never invent facts, statistics, incidents, or figures. If reliable information for a topic is unavailable, say so plainly rather than guessing.

Cover, as relevant to the location: overall context, crime and personal safety, terrorism and political violence, civil unrest and protest activity, kidnapping/express-kidnapping, road safety and transport, health and medical infrastructure, natural hazards, and local emergency resources. Tailor depth to the place.

Open with a clear bottom-line risk picture and an overall risk rating of exactly one of: Low, Moderate, High, or Extreme. Then provide well-structured sections, and finish with specific, actionable recommendations for a protective detail. Write in clear, professional British English with concrete specifics.`;

// Structuring step: a strict JSON schema turns the prose into reliable fields.
const STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short report title naming the place' },
    riskLevel: { type: 'string', enum: [...RISK_LEVELS] },
    summary: { type: 'string', description: '3-5 sentence executive summary with the bottom-line risk picture' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { heading: { type: 'string' }, body: { type: 'string' } },
        required: ['heading', 'body'],
      },
    },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'riskLevel', 'summary', 'sections', 'recommendations'],
} as const;

function pickRisk(value: unknown): RiskLevel {
  const v = String(value ?? '').trim();
  const match = RISK_LEVELS.find((r) => r.toLowerCase() === v.toLowerCase());
  return match ?? 'Moderate';
}

/** Step 1: grounded research → prose report + web sources. */
async function groundedResearch(
  location: string,
  context: string | null,
  userId: number,
): Promise<{ text: string; sources: AssessmentSource[] }> {
  const userPrompt =
    `Research and write a detailed security & travel-risk assessment for: ${location}.` +
    (context ? `\n\nPurpose / context from the requester: ${context}` : '') +
    `\n\nTreat the assessment as current as of today.`;

  const { text, candidate } = await callGemini({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: RESEARCH_PROMPT }] },
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 6000 },
  }, { userId, grounded: true, thinkingLevel: researchThinking() });

  if (text.length < 200) {
    throw new Error('The AI could not gather enough information for this location. Try a more specific place name.');
  }
  return { text, sources: extractGroundingSources(candidate) };
}

/** Step 2: structure the prose into strict JSON (no tools, schema-constrained). */
async function structureReport(researchText: string, location: string, userId: number): Promise<GeneratedReport> {
  const { text } = await callGemini({
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `Convert the following security assessment into the structured schema. ` +
              `Preserve all specifics, figures, and place names. Provide 5-9 sections and 4-8 recommendations.\n\n---\n${researchText}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8000,
      responseMimeType: 'application/json',
      responseSchema: STRUCTURE_SCHEMA,
    },
  }, { userId, thinkingLevel: structureThinking() });

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = extractJson(text);
  }
  if (!parsed) {
    throw new Error('The AI returned an unreadable report. Please try again.');
  }

  const sections = asSections(parsed.sections);
  const recommendations = asStringList(parsed.recommendations);
  const summary = String(parsed.summary ?? '').trim();
  if (!summary || sections.length === 0) {
    throw new Error('The AI report was incomplete. Please try again.');
  }

  return {
    title: String(parsed.title ?? `Security assessment — ${location}`).trim(),
    riskLevel: pickRisk(parsed.riskLevel),
    summary,
    sections,
    recommendations,
    sources: [],
  };
}

async function generateReport(location: string, context: string | null, userId: number): Promise<GeneratedReport> {
  const research = await groundedResearch(location, context, userId);
  const structured = await structureReport(research.text, location, userId);
  return { ...structured, sources: research.sources };
}

// --- Orchestrator ----------------------------------------------------------

export async function createAssessment(input: {
  userId: number;
  location: string;
  context?: string | null;
}): Promise<AssessmentDetail> {
  const location = input.location.trim();
  if (!location) throw new Error('Enter a location or place to assess.');
  const context = input.context?.trim() || null;

  // 1) Geocode (best effort) and 2) the AI report run concurrently.
  const [geo, report] = await Promise.all([geocode(location), generateReport(location, context, input.userId)]);

  // 3) Imagery (only if we have coordinates and a maps key).
  let map: { mime: string; content: Buffer } | null = null;
  let street: { mime: string; content: Buffer } | null = null;
  if (geo.latitude != null && geo.longitude != null) {
    [map, street] = await Promise.all([
      fetchStaticMap(geo.latitude, geo.longitude),
      fetchStreetView(geo.latitude, geo.longitude),
    ]);
  }

  const row = await prisma.intelAssessment.create({
    data: {
      location,
      formattedAddress: geo.formattedAddress,
      country: geo.country,
      latitude: geo.latitude,
      longitude: geo.longitude,
      context,
      title: report.title,
      riskLevel: report.riskLevel,
      summary: report.summary,
      sections: report.sections,
      recommendations: report.recommendations,
      sources: report.sources,
      mapImage: map?.content ?? null,
      mapImageMime: map?.mime ?? null,
      streetImage: street?.content ?? null,
      streetImageMime: street?.mime ?? null,
      model: geminiModel(),
      status: 'Complete',
      createdById: input.userId,
    },
    select: { id: true },
  });

  const detail = await getAssessment(row.id);
  if (!detail) throw new Error('Failed to load the saved assessment.');
  return detail;
}
