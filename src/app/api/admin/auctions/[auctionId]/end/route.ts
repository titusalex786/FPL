import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { user } = await requireManager();
    const { auctionId } = await params;
    if (!UUID_PATTERN.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    let body: unknown = {};
    if (request.headers.get('content-type')?.includes('application/json')) {
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      }
    }

    if (
      typeof body !== 'object'
      || body === null
      || Array.isArray(body)
      || ('reason' in body && body.reason !== undefined
        && (typeof body.reason !== 'string' || body.reason.length > 500))
    ) {
      return NextResponse.json({ error: 'Invalid end-auction reason' }, { status: 400 });
    }

    const reason = 'reason' in body && typeof body.reason === 'string'
      ? body.reason
      : null;
    const { data, error } = await createAdminClient().rpc('end_auction_v1', {
      p_auction_id: auctionId,
      p_actor_id: user.id,
      p_reason: reason,
    });

    if (error) {
      const status = error.code === '42501'
        ? 403
        : error.code === 'P0002'
          ? 404
          : error.code === '22023'
            ? 400
            : error.code === '55000'
              ? 409
              : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ auction: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, {
      status: message.includes('Unauthorized') ? 403 : 500,
    });
  }
}
