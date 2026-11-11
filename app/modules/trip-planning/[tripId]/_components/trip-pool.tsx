'use client';

import { createContext, useContext } from 'react';

import type { TripDayLogSummary, TripResourceSummary } from '@/lib/trip-resource-model';

import type { TripDaySummary, TripDetail, TripItineraryItemSummary } from '../../types';

/**
 * The trip's staged resource pool and daily logs, for the parts of the event
 * editor that read them (the service picker, the crew pickers, the shift
 * log). A context, so the forms in between don't each have to pass it on.
 */
export interface TripPool {
  tripId: number;
  status: string;
  canEdit: boolean;
  resources: TripResourceSummary[];
  items: TripItineraryItemSummary[];
  days: TripDaySummary[];
  dayLogs: TripDayLogSummary[];
  /** A save elsewhere on the page handed back a fresher trip. */
  onTripChange: (trip: TripDetail) => void;
}

const EMPTY: TripPool = {
  tripId: 0,
  status: 'Draft',
  canEdit: false,
  resources: [],
  items: [],
  days: [],
  dayLogs: [],
  onTripChange: () => {},
};

const TripPoolContext = createContext<TripPool>(EMPTY);

export const TripPoolProvider = TripPoolContext.Provider;

export function useTripPool(): TripPool {
  return useContext(TripPoolContext);
}
