import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ auctionId: string }> }
) {
  try {
    const { user } = await requireManager();
    const { auctionId } = await params;
    if (!auctionId) {
      return NextResponse.json({ error: 'Auction ID is required' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('start_unsold_retry_round_v1', {
      p_auction_id: auctionId,
      p_actor_id: user.id,
    });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (err: any) {
    const status = err.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: err.message || 'Failed to start retry round' }, { status });
  }
}
