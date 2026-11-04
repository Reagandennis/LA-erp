import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { checkAiAllowed, recordAiUsage } = vi.hoisted(() => ({ checkAiAllowed: vi.fn(), recordAiUsage: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('../lib/ai-budget', () => ({ checkAiAllowed, recordAiUsage }));

import { normalizeTicketReading, readTicket } from '../lib/ticket-reader';

const fetchMock = vi.fn();
const reply = (answer: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 80 },
      modelVersion: 'gemini-3.5-flash',
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

/** KQ 100 Nairobi → London as a ticket prints it. */
const printed = {
  passengers: ['MR JOHN DOE'],
  bookingReference: 'abc123',
  ticketNumber: '706-1234567890',
  notes: null,
  segments: [
    {
      flightNumber: 'KQ 100',
      airline: 'Kenya Airways',
      departAirport: 'nbo',
      arriveAirport: 'LHR',
      departDate: '2026-11-06',
      departTime: '9:30',
      arriveDate: '2026-11-06',
      arriveTime: '15:30',
      cabin: 'Business',
      seat: '2A',
      terminal: '1A',
      gate: null,
      baggage: '2 x 32kg',
    },
  ],
};

describe('normalizeTicketReading', () => {
  it('keeps what is printed, resolves the airports and works out the flight time', () => {
    const reading = normalizeTicketReading(printed);
    expect(reading).toMatchObject({ passengers: ['MR JOHN DOE'], bookingReference: 'ABC123', ticketNumber: '706-1234567890' });
    expect(reading.segments).toHaveLength(1);
    expect(reading.segments[0]).toMatchObject({
      flightNumber: 'KQ100',
      airline: 'Kenya Airways',
      origin: { iata: 'NBO', tz: 'Africa/Nairobi' },
      destination: { iata: 'LHR', tz: 'Europe/London' },
      departTime: '09:30',
      arriveTime: '15:30',
      cabin: 'Business',
      seat: '2A',
      baggage: '2 x 32kg',
      // 09:30 Nairobi (06:30Z) to 15:30 London (15:30Z, GMT in November).
      durationMinutes: 540,
    });
  });

  it('turns anything malformed into nulls rather than guesses', () => {
    const reading = normalizeTicketReading({
      passengers: 'not a list',
      segments: [
        { flightNumber: 'KQ100', departDate: '6 Nov 2026', departTime: '25:99', departAirport: 'Nairobi', arriveAirport: 'LHR' },
        { flightNumber: null, departAirport: null, arriveAirport: null, seat: '1A' },
        'junk',
      ],
    });
    expect(reading.passengers).toEqual([]);
    expect(reading.segments).toHaveLength(1);
    expect(reading.segments[0]).toMatchObject({
      flightNumber: 'KQ100',
      origin: null,
      destination: { iata: 'LHR' },
      departDate: null,
      departTime: null,
      durationMinutes: null,
    });
    expect(normalizeTicketReading(null)).toEqual({ passengers: [], bookingReference: null, ticketNumber: null, segments: [], notes: null });
  });
});

describe('readTicket', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    checkAiAllowed.mockReset();
    recordAiUsage.mockReset();
    checkAiAllowed.mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const pdf = { content: Buffer.from('%PDF-1.4 ticket'), mimeType: 'application/pdf', userId: 7 };

  it('sends the file itself, asks for JSON, and bills the read to the ticket feature', async () => {
    fetchMock.mockResolvedValueOnce(reply(printed));

    const result = await readTicket(pdf);

    expect('reading' in result && result.reading.segments[0]?.flightNumber).toBe('KQ100');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/models/gemini-3.5-flash:generateContent');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: 'application/pdf', data: pdf.content.toString('base64') });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ feature: 'ticket', userId: 7, model: 'gemini-3.5-flash' }));
  });

  it('stays within the AI budget and the kinds of file a ticket can be', async () => {
    checkAiAllowed.mockResolvedValueOnce({ ok: false, reason: 'Paused for today.' });
    expect(await readTicket(pdf)).toEqual({ error: 'Paused for today.', status: 429 });
    expect(fetchMock).not.toHaveBeenCalled();

    expect(await readTicket({ ...pdf, mimeType: 'application/zip' })).toMatchObject({ status: 400 });

    vi.stubEnv('GEMINI_API_KEY', '');
    expect(await readTicket(pdf)).toMatchObject({ status: 503 });
  });

  it('says so when the answer is not a reading', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }), { status: 200 }),
    );
    expect(await readTicket(pdf)).toMatchObject({ status: 422 });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }));
    expect(await readTicket(pdf)).toEqual({ error: 'quota', status: 502 });
  });
});
