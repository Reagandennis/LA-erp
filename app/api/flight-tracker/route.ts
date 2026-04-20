import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const OPENSKY_BASE_URL = 'https://opensky-network.org/api/states/all';

const parseNumber = (value: string | null) => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lamin = parseNumber(searchParams.get('lamin'));
  const lomin = parseNumber(searchParams.get('lomin'));
  const lamax = parseNumber(searchParams.get('lamax'));
  const lomax = parseNumber(searchParams.get('lomax'));

  if ([lamin, lomin, lamax, lomax].includes(null)) {
    return NextResponse.json({ error: 'Invalid bounds' }, { status: 400 });
  }

  const query = new URLSearchParams({
    lamin: String(lamin),
    lomin: String(lomin),
    lamax: String(lamax),
    lomax: String(lomax),
  });

  const headers: HeadersInit = {};
  const username = process.env.OPENSKY_USERNAME;
  const password = process.env.OPENSKY_PASSWORD;

  if (username && password) {
    const token = Buffer.from(`${username}:${password}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  }

  const response = await fetch(`${OPENSKY_BASE_URL}?${query.toString()}`, {
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'Unable to load flight data' }, { status: response.status });
  }

  const data = await response.json();
  return NextResponse.json(data, { status: 200 });
}
