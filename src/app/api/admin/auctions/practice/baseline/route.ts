import { NextResponse } from 'next/server';
import { checkIsManagerOrAdmin } from '@/lib/auth/is-manager';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function authenticatedManager(): Promise<
  | { kind: 'unauthorized'; response: NextResponse }
  | { kind: 'authorized'; user: { id: string } }
> {
  const server = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await server.auth.getUser();

  if (authError || !user) {
    return {
      kind: 'unauthorized',
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    };
  }

  const authorization = await checkIsManagerOrAdmin();
  if (!authorization.isManager || !authorization.user) {
    return {
      kind: 'unauthorized',
      response: NextResponse.json(
        { error: 'You are not authorized to view auction baselines.' },
        { status: 403 }
      ),
    };
  }

  return { kind: 'authorized', user: authorization.user };
}

export async function GET() {
  try {
    const auth = await authenticatedManager();
    if (auth.kind === 'unauthorized') return auth.response;

    const client = createAdminClient();

    const [
      auctions,
      lots,
      purchases,
      events,
      budgets,
      players,
      registrations,
      payments,
      owners,
    ] = await Promise.all([
      client.from('auctions').select('*', { count: 'exact', head: true }),
      client.from('auction_lots').select('*', { count: 'exact', head: true }),
      client.from('auction_purchases').select('*', { count: 'exact', head: true }),
      client.from('auction_events').select('*', { count: 'exact', head: true }),
      client.from('auction_team_budgets').select('*', { count: 'exact', head: true }),
      client.from('players').select('*', { count: 'exact', head: true }),
      client.from('registrations').select('*', { count: 'exact', head: true }),
      client.from('payments').select('*', { count: 'exact', head: true }),
      client.from('team_owners').select('*', { count: 'exact', head: true }),
    ]);

    const baseline = {
      auctions: auctions.count ?? 0,
      auction_lots: lots.count ?? 0,
      auction_purchases: purchases.count ?? 0,
      auction_events: events.count ?? 0,
      auction_team_budgets: budgets.count ?? 0,
      players: players.count ?? 0,
      registrations: registrations.count ?? 0,
      payments: payments.count ?? 0,
      team_owners: owners.count ?? 0,
    };

    return NextResponse.json({ baseline });
  } catch (error) {
    console.error('Failed to capture database baseline', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Baseline capture failed.' },
      { status: 500 }
    );
  }
}
