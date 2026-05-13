import { NextRequest, NextResponse } from 'next/server';

// TEMP: In-memory store for demo. Replace with DB in production.
let rosterData: Record<string, Record<string, any>> = {};

// GET all schedules
export async function GET(request: NextRequest) {
  return NextResponse.json({ roster: rosterData });
}

// POST to update a user's schedule (admin only in real app)
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { userId, dateKey, shift } = body;
  if (!userId || !dateKey || !shift) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  if (!rosterData[userId]) rosterData[userId] = {};
  rosterData[userId][dateKey] = shift;
  return NextResponse.json({ success: true });
}
