import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/is-admin';
import { logAdminAction } from '@/lib/audit/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAdmin();
    const { id: registrationId } = await params;

    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID is required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1. Verify registration exists
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('id, tournament_id, player_id, registration_status, registered_name_snapshot')
      .eq('id', registrationId)
      .maybeSingle();

    if (regError) throw regError;
    if (!registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    // 2. Mark registration as CANCELLED (safely withdrawn from pool)
    const { error: updErr } = await supabase
      .from('registrations')
      .update({
        registration_status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', registrationId);

    if (updErr) throw updErr;

    // 3. Mark auction selections as EXCLUDED
    await supabase
      .from('auction_player_selections')
      .update({
        selection_status: 'EXCLUDED',
        reason: 'Player withdrawn by admin',
      })
      .eq('registration_id', registrationId);

    // 4. Mark any pending or available lot as UNSOLD
    await supabase
      .from('auction_lots')
      .update({
        status: 'UNSOLD',
        updated_at: new Date().toISOString(),
      })
      .eq('registration_id', registrationId)
      .in('status', ['AVAILABLE', 'PENDING']);

    // 5. Audit log
    await logAdminAction({
      adminUserId: user.id,
      action: 'WITHDRAW_REGISTRATION',
      entityType: 'REGISTRATION',
      entityId: registrationId,
    });

    return NextResponse.json({
      success: true,
      action: 'WITHDRAWN',
      status: 'CANCELLED',
      message: `Player "${registration.registered_name_snapshot || 'Player'}" was safely withdrawn from the active pool.`,
    });
  } catch (err: any) {
    const status = err.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: err.message || 'Failed to withdraw registration' }, { status });
  }
}
