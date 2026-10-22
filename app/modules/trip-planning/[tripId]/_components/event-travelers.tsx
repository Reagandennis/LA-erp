'use client';

import { useState } from 'react';

import type { TravelerOption, TripDetail, TripItineraryItemSummary } from '../../types';
import type { EventTraveler } from '../editor-state';

/** Suggestions rendered at once; some clients have hundreds of travellers. */
const MAX_SUGGESTIONS = 50;

const PEOPLE_ICON =
  'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z';

/** What an event's travellers are picked from. */
export interface TravelerChoices {
  /** The trip's travellers, lead first. */
  onTrip: TripDetail['travelers'];
  /** The client's active travellers, to add someone not on the trip yet. */
  client: TravelerOption[];
  clientName: string;
}

/**
 * Who an event is for. The trip's travellers are a tick away; another of the
 * client's, or a new name, joins the trip when the event saves. None ticked
 * means the whole party.
 */
export function EventTravelerFields({
  choices,
  value,
  onChange,
}: {
  choices: TravelerChoices;
  value: EventTraveler[];
  onChange: (next: EventTraveler[]) => void;
}) {
  const { onTrip: tripTravelers, client: clientTravelers, clientName } = choices;
  const [adding, setAdding] = useState(tripTravelers.length === 0);
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();

  const onTripIds = new Set(tripTravelers.map((t) => t.id));
  const pickedIds = new Set(value.flatMap((t) => (t.travelerId ? [t.travelerId] : [])));
  const joining = value.filter((t) => !t.travelerId || !onTripIds.has(t.travelerId));
  const matches = clientTravelers.filter(
    (t) =>
      !onTripIds.has(t.id) &&
      !pickedIds.has(t.id) &&
      (normalized === '' || t.name.toLowerCase().includes(normalized)),
  );
  // A name that's already someone's should be ticked or picked, not created twice.
  const canAddNew =
    normalized !== '' &&
    ![...tripTravelers, ...clientTravelers, ...value].some((t) => t.name.toLowerCase() === normalized);

  const toggle = (traveler: { id: number; name: string }) =>
    onChange(
      pickedIds.has(traveler.id)
        ? value.filter((t) => t.travelerId !== traveler.id)
        : [...value, { travelerId: traveler.id, name: traveler.name }],
    );
  const add = (traveler: EventTraveler) => {
    onChange([...value, traveler]);
    setQuery('');
  };
  const closeSearch = () => {
    setAdding(false);
    setQuery('');
  };

  const chip = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition';
  const checkIcon = (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  );

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Travellers on this event</p>
        {value.length === 0 ? (
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-500 ring-1 ring-gray-200">
            Whole party
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] font-medium text-gray-400 transition-colors hover:text-primary"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tripTravelers.map((traveler) => {
          const picked = pickedIds.has(traveler.id);
          return (
            <button
              key={traveler.id}
              type="button"
              aria-pressed={picked}
              onClick={() => toggle(traveler)}
              className={`${chip} ${
                picked
                  ? 'border-primary bg-primary text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {picked && checkIcon}
              {traveler.name}
              {traveler.isPrimary && tripTravelers.length > 1 && (
                <span className={picked ? 'text-white/70' : 'text-gray-400'}>(lead)</span>
              )}
            </button>
          );
        })}

        {joining.map((traveler) => (
          <span
            key={traveler.travelerId ?? `new:${traveler.name}`}
            className={`${chip} border-primary bg-primary py-1 pr-1 text-white`}
          >
            {checkIcon}
            {traveler.name}
            <span className="rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
              {traveler.travelerId ? 'Joins trip' : 'New'}
            </span>
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== traveler))}
              aria-label={`Remove ${traveler.name}`}
              className="rounded p-0.5 text-white/70 hover:bg-white/20 hover:text-white"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}

        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={`${chip} border-dashed border-gray-300 text-gray-500 hover:border-primary/40 hover:bg-primary/5 hover:text-primary`}
          >
            + Add traveller
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2">
          <input
            autoFocus={tripTravelers.length > 0}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && tripTravelers.length > 0) closeSearch();
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (matches[0]) add({ travelerId: matches[0].id, name: matches[0].name });
              else if (canAddNew) add({ name: query.trim() });
            }}
            placeholder={
              clientTravelers.some((t) => !onTripIds.has(t.id))
                ? `Search ${clientName}'s travellers, or type a new name`
                : 'Type a name to add a new traveller'
            }
            className="w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {(matches.length > 0 || canAddNew) && (
            <ul className="mt-1 max-h-48 divide-y divide-gray-50 overflow-y-auto rounded-lg border border-gray-100 bg-white">
              {matches.slice(0, MAX_SUGGESTIONS).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => add({ travelerId: t.id, name: t.name })}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {t.name}
                  </button>
                </li>
              ))}
              {canAddNew && (
                <li>
                  <button
                    type="button"
                    onClick={() => add({ name: query.trim() })}
                    className="w-full px-3 py-2 text-left text-sm font-medium text-primary hover:bg-primary/5"
                  >
                    + Add &ldquo;{query.trim()}&rdquo; as a new traveller for {clientName}
                  </button>
                </li>
              )}
            </ul>
          )}
          {matches.length > MAX_SUGGESTIONS && (
            <p className="mt-1 text-xs text-gray-400">
              Showing {MAX_SUGGESTIONS} of {matches.length}. Keep typing to narrow the list.
            </p>
          )}
        </div>
      )}

      <p className="mt-2 text-xs text-gray-500">
        {tripTravelers.length > 0
          ? 'Tick who this event is for, or leave it as the whole party. Anyone added here joins the trip.'
          : `This trip has no travellers yet. Anyone added here joins the trip and is saved to ${clientName}.`}
      </p>
    </div>
  );
}

/** "For Jane Doe, John Doe" on a card, when the event isn't for the whole party. */
export function TravelerRow({ item }: { item: TripItineraryItemSummary }) {
  if (item.travelers.length === 0) return null;
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-600">
      <svg className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d={PEOPLE_ICON} />
      </svg>
      <span>
        <span className="text-slate-400">For </span>
        <span className="font-medium">{item.travelers.map((t) => t.name).join(', ')}</span>
      </span>
    </p>
  );
}
