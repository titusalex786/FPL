import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SELECTION_STATUSES = ['SELECTED', 'LOCKED', 'EXCLUDED'] as const;
type SelectionStatus = typeof SELECTION_STATUSES[number];

function isSelectionStatus(value: unknown): value is SelectionStatus {
  return typeof value === 'string'
    && SELECTION_STATUSES.some((status) => status === value);
}

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

function getErrorResponse(error: unknown) {
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

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { user } = await requireManager();
    const { auctionId } = await params;
    if (!UUID_PATTERN.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select('status')
      .eq('id', auctionId)
      .maybeSingle();
    if (auctionError) throw auctionError;
    if (!auction) return NextResponse.json({ error: 'Auction not found' }, { status: 404 });

    if (auction.status === 'DRAFT' || auction.status === 'OPEN') {
      const { error: syncError } = await supabase.rpc('sync_auction_player_candidates', {
        p_auction_id: auctionId,
        p_actor_id: user.id,
      });
      if (syncError) throw syncError;
    }

    const { data: selections, error } = await supabase
      .from('auction_player_selections')
      .select(`
        id,
        auction_id,
        tournament_id,
        registration_id,
        player_id,
        candidate_type,
        selection_status,
        reason,
        selected_at,
        locked_at,
        player:players (
          id,
          full_name,
          cricket_role
        ),
        registration:registrations (
          registration_number,
          registration_status,
          registered_name_snapshot,
          registered_role_snapshot
        )
      `)
      .eq('auction_id', auctionId)
      .order('candidate_type', { ascending: true })
      .order('player_id', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ selections: selections || [] });
  } catch (error) {
    return getErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { user } = await requireManager();
    const { auctionId } = await params;
    if (!UUID_PATTERN.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid selection payload' }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    if (
      typeof payload.registrationId !== 'string'
      || !UUID_PATTERN.test(payload.registrationId)
      || !isSelectionStatus(payload.selectionStatus)
      || (payload.reason !== undefined && typeof payload.reason !== 'string')
    ) {
      return NextResponse.json({ error: 'Invalid selection payload' }, { status: 400 });
    }

    const { data, error } = await createAdminClient().rpc('set_auction_player_selection', {
      p_auction_id: auctionId,
      p_registration_id: payload.registrationId,
      p_selection_status: payload.selectionStatus,
      p_reason: payload.reason ?? null,
      p_actor_id: user.id,
    });

    if (error) throw error;
    return NextResponse.json({ selection: data });
  } catch (error) {
    return getErrorResponse(error);
  }
}
