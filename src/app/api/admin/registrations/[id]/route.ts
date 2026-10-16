import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/is-admin';
import { logAdminAction } from '@/lib/audit/logger';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAdmin();
    const { id: registrationId } = await params;

    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID is required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1. Check if registration exists
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('id, tournament_id, player_id, registration_status, registered_name_snapshot')
      .eq('id', registrationId)
      .maybeSingle();

    if (regError) throw regError;
    if (!registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    // 2. Check if registration is referenced by auction_lots (FK constraint protection)
    const { data: lots, error: lotsError } = await supabase
      .from('auction_lots')
      .select('id, status, auction_id')
      .eq('registration_id', registrationId);

    if (lotsError) throw lotsError;

    if (lots && lots.length > 0) {
      // Registration is part of an auction: do NOT hard-delete to prevent foreign key violation.
      // Instead, safely mark registration as CANCELLED (withdrawn from active pool).
      const { error: updErr } = await supabase
        .from('registrations')
        .update({
          registration_status: 'CANCELLED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', registrationId);

      if (updErr) throw updErr;

      // Mark auction selections as EXCLUDED
      await supabase
        .from('auction_player_selections')
        .update({
          selection_status: 'EXCLUDED',
          reason: 'Player withdrawn by admin',
        })
        .eq('registration_id', registrationId);

      // Mark any unauctioned lots as UNSOLD
      await supabase
        .from('auction_lots')
        .update({
          status: 'UNSOLD',
          updated_at: new Date().toISOString(),
        })
        .eq('registration_id', registrationId)
        .in('status', ['AVAILABLE', 'PENDING']);

      await logAdminAction({
        adminUserId: user.id,
        action: 'WITHDRAW_REGISTRATION',
        entityType: 'REGISTRATION',
        entityId: registrationId,
      });

      return NextResponse.json({
        success: true,
        action: 'WITHDRAWN',
        message: `Registration is linked to auction records and was safely withdrawn from the active pool.`,
      });
    }

    // 3. No auction lots depend on this registration: safe to hard-delete
    await supabase.from('payments').delete().eq('registration_id', registrationId);
    await supabase.from('auction_player_selections').delete().eq('registration_id', registrationId);

    const { error: delErr } = await supabase
      .from('registrations')
      .delete()
      .eq('id', registrationId);

    if (delErr) {
      throw delErr;
    }

    await logAdminAction({
      adminUserId: user.id,
      action: 'DELETE_REGISTRATION',
      entityType: 'REGISTRATION',
      entityId: registrationId,
    });

    return NextResponse.json({
      success: true,
      action: 'DELETED',
      message: 'Player registration entry deleted successfully',
    });
  } catch (err: any) {
    const status = err.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: err.message || 'Failed to process registration' }, { status });
  }
}
