'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { SearchBar } from './_components/SearchBar';
import { FlightTable, FlightRecord } from './_components/FlightTable';
import { FlightDetailCard } from './_components/FlightDetailCard';

export default function FlightTrackerPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [flights, setFlights] = useState<FlightRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedFlight, setSelectedFlight] = useState<FlightRecord | null>(null);
  
  // Cache to store results and avoid unnecessary calls
  const flightCache = useRef<Record<string, FlightRecord[]>>({});

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadFlights = useCallback(async (query: string) => {
    const normalizedQuery = query.trim().toUpperCase().replace(/\s+/g, '');
    if (!normalizedQuery) {
      setFlights([]);
      return;
    }

    // Check cache first
    if (flightCache.current[normalizedQuery]) {
      setFlights(flightCache.current[normalizedQuery]);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const now = new Date();
      // Search 3 days ago to 2 days ahead
      const dateFrom = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const dateTo = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
      
      const searchParams = new URLSearchParams({
        searchMode: 'flight-number',
        flightNumber: normalizedQuery,
        dateFrom,
        dateTo
      });

      const response = await fetch(`/api/flight-tracker?${searchParams.toString()}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load flight data');
      }
      
      const data = await response.json();
      const fetchedFlights = data.flights as FlightRecord[];
      
      // Update cache
      flightCache.current[normalizedQuery] = fetchedFlights;
      
      setFlights(fetchedFlights);
      
      // If we found flights and none is selected, auto-select the most recent one (first in array usually)
      if (fetchedFlights.length > 0 && !selectedFlight) {
        setSelectedFlight(fetchedFlights[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while fetching flights.');
      setFlights([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFlight]);

  // Trigger search when debounced query changes
  useEffect(() => {
    void loadFlights(debouncedQuery);
  }, [debouncedQuery, loadFlights]);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-2">
          <span className="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">Flight Tracker</span>
          <h1 className="text-3xl font-semibold">Real-Time Flight Information</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Powered by FlightRadar24. Search by flight number or airline combination (e.g., "BAW12" or "AFR990") to view live status and details.
          </p>
        </header>

        <section className="flex w-full flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row">
          <div className="w-full">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Lookup Flight</h2>
            <SearchBar 
              value={searchQuery} 
              onChange={setSearchQuery} 
              isLoading={loading && debouncedQuery !== ''} 
            />
            {error && (
              <p className="mt-2 text-sm text-rose-600 font-medium">{error}</p>
            )}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h2 className="mb-4 text-lg font-semibold text-slate-800">Flight History & Status</h2>
            <FlightTable 
              flights={flights} 
              isLoading={loading} 
              onSelectFlight={setSelectedFlight}
              selectedFlightId={selectedFlight?.id ?? null}
            />
          </div>
          <div className="lg:col-span-1">
            <h2 className="mb-4 text-lg font-semibold text-slate-800">Flight Details</h2>
            <FlightDetailCard flight={selectedFlight} />
          </div>
        </div>
      </div>
    </div>
  );
}
