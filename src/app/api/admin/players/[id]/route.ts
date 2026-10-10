import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAdminAction } from '@/lib/audit/logger';
import { getAdminPlayerDetails } from '@/lib/admin/player-details';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function verifyAdminAuth() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { authorized: false, status: 401, error: 'Authentication required', user: null };
  }

  const adminClient = createAdminClient();
  const { data: adminEntry } = await adminClient
    .from('admin_users')
    .select('id, role, status')
    .eq('id', user.id)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (!adminEntry) {
    return { authorized: false, status: 403, error: 'Admin access required', user: null };
  }

  return { authorized: true, status: 200, error: null, user };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyAdminAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;
    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid Player or Registration ID' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const preferredRegistrationId = searchParams.get('registrationId');

    const details = await getAdminPlayerDetails(id, preferredRegistrationId);
    if (!details) {
      return NextResponse.json({ error: 'Player or registration not found' }, { status: 404 });
    }

    return NextResponse.json(details);
  } catch (err: any) {
    console.error('Error in GET /api/admin/players/[id]:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyAdminAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: playerId } = await params;

    if (!playerId) {
      return NextResponse.json({ error: 'Player ID is required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1. Fetch player registrations
    const { data: playerRegs } = await supabase
      .from('registrations')
      .select('id')
      .eq('player_id', playerId);

    const regIds = (playerRegs || []).map((r) => r.id);

    // 2. Delete payments linked to these registrations
    if (regIds.length > 0) {
      await supabase.from('payments').delete().in('registration_id', regIds);
      await supabase.from('registrations').delete().in('id', regIds);
    }

    // 3. Delete team owners associated with this player_id
    await supabase.from('team_owners').delete().eq('player_id', playerId);

    // 4. Delete player profile record
    const { error: delErr } = await supabase
      .from('players')
      .delete()
      .eq('id', playerId);

    if (delErr) {
      throw delErr;
    }

    await logAdminAction({
      adminUserId: auth.user!.id,
      action: 'DELETE_PLAYER',
      entityType: 'PLAYER',
      entityId: playerId,
    });

    return NextResponse.json({
      success: true,
      message: 'Player profile and all associated data deleted successfully',
    });
  } catch (err: any) {
    const status = err.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: err.message || 'Failed to delete player entry' }, { status });
  }
}
