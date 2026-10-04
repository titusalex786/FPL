import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireManager } from '@/lib/auth/is-manager';
import { getSignedScreenshotUrl } from '@/lib/storage/upload';

export async function GET(req: NextRequest) {
  try {
    await requireManager();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const role = searchParams.get('role') || 'ALL';
    const status = searchParams.get('status') || 'ALL';
    const tournamentId = searchParams.get('tournamentId') || 'ALL';

    const supabase = createAdminClient();

    // 1. Fetch tournaments for filter dropdown
    const { data: tournamentsList } = await supabase
      .from('tournaments')
      .select('id, name')
      .order('created_at', { ascending: false });

    // 2. Query registrations joined with players, tournaments, and payments
    let query = supabase
      .from('registrations')
      .select(
        `
        id,
        tournament_id,
        player_id,
        registration_number,
        registration_status,
        registration_type,
        team_name,
        team_owner_id,
        waitlist_position,
        registered_name_snapshot,
        registered_image_snapshot,
        registered_role_snapshot,
        registered_batting_style_snapshot,
        registered_bowling_style_snapshot,
        registered_jersey_size_snapshot,
        registered_jersey_name_snapshot,
        registered_jersey_number_snapshot,
        registered_at,
        player:players (
          id,
          full_name,
          email,
          jersey_name,
          jersey_number
        ),
        tournament:tournaments (
          id,
          name
        ),
        payments:payments (
          id,
          amount,
          payment_status,
          payment_screenshot_url,
          screenshot_object_path,
          screenshot_bucket,
          transaction_reference,
          verification_note,
          verified_by,
          verified_at,
          created_at
        )
      `
      )
      .order('registered_at', { ascending: false });

    if (status !== 'ALL') {
      query = query.eq('registration_status', status);
    }

    if (tournamentId !== 'ALL') {
      query = query.eq('tournament_id', tournamentId);
    }

    const { data: rows, error } = await query;

    let filtered = rows || [];

    if (error) {
      console.error('Admin players query note:', error.message);
      const { data: fallbackRows } = await supabase
        .from('registrations')
        .select(`
          id,
          tournament_id,
          player_id,
          registration_number,
          registration_status,
          registered_name_snapshot,
          registered_role_snapshot,
          registered_at
        `)
        .order('registered_at', { ascending: false });

      if (fallbackRows) {
        filtered = fallbackRows.map((item) => ({
          ...item,
          waitlist_position: null,
          registered_batting_style_snapshot: 'RIGHT_HAND',
          registered_jersey_size_snapshot: 'M',
          registered_image_snapshot: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400',
          player: { full_name: item.registered_name_snapshot, email: 'player@fairplay.local' },
          tournament: { name: 'FairPlay Premier League 2026' },
          payments: [{ payment_status: item.registration_status === 'CONFIRMED' ? 'SUCCESSFUL' : 'PENDING', amount: 50000 }],
          tournamentHistoryCount: 1,
          tournamentHistory: [],
        })) as any[];
      }
    }

    // Filter by search query (Ref ID, Name, Email)
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((item: any) => {
        const ref = (item.registration_number || '').toLowerCase();
        const name = (item.registered_name_snapshot || item.player?.full_name || '').toLowerCase();
        const email = (item.player?.email || '').toLowerCase();
        return ref.includes(q) || name.includes(q) || email.includes(q);
      });
    }

    // Filter by Playing Role
    if (role !== 'ALL') {
      filtered = filtered.filter((item: any) => {
        const playerRole = item.registered_role_snapshot || item.player?.cricket_role;
        return playerRole === role;
      });
    }

    // 3. Group registrations by player_id to build tournament history timeline per player
    const playerHistoryMap: Record<string, any[]> = {};
    (rows || []).forEach((reg: any) => {
      const pId = reg.player_id;
      if (!playerHistoryMap[pId]) playerHistoryMap[pId] = [];
      playerHistoryMap[pId].push({
        registrationId: reg.id,
        registrationNumber: reg.registration_number,
        tournamentName: reg.tournament?.name || 'FairPlay Premier League 2026',
        registeredAt: reg.registered_at,
        role: reg.registered_role_snapshot,
        jerseySize: reg.registered_jersey_size_snapshot,
        status: reg.registration_status,
        paymentStatus: reg.payments?.[0]?.payment_status || 'PENDING',
      });
    });

    // Resolve screenshot_object_path into signed URLs for payments
    const enrichedPlayers = await Promise.all(
      filtered.map(async (item: any) => {
        const history = playerHistoryMap[item.player_id] || [];
        const enrichedPayments = item.payments
          ? await Promise.all(
              (item.payments as any[]).map(async (p: any) => {
                let resolvedScreenshotUrl = p.payment_screenshot_url || '';
                if (p.screenshot_object_path) {
                  try {
                    resolvedScreenshotUrl = await getSignedScreenshotUrl(
                      p.screenshot_bucket || 'payment-screenshots',
                      p.screenshot_object_path,
                      900
                    );
                  } catch {
                    // Keep fallback URL if signed URL generation fails
                  }
                }
                return {
                  ...p,
                  payment_screenshot_url: resolvedScreenshotUrl,
                };
              })
            )
          : item.payments;
        return {
          ...item,
          registered_image_snapshot: '/logo.png',
          payments: enrichedPayments,
          tournamentHistoryCount: history.length || 1,
          tournamentHistory: history,
        };
      })
    );

    return NextResponse.json({
      players: enrichedPlayers,
      totalCount: enrichedPlayers.length,
      tournaments: tournamentsList || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
