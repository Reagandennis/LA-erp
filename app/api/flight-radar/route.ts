import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const flightNum = searchParams.get('flightNum');
  const dateStr = searchParams.get('date');

  if (!flightNum) {
    return NextResponse.json({ error: 'Flight number is required' }, { status: 400 });
  }

  // Sanitize flight number: uppercase and remove all spaces
  const cleanFlightNum = flightNum.toUpperCase().replace(/\s/g, '');

  const token = process.env.FR24_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'FR24 API token not configured in .env' }, { status: 500 });
  }

  // Ensure targetDate is valid
  let targetDate: Date;
  try {
    targetDate = dateStr && !isNaN(Date.parse(dateStr)) ? new Date(dateStr) : new Date();
  } catch (e) {
    targetDate = new Date();
  }

  // Create date range for the flight lookup (48h range)
  // Format must be YYYY-MM-DDTHH:MM:SS
  const fromDate = new Date(targetDate.getTime() - 24 * 3600 * 1000);
  const toDate = new Date(targetDate.getTime() + 24 * 3600 * 1000);
  
  const from = fromDate.toISOString().split('.')[0]; // Removes milliseconds
  const to = toDate.toISOString().split('.')[0];

  try {
    const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flights=${cleanFlightNum}&flight_datetime_from=${from}&flight_datetime_to=${to}`;
    
    console.log(`[FR24 Proxy] Requesting: ${url}`);
    
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Version': 'v1',
        'Authorization': `Bearer ${token.trim()}`
      },
      cache: 'no-store'
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[FR24 Proxy] API Error (${res.status}):`, errorText);
      
      let errorDetail = errorText;
      try {
        const errJson = JSON.parse(errorText);
        errorDetail = errJson.details || errJson.message || errJson.error || errorText;
        if (typeof errorDetail === 'object') errorDetail = JSON.stringify(errorDetail);
      } catch (e) {}
      
      return NextResponse.json({ 
        error: `FlightRadar24 Error: ${errorDetail}`,
        status: res.status 
      }, { status: res.status });
    }

    const result = await res.json();
    console.log(`[FR24 Proxy] Success. Found ${result.data?.length || 0} flights.`);
    
    const flight = result.data?.[0];

    if (!flight) {
      return NextResponse.json({ error: `Flight ${cleanFlightNum} not found in FR24 database for this date range.` }, { status: 404 });
    }

    // Mapping FR24 Portal fields
    return NextResponse.json({
      start: flight.orig_icao || flight.airport_origin_code_iata || 'TBD',
      end: flight.dest_icao || flight.airport_destination_code_iata || 'TBD',
      status: flight.flight_ended ? 'Landed' : (flight.datetime_takeoff ? 'In Air' : 'Scheduled'),
      dep: flight.datetime_takeoff || flight.flight_datetime_scheduled_departure || targetDate.toISOString(),
      arr: flight.datetime_landed || flight.flight_datetime_scheduled_arrival || new Date(targetDate.getTime() + 14400000).toISOString(),
      aircraft: flight.type || flight.aircraft_model_text || 'Commercial Jet',
      gate: flight.gate_origin || 'TBD'
    });
  } catch (error: any) {
    console.error('[FR24 Proxy] Exception:', error);
    return NextResponse.json({ error: 'Connection failed. Please check your network or API token.' }, { status: 500 });
  }
}
