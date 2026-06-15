import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_BYTES = 12 * 1024 * 1024; // ~12 MB of WAV is plenty for a single transmission

const PROMPT =
  'This audio is a short two-way radio (push-to-talk) transmission from a private security ' +
  'operations channel. Transcribe the speech as accurately as possible, verbatim, in the ' +
  'language actually spoken (it may be English, Swahili, Amharic, or another language). ' +
  'If the speech is not in English, also give a faithful English translation; if it is already ' +
  'English, repeat the transcript as the translation. If there is no intelligible speech, return ' +
  'empty strings. Respond ONLY with strict JSON of the form ' +
  '{"text": string, "language": string, "translation": string}.';

/** Transcribe a captured Zello transmission (audio body) using Gemini. */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'radio-zello')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!apiKey) return NextResponse.json({ error: 'not-configured' });

  const mimeType = (request.headers.get('content-type') ?? 'audio/wav').split(';')[0].trim() || 'audio/wav';
  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length === 0) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (buffer.length > MAX_BYTES) return NextResponse.json({ error: 'too-large' }, { status: 413 });

  // gemini-3.1-flash-lite (the app default) handles audio; override per-feature if needed.
  const model = (process.env.ZELLO_TRANSCRIBE_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.0-flash').trim();

  try {
    const res = await fetch(`${GEMINI_API_URL}/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ error: `gemini_http_${res.status}` });
    }

    const data = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    } | null;
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    let parsed: { text?: string; language?: string; translation?: string } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If the model didn't return clean JSON, treat the whole thing as the transcript.
      parsed = { text: raw.replace(/^```(?:json)?|```$/g, '').trim() };
    }

    const text = (parsed.text ?? '').trim();
    const translation = (parsed.translation ?? '').trim();
    return NextResponse.json({
      text,
      language: (parsed.language ?? '').trim(),
      // Only surface a translation when it actually differs from the transcript.
      translation: translation && translation !== text ? translation : '',
    });
  } catch {
    return NextResponse.json({ error: 'unreachable' });
  }
}
