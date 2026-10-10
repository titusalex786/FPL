import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkIsAdmin } from '@/lib/auth/is-admin';
import { getSignedScreenshotUrl } from '@/lib/storage/upload';
import { CANONICAL_ORGANISER_UPI_ID } from '@/lib/utils/upi';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Authenticate user
    const supabaseServer = await createServerSupabaseClient();
    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabaseAdmin = createAdminClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    // 2. Query registration strictly by id or registration_number
    let regQuery = supabaseAdmin
      .from('registrations')
      .select('*, player:players(*)');

    if (isUuid) {
      regQuery = regQuery.eq('id', id);
    } else {
      regQuery = regQuery.eq('registration_number', id);
    }

    const { data: registration, error: regError } = await regQuery.maybeSingle();

    if (regError || !registration) {
      return NextResponse.json({ error: 'Registration record not found' }, { status: 404 });
    }

    // 3. Resolve user's player profile for ownership check
    const { data: playerProfile } = await supabaseAdmin
      .from('players')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    // 4. Verify authorization:
    // a) DB-backed Admin or Manager
    // b) User created the registration (created_by_auth_id === user.id)
    // c) Registration player is linked to user's auth account
    // d) Registration player_id matches user's player profile
    // e) Team owner
    const { isAdmin } = await checkIsAdmin();
    let isAuthorized = isAdmin;

    if (!isAuthorized) {
      const regPlayer = registration.player as any;
      const isCreator = registration.created_by_auth_id === user.id;
      const isPlayerAuth = regPlayer?.auth_user_id === user.id;
      const isPlayerId = Boolean(playerProfile?.id && registration.player_id === playerProfile.id);

      if (isCreator || isPlayerAuth || isPlayerId) {
        isAuthorized = true;
      } else if (registration.team_owner_id) {
        const { data: teamOwner } = await supabaseAdmin
          .from('team_owners')
          .select('id, user_id, auth_user_id, created_by_auth_id')
          .eq('id', registration.team_owner_id)
          .maybeSingle();

        if (
          teamOwner &&
          (teamOwner.user_id === user.id ||
            teamOwner.auth_user_id === user.id ||
            teamOwner.created_by_auth_id === user.id)
        ) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'You are not authorized to view this registration' },
        { status: 403 }
      );
    }

    // 5. Fetch associated tournament
    const { data: tournament } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .eq('id', registration.tournament_id)
      .maybeSingle();

    // 6. Fetch latest payment
    const { data: latestPayment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('registration_id', registration.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 7. Resolve signed screenshot URL if private object path exists
    if (latestPayment?.screenshot_object_path) {
      try {
        const signedUrl = await getSignedScreenshotUrl(
          latestPayment.screenshot_bucket || 'payment-screenshots',
          latestPayment.screenshot_object_path,
          1800
        );
        if (signedUrl) {
          latestPayment.payment_screenshot_url = signedUrl;
        }
      } catch (err) {
        console.error('[registrations/[id]] Failed to sign payment screenshot URL:', err);
      }
    }

    const player = registration.player || {
      id: registration.player_id,
      email: user.email || 'player@fairplay.local',
      full_name: registration.registered_name_snapshot,
      jersey_size: registration.registered_jersey_size_snapshot,
    };

    return NextResponse.json({
      registration,
      player,
      skills: null,
      latestPayment: latestPayment || {
        payment_status: 'PENDING',
        amount: tournament?.registration_fee || 50000,
      },
      tournament: tournament || {
        id: registration.tournament_id,
        name: 'FairPlay Premier League 2026',
        registration_fee: 50000,
        payment_enabled: true,
        upi_id: CANONICAL_ORGANISER_UPI_ID,
      },
    });
  } catch (err: any) {
    console.error('[registrations/[id]] Unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
