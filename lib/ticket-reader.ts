import 'server-only';

import { type GeminiUsage, checkAiAllowed, recordAiUsage } from './ai-budget';
import { findAirport } from './airports';
import { type LookupAirport, normalizeFlightNumber } from './flight-status';
import { zonedToUtcIso } from './zoned-time';

/**
 * Reads an airline e-ticket or itinerary receipt so the flight form can be
 * filled from the document itself rather than from what FlightRadar24 has
 * seen the flight do lately. The ticket is the source of truth for the
 * booked times; it is read by the same Gemini model the assistant uses, sent
 * the file as it is (PDF or a photo of the ticket), and asked for exactly
 * what is printed, as JSON. Nothing is inferred: a field that isn't on the
 * ticket comes back null and the planner fills it in.
 *
 * Optional throughout: the form works without a ticket, and a reading that
 * fails leaves the form as it was.
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** What a ticket may be: a PDF, or a photo or screenshot of one. */
export const TICKET_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

/** Tickets are a page or two; anything bigger is more likely the wrong file. */
export const TICKET_MAX_BYTES = 10 * 1024 * 1024;

/** One flight on the ticket, as printed, with the airports resolved. */
export interface TicketSegment {
  flightNumber: string | null;
  airline: string | null;
  origin: LookupAirport | null;
  destination: LookupAirport | null;
  /** "YYYY-MM-DD" and "HH:MM", each local to its own airport. */
  departDate: string | null;
  departTime: string | null;
  arriveDate: string | null;
  arriveTime: string | null;
  cabin: string | null;
  seat: string | null;
  terminal: string | null;
  gate: string | null;
  baggage: string | null;
  /** Gate to gate, worked out from the two printed times when both are there. */
  durationMinutes: number | null;
}

export interface TicketReading {
  passengers: string[];
  /** The airline's booking reference (PNR). */
  bookingReference: string | null;
  ticketNumber: string | null;
  segments: TicketSegment[];
  /** Anything the reader was unsure of, for the planner to check. */
  notes: string | null;
}

export type TicketReadResult = { reading: TicketReading } | { error: string; status: number };

const PROMPT = [
  'You read airline e-tickets, booking confirmations and itinerary receipts for a travel operations desk.',
  'Report exactly what is printed on the document, nothing more.',
  'Dates as YYYY-MM-DD, times as 24-hour HH:MM local to the airport they belong to, airports as IATA codes, flight numbers as the airline code and number (e.g. KQ100).',
  'One segment per flight, in the order flown. Do not infer, guess or complete anything that is not printed: use null instead.',
  'If the document is not an airline ticket or itinerary, return an empty segments list and say so in notes.',
].join(' ');

/** Gemini's schema for the answer: a subset of OpenAPI, as the API takes it. */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    passengers: { type: 'ARRAY', items: { type: 'STRING' } },
    bookingReference: { type: 'STRING', nullable: true },
    ticketNumber: { type: 'STRING', nullable: true },
    notes: { type: 'STRING', nullable: true },
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          flightNumber: { type: 'STRING', nullable: true },
          airline: { type: 'STRING', nullable: true },
          departAirport: { type: 'STRING', nullable: true },
          arriveAirport: { type: 'STRING', nullable: true },
          departDate: { type: 'STRING', nullable: true },
          departTime: { type: 'STRING', nullable: true },
          arriveDate: { type: 'STRING', nullable: true },
          arriveTime: { type: 'STRING', nullable: true },
          cabin: { type: 'STRING', nullable: true },
          seat: { type: 'STRING', nullable: true },
          terminal: { type: 'STRING', nullable: true },
          gate: { type: 'STRING', nullable: true },
          baggage: { type: 'STRING', nullable: true },
        },
      },
    },
  },
  required: ['passengers', 'segments'],
};

function apiKey(): string {
  return process.env.AI_ASSISTANT_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
}

/** Reading a document needs the accurate model, not the search one; overridable. */
function ticketModel(): string {
  return process.env.AI_TICKET_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash';
}

