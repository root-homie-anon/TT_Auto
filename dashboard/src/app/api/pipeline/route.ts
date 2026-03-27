import { NextResponse } from 'next/server';
import { getAllState } from '@/lib/state-reader';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const data = getAllState();
  return NextResponse.json(data);
}
