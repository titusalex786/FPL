import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    await requireManager();
    const { auctionId } = await params;
    if (!UUID_PATTERN.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: auction, error: fetchError } = await supabase
      .from('auctions')
      .select('id, status, tournament_id')
      .eq('id', auctionId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    }

    if (auction.status === 'DRAFT') {
      const { error: updateError } = await supabase
        .from('auctions')
        .update({ status: 'OPEN', updated_at: new Date().toISOString() })
        .eq('id', auctionId);
      if (updateError) throw updateError;
    }

    return NextResponse.json({ success: true, status: 'OPEN' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