export function isTicketMime(mime: string): mime is (typeof TICKET_MIME_TYPES)[number] {
  return (TICKET_MIME_TYPES as readonly string[]).includes(mime);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function dateKey(value: unknown): string | null {
  const text = str(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}
function clock(value: unknown): string | null {
  const text = str(value);
  const match = text?.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}
function airport(value: unknown): LookupAirport | null {
  const code = str(value)?.toUpperCase() ?? null;
  const info = code && /^[A-Z]{3}$/.test(code) ? findAirport(null, code) : null;
  if (!info) return null;
  return { iata: info.iata, icao: info.icao, name: info.name, city: info.city, country: info.country, tz: info.tz };
}

/** Gate to gate, from the printed departure and arrival in their own zones. */
function spanMinutes(segment: Omit<TicketSegment, 'durationMinutes'>): number | null {
  if (!segment.departDate || !segment.departTime || !segment.arriveDate || !segment.arriveTime) return null;
  if (!segment.origin?.tz || !segment.destination?.tz) return null;
  const departs = zonedToUtcIso(segment.departDate, segment.departTime, segment.origin.tz);
  const arrives = zonedToUtcIso(segment.arriveDate, segment.arriveTime, segment.destination.tz);
  if (!departs || !arrives) return null;
  const minutes = Math.round((new Date(arrives).getTime() - new Date(departs).getTime()) / 60_000);
  return minutes > 0 && minutes <= 30 * 60 ? minutes : null;
}

/** The model's answer made safe: only well-formed values survive, airports resolved, the duration worked out. */
export function normalizeTicketReading(raw: unknown): TicketReading {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const passengers = Array.isArray(data.passengers) ? data.passengers.map(str).filter((name): name is string => name !== null) : [];
  const segments: TicketSegment[] = (Array.isArray(data.segments) ? data.segments : [])
    .map((entry) => {
      const seg = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const flightNumber = normalizeFlightNumber(str(seg.flightNumber));
      const partial: Omit<TicketSegment, 'durationMinutes'> = {
        flightNumber,
        airline: str(seg.airline),
        origin: airport(seg.departAirport),
        destination: airport(seg.arriveAirport),
        departDate: dateKey(seg.departDate),
        departTime: clock(seg.departTime),
        arriveDate: dateKey(seg.arriveDate),
        arriveTime: clock(seg.arriveTime),
        cabin: str(seg.cabin),
        seat: str(seg.seat),
        terminal: str(seg.terminal),
        gate: str(seg.gate),
        baggage: str(seg.baggage),
      };
      return { ...partial, durationMinutes: spanMinutes(partial) };
    })
    // A segment with neither a flight number nor a route is noise.
    .filter((seg) => seg.flightNumber || (seg.origin && seg.destination));
  return {
    passengers,
    bookingReference: str(data.bookingReference)?.toUpperCase() ?? null,
    ticketNumber: str(data.ticketNumber),
    segments,
    notes: str(data.notes),
  };
}

/** Reads one ticket. Never throws: the form shows whatever went wrong. */
export async function readTicket(input: { content: Buffer; mimeType: string; userId: number }): Promise<TicketReadResult> {
  if (!apiKey()) return { error: 'E-ticket reading is not set up on the server.', status: 503 };
  if (!isTicketMime(input.mimeType)) return { error: 'A ticket is a PDF or a photo (JPEG, PNG or WebP).', status: 400 };
  if (input.content.byteLength > TICKET_MAX_BYTES) return { error: 'The ticket is larger than 10 MB.', status: 400 };

  const allowed = await checkAiAllowed('ticket');
  if (!allowed.ok) return { error: allowed.reason, status: 429 };

  const model = ticketModel();
  const body = {
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: input.mimeType, data: input.content.toString('base64') } },
          { text: 'Read this ticket.' },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // Copying printed fields needs little deliberation; thinking is billed as output.
      thinkingConfig: { thinkingLevel: process.env.AI_TICKET_THINKING?.trim() || 'low' },
    },
  };
  const send = (payload: object) =>
    fetch(`${GEMINI_API_URL}/models/${model}:generateContent`, {
      method: 'POST',
      // In a header, so the key never lands in proxy or error logs.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

  type Reply = {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: GeminiUsage;
    modelVersion?: string;
    error?: { message?: string };
  };
  let res: Response;
  try {
    res = await send(body);
    // A model that doesn't take this thinking level refuses the request; ask again without it.
    if (res.status === 400 && /think/i.test(await res.clone().text())) {
      res = await send({ ...body, generationConfig: { ...body.generationConfig, thinkingConfig: undefined } });
    }
  } catch {
    return { error: 'The AI service could not be reached.', status: 502 };
  }
  const data = (await res.json().catch(() => null)) as Reply | null;
  if (!res.ok || !data || data.error) {
    return { error: data?.error?.message ?? `The ticket could not be read (${res.status}).`, status: 502 };
  }
  await recordAiUsage({ feature: 'ticket', model: data.modelVersion || model, userId: input.userId, usage: data.usageMetadata });

  const text = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('').trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "The ticket couldn't be made sense of. Fill the flight in by hand.", status: 422 };
  }
  return { reading: normalizeTicketReading(parsed) };
}
