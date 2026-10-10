import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdminPlayerDetails } from '@/lib/admin/player-details';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function verifyAdminAuth() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { authorized: false, status: 401, error: 'Authentication required' };
  }

  const adminClient = createAdminClient();
  const { data: adminEntry } = await adminClient
    .from('admin_users')
    .select('id, role, status')
    .eq('id', user.id)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (!adminEntry) {
    return { authorized: false, status: 403, error: 'Admin access required' };
  }

  return { authorized: true, status: 200, error: null };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyAdminAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;
    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid Registration ID format' }, { status: 400 });
    }

    const details = await getAdminPlayerDetails(id, id);
    if (!details) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    return NextResponse.json(details);
  } catch (err: any) {
    console.error('Error in GET /api/admin/registrations/[id]/details:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
