/**
 * Dead-letter queue API route.
 *
 * GET  /api/dead-letter  — lists products exhausted by retries or structural failure
 * POST /api/dead-letter  — operator action: retry or drop a product
 *
 * SECURITY FLAG: This route mutates pipeline state and has no authentication.
 * If the dashboard is not behind auth middleware or network-level protection,
 * this endpoint is unauthenticated. See Elliot flag in the implementation notes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getDeadLetterProducts,
  retryDeadLetterProduct,
  dropDeadLetterProduct,
} from '@/lib/dead-letter';

export const dynamic = 'force-dynamic';

// ─── GET ──────────────────────────────────────────────────────────────────────

export function GET(): NextResponse {
  try {
    const deadLetter = getDeadLetterProducts();
    return NextResponse.json({ deadLetter });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

const PostBodySchema = z.object({
  productId: z.string().min(1),
  action: z.enum(['retry', 'drop']),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { productId, action } = parsed.data;

  try {
    if (action === 'retry') {
      const result = retryDeadLetterProduct(productId);
      if (!result.ok) {
        const status = result.reason === 'not_found' ? 404 : 409;
        return NextResponse.json({ error: result.reason }, { status });
      }
      return NextResponse.json({ ok: true, action: 'retry', productId });
    }

    // action === 'drop'
    const result = dropDeadLetterProduct(productId);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 404 });
    }
    return NextResponse.json({ ok: true, action: 'drop', productId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
