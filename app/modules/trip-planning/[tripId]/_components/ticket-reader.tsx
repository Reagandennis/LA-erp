'use client';

import { useRef, useState } from 'react';

import { SILENT_BANNER_HEADER } from '@/app/ui/banner';
import { APP_LOCALE } from '@/lib/locale';
import type { TicketReading, TicketSegment } from '@/lib/ticket-reader';

type State =
  | { state: 'idle' }
  | { state: 'reading'; name: string }
  | { state: 'choose'; reading: TicketReading; file: File }
  | { state: 'empty'; reading: TicketReading }
  | { state: 'error'; message: string };

/** "KQ100 · NBO → LHR · Fri 6 Nov 09:30 – 15:30" */
export function describeSegment(segment: TicketSegment): string {
  const route = `${segment.origin?.iata ?? '?'} → ${segment.destination?.iata ?? '?'}`;
  const day = segment.departDate
    ? new Date(`${segment.departDate}T12:00:00Z`).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    : null;
  const times = segment.departTime || segment.arriveTime ? `${segment.departTime ?? '—'} – ${segment.arriveTime ?? '—'}` : null;
  return [segment.flightNumber, route, [day, times].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}

/**
 * "Read from e-ticket": the planner picks the ticket (PDF or a photo), the
 * server reads what is printed on it, and the segment they choose fills the
 * form. Optional: the form works just as well without it. The file itself
 * goes to the caller too, to be attached to the event when it saves.
 */
export function TicketReader({ onRead }: { onRead: (segment: TicketSegment, reading: TicketReading, file: File) => void }) {
  const [state, setState] = useState<State>({ state: 'idle' });
  const input = useRef<HTMLInputElement | null>(null);

  const read = async (file: File) => {
    setState({ state: 'reading', name: file.name });
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch('/api/trips/tickets/read', {
        method: 'POST',
        credentials: 'include',
        body: form,
        // The form shows the outcome itself.
        headers: { [SILENT_BANNER_HEADER]: '1' },
      });
      const body = (await response.json().catch(() => null)) as { reading?: TicketReading; error?: string } | null;
      if (!response.ok || !body?.reading) throw new Error(body?.error ?? "The ticket couldn't be read.");
      const { reading } = body;
      if (reading.segments.length === 0) setState({ state: 'empty', reading });
      else if (reading.segments.length === 1) {
        setState({ state: 'idle' });
        onRead(reading.segments[0]!, reading, file);
      } else setState({ state: 'choose', reading, file });
    } catch (error) {
      setState({ state: 'error', message: error instanceof Error ? error.message : "The ticket couldn't be read." });
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-gray-200 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500">E-ticket</span>
        <input
          ref={input}
          type="file"
          accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void read(file);
          }}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={state.state === 'reading'}
          title="Fill the flight from the ticket itself: airline, flight, airports, times, seat and booking reference"
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-200 disabled:opacity-50"
        >
          {state.state === 'reading' ? `Reading ${state.name}…` : 'Read from e-ticket'}
        </button>
        <span className="text-[11px] text-gray-400">Optional. PDF or a photo; it is attached to the event when you save.</span>
      </div>

      {state.state === 'choose' && (
        <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white" aria-label="Flights on the ticket">
          {state.reading.segments.map((segment, index) => (
            <li key={`${segment.flightNumber}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  setState({ state: 'idle' });
                  onRead(segment, state.reading, state.file);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-sky-50"
              >
                <span className="w-16 shrink-0 font-mono text-sm font-semibold text-gray-900">{segment.flightNumber ?? '—'}</span>
                <span className="min-w-0 flex-1 truncate">{describeSegment(segment)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.state === 'empty' && (
        <p className="mt-1.5 text-xs text-amber-700">
          No flight was found on that document.{state.reading.notes ? ` ${state.reading.notes}` : ''} Fill the flight in by hand.
        </p>
      )}
      {state.state === 'error' && <p className="mt-1.5 text-xs text-rose-600">{state.message}</p>}
    </div>
  );
}
