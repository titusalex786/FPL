import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ auctionId: string; lotId: string }>;
};

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  const status = message.includes('Unauthorized') || code === '42501'
    ? 403
    : code === 'P0002'
      ? 404
      : code === '22023'
        ? 400
        : code === '55000'
          ? 409
          : 500;

  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { user } = await requireManager();
    const { auctionId, lotId } = await params;
    if (!UUID_PATTERN.test(auctionId) || !UUID_PATTERN.test(lotId)) {
      return NextResponse.json({ error: 'Invalid auction or lot ID' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (
      typeof body !== 'object'
      || body === null
      || Array.isArray(body)
      || !('action' in body)
      || (body.action !== 'START'
        && body.action !== 'SETTLE'
        && body.action !== 'END_UNSOLD')
    ) {
      return NextResponse.json({ error: 'Action must be START or SETTLE' }, { status: 400 });
    }

    const functionName = body.action === 'START'
      ? 'start_auction_lot_v1'
      : body.action === 'END_UNSOLD'
        ? 'end_auction_lot_unsold_v1'
        : 'settle_auction_lot_v1';
    const { data, error } = await createAdminClient().rpc(functionName, {
      p_auction_id: auctionId,
      p_lot_id: lotId,
      p_actor_id: user.id,
    });

    if (error) throw error;
    return NextResponse.json({ lot: data });
  } catch (error) {
    return errorResponse(error);
  }
}
