'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleMap, useJsApiLoader, DirectionsRenderer } from '@react-google-maps/api';

const containerStyle = {
  width: '100%',
  height: '550px', // Slightly taller for better visibility
  borderRadius: '2.5rem',
};

const center = {
  lat: -1.2921,
  lng: 36.8219,
};

const mapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: true,
  gestureHandling: 'cooperative', // CRITICAL: Fixes the "scroll behind" issue
  styles: [
    {
      featureType: 'poi',
      elementType: 'labels',
      stylers: [{ visibility: 'off' }],
    },
    {
      featureType: 'transit',
      elementType: 'labels.icon',
      stylers: [{ visibility: 'off' }],
    }
  ],
};

interface MapClientProps {
  startLocation: string;
  endLocation: string;
  travelMode?: string;
}

export default function MapClient({ startLocation, endLocation, travelMode = 'Driving' }: MapClientProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
    libraries: ['places'],
  });

  const [response, setResponse] = useState<google.maps.DirectionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

  const fetchDirections = useCallback(() => {
    if (!isLoaded || !startLocation || !endLocation) return;

    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }

    const mode = travelMode === 'Walking' ? google.maps.TravelMode.WALKING : 
                 travelMode === 'Transit' ? google.maps.TravelMode.TRANSIT : 
                 google.maps.TravelMode.DRIVING;

    directionsServiceRef.current.route(
      {
        origin: startLocation,
        destination: endLocation,
        travelMode: mode,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          setResponse(result);
          setError(null);
        } else {
          console.warn('Directions request failed:', status);
          // If it fails with REQUEST_DENIED, it's usually API key restrictions
          if (status === 'REQUEST_DENIED') {
            setError('API Restriction: The Directions API might be disabled for this key. Please check Google Cloud Console.');
          } else {
            setError(`Could not find a route: ${status}. Check if the addresses are correct.`);
          }
        }
      }
    );
  }, [isLoaded, startLocation, endLocation, travelMode]);

  useEffect(() => {
    // Reset response when locations or mode change to trigger a re-fetch
    setResponse(null);
    fetchDirections();
  }, [fetchDirections, startLocation, endLocation, travelMode]);

  if (loadError) {
    return (
      <div className="h-[550px] w-full flex items-center justify-center bg-slate-50 text-slate-400 rounded-[2.5rem] border-2 border-dashed border-slate-200 p-12 text-center">
        <div className="max-w-md space-y-4">
          <div className="bg-red-50 text-red-500 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-xl font-black text-slate-900 uppercase tracking-tighter">Google Maps API Error</p>
          <p className="text-sm font-bold opacity-70">Check your API Key and ensure "Maps JavaScript API" and "Directions API" are enabled.</p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return <div className="h-[550px] w-full animate-pulse rounded-[2.5rem] bg-slate-100 shadow-inner" />;
  }

  return (
    <div className="relative h-[550px] w-full rounded-[2.5rem] overflow-hidden bg-white">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={12}
        options={mapOptions}
      >
        {response && (
          <DirectionsRenderer
            options={{
              directions: response,
              polylineOptions: {
                strokeColor: '#2563eb', // Matches the blue theme
                strokeWeight: 7,
                strokeOpacity: 0.9,
              },
              markerOptions: {
                opacity: 0.9,
              }
            }}
          />
        )}
      </GoogleMap>
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[2px] z-10 pointer-events-none">
          <div className="bg-white p-8 rounded-3xl shadow-2xl border border-red-50 text-center max-w-sm pointer-events-auto animate-in zoom-in-95 duration-300">
             <div className="bg-red-50 text-red-500 w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-lg font-black text-red-600 uppercase tracking-tighter mb-2">Route Error</p>
              <p className="text-sm font-bold text-slate-500 mb-6">{error}</p>
              <a 
                href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(startLocation)}&destination=${encodeURIComponent(endLocation)}&travelmode=${travelMode.toLowerCase()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
              >
                Open in Google Maps
              </a>
          </div>
        </div>
      )}
    </div>
  );
}
