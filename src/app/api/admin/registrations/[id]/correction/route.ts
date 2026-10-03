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
    const { requestedFields, remark } = body;

    if (!requestedFields || !Array.isArray(requestedFields) || requestedFields.length === 0) {
      return NextResponse.json({ error: 'Please select at least one field for correction' }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();
    const { data: adminUser } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminUser) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    const { data: registration, error: regErr } = await supabaseAdmin
      .from('registrations')
      .select('*')
      .eq('id', registrationId)
      .maybeSingle();

    if (regErr || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const history = registration.correction_history || [];
    
    // Add new correction request to history
    history.push({
      remark,
      requested_fields: requestedFields,
      requested_at: now,
      requested_by_auth_id: user.id,
    });

    const updatePayload = {
      registration_status: 'CORRECTION_REQUESTED',
      admin_remarks: remark,
      correction_history: history,
      correction_requested_at: now,
      updated_at: now,
    };

    const { error: updateErr } = await supabaseAdmin
      .from('registrations')
      .update(updatePayload)
      .eq('id', registrationId);

    if (updateErr) {
      return NextResponse.json({ error: 'Failed to update registration status' }, { status: 500 });
    }

    // Create player notification
    if (registration.created_by_auth_id) {
      await supabaseAdmin.from('notifications').insert({
        user_id: registration.created_by_auth_id,
        type: 'CORRECTION_REQUIRED',
        title: 'Correction Required',
        message: `Admin has requested updates for your registration (${registration.registration_number}).`,
        registration_id: registrationId,
        tournament_id: registration.tournament_id,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Request Correction Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
