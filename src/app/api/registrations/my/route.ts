import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSignedScreenshotUrl } from '@/lib/storage/upload';

export async function GET() {
  try {
    const supabaseServer = await createServerSupabaseClient();
    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabaseAdmin = createAdminClient();

    // 1. Resolve user's player profile if exists
    const { data: playerProfile } = await supabaseAdmin
      .from('players')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    // 2. Fetch registrations created by this user or linked to user's player profile
    let query = supabaseAdmin
      .from('registrations')
      .select(`
        id,
        tournament_id,
        player_id,
        registration_number,
        registration_status,
        registration_type,
        team_name,
        waitlist_position,
        registered_name_snapshot,
        registered_role_snapshot,
        registered_batting_style_snapshot,
        registered_bowling_style_snapshot,
        registered_jersey_name_snapshot,
        registered_jersey_number_snapshot,
        registered_jersey_size_snapshot,
        registered_image_snapshot,
        registered_at,
        correction_requested_at,
        admin_remarks,
        correction_history,
        created_by_auth_id,
        player:players (
          id,
          auth_user_id,
          email,
          full_name,
          mobile,
          jersey_size,
          jersey_name,
          jersey_number,
          cricket_role,
          batting_style,
          bowling_style,
          profile_image_url
        ),
        tournament:tournaments (
          id,
          name,
          description,
          tournament_date,
          registration_fee,
          payment_enabled,
          upi_id,
          payment_qr_url
        )
      `)
      .order('registered_at', { ascending: false });

    if (playerProfile?.id) {
      query = query.or(`created_by_auth_id.eq.${user.id},player_id.eq.${playerProfile.id}`);
    } else {
      query = query.eq('created_by_auth_id', user.id);
    }

    const { data: registrations, error: regErr } = await query;

    if (regErr) {
      console.error('[registrations/my] Error fetching user registrations:', regErr);
      return NextResponse.json({ error: 'Failed to retrieve registrations' }, { status: 500 });
    }

    if (!registrations || registrations.length === 0) {
      return NextResponse.json({ registrations: [] });
    }

    // 3. Fetch latest payment for each registration
    const regIds = registrations.map((r: any) => r.id);
    const { data: payments } = await supabaseAdmin
      .from('payments')
      .select('*')
      .in('registration_id', regIds)
      .order('created_at', { ascending: false });

    const paymentsByRegId = new Map<string, any>();
    if (payments) {
      for (const p of payments) {
        if (!paymentsByRegId.has(p.registration_id)) {
          paymentsByRegId.set(p.registration_id, p);
        }
      }
    }

    // 4. Resolve signed URLs for screenshots safely
    const enrichedRegistrations = await Promise.all(
      registrations.map(async (reg: any) => {
        const payment = paymentsByRegId.get(reg.id) || null;
        let signedScreenshotUrl = '';

        if (payment?.screenshot_object_path) {
          try {
            signedScreenshotUrl = await getSignedScreenshotUrl(
              payment.screenshot_bucket || 'payment-screenshots',
              payment.screenshot_object_path,
              1800 // 30 minutes expiry
            );
          } catch (e) {
            console.error('[registrations/my] Failed to sign screenshot URL:', e);
          }
        } else if (payment?.payment_screenshot_url) {
          signedScreenshotUrl = payment.payment_screenshot_url;
        }

        const enrichedPayment = payment
          ? {
              ...payment,
              payment_screenshot_url: signedScreenshotUrl || payment.payment_screenshot_url || '',
            }
          : null;

        return {
          ...reg,
          payment: enrichedPayment,
        };
      })
    );

    return NextResponse.json({ registrations: enrichedRegistrations });
  } catch (err: any) {
    console.error('[registrations/my] Unhandled exception:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
