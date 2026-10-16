import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { teamOwnerId, adjustmentAmount, reason } = body || {};

    if (!teamOwnerId || !UUID_PATTERN.test(teamOwnerId)) {
      return NextResponse.json({ error: 'Valid teamOwnerId is required' }, { status: 400 });
    }
    if (typeof adjustmentAmount !== 'number' || !Number.isSafeInteger(adjustmentAmount) || adjustmentAmount === 0) {
      return NextResponse.json({ error: 'Valid non-zero integer adjustmentAmount is required' }, { status: 400 });
    }
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      return NextResponse.json({ error: 'Mandatory adjustment reason of at least 3 characters is required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: budget, error } = await supabase.rpc('adjust_auction_team_budget_v1', {
      p_auction_id: auctionId,
      p_team_owner_id: teamOwnerId,
      p_adjustment_amount: adjustmentAmount,
      p_reason: reason.trim(),
      p_actor_id: user.id,
    });

    if (error) {
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ success: true, budget });
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Error adjusting budget' }, { status });
  }
}
