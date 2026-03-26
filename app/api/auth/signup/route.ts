import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Account creation is managed by an administrator.' },
    { status: 403 },
  );
}
