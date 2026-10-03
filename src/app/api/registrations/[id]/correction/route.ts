import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabaseServer = await createServerSupabaseClient();
    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: registrationId } = await params;
    const body = await req.json();

    const supabaseAdmin = createAdminClient();
    const { data: registration, error: regErr } = await supabaseAdmin
      .from('registrations')
      .select('*, player:players(*), tournament:tournaments(*)')
      .eq('id', registrationId)
      .maybeSingle();

    if (regErr || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    // Verify ownership
    if (registration.created_by_auth_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (registration.registration_status !== 'CORRECTION_REQUESTED') {
      return NextResponse.json({ error: 'Correction not requested for this registration' }, { status: 400 });
    }

    const history = registration.correction_history || [];
    let activeIdx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (!history[i].resolved_at) {
        activeIdx = i;
        break;
      }
    }

    if (activeIdx === -1) {
      return NextResponse.json({ error: 'No active correction request found' }, { status: 400 });
    }

    const activeCorrection = history[activeIdx];
    const requestedFields = activeCorrection.requested_fields || [];
    
    const updatePayload: any = {
      updated_at: new Date().toISOString(),
      registration_status: 'PENDING',
      resubmission_count: (registration.resubmission_count || 0) + 1,
    };

    const oldValues: any = {};
    const newValues: any = {};

    if (requestedFields.includes('Jersey Name') && body.jersey_name !== undefined) {
      oldValues['Jersey Name'] = registration.registered_jersey_name_snapshot;
      newValues['Jersey Name'] = body.jersey_name;
      updatePayload.registered_jersey_name_snapshot = body.jersey_name;
    }
    if (requestedFields.includes('Jersey Number') && body.jersey_number !== undefined) {
      oldValues['Jersey Number'] = registration.registered_jersey_number_snapshot;
      newValues['Jersey Number'] = body.jersey_number;
      updatePayload.registered_jersey_number_snapshot = body.jersey_number;
    }
    if (requestedFields.includes('Jersey Size') && body.jersey_size !== undefined) {
      oldValues['Jersey Size'] = registration.registered_jersey_size_snapshot;
      newValues['Jersey Size'] = body.jersey_size;
      updatePayload.registered_jersey_size_snapshot = body.jersey_size;
    }
    if (requestedFields.includes('Cricket Role') && body.cricket_role !== undefined) {
      oldValues['Cricket Role'] = registration.registered_role_snapshot;
      newValues['Cricket Role'] = body.cricket_role;
      updatePayload.registered_role_snapshot = body.cricket_role;
    }
    if (requestedFields.includes('Batting Style') && body.batting_style !== undefined) {
      oldValues['Batting Style'] = registration.registered_batting_style_snapshot;
      newValues['Batting Style'] = body.batting_style;
      updatePayload.registered_batting_style_snapshot = body.batting_style;
    }
    if (requestedFields.includes('Bowling Style') && body.bowling_style !== undefined) {
      oldValues['Bowling Style'] = registration.registered_bowling_style_snapshot;
      newValues['Bowling Style'] = body.bowling_style;
      updatePayload.registered_bowling_style_snapshot = body.bowling_style;
    }

    // Mark as resolved
    history[activeIdx].resolved_at = new Date().toISOString();
    history[activeIdx].resolved_by_auth_id = user.id;
    history[activeIdx].old_values = oldValues;
    history[activeIdx].new_values = newValues;

    updatePayload.correction_history = history;

    const { error: updateErr } = await supabaseAdmin
      .from('registrations')
      .update(updatePayload)
      .eq('id', registrationId);

    if (updateErr) {
      return NextResponse.json({ error: 'Failed to update registration' }, { status: 500 });
    }

    // Create admin notification
    // Find tournament admin
    const { data: adminUser } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (adminUser) {
      await supabaseAdmin.from('notifications').insert({
        user_id: adminUser.id,
        type: 'CORRECTION_SUBMITTED',
        title: 'Correction Submitted',
        message: `Player ${registration.registered_name_snapshot} has submitted requested corrections.`,
        registration_id: registrationId,
        tournament_id: registration.tournament_id,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Correction Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
