import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/admin/dashboard/route';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/auth/is-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

function mockQuery(data: unknown) {
  const response = { data, error: null };
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.then = (
    resolve: (value: typeof response) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(response).then(resolve, reject);
  return builder;
}

describe('admin dashboard aggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves tournament and global totals across registrations, payments, and owners', async () => {
    const rows: Record<string, unknown> = {
      tournaments: [
        { id: 't1', name: 'Tournament 1', max_players: 3, max_teams: 4 },
        { id: 't2', name: 'Tournament 2', max_players: 10, max_teams: 2 },
      ],
      registrations: [
        { id: 'r1', tournament_id: 't1', registration_status: 'CONFIRMED', status: null },
        { id: 'r2', tournament_id: 't1', registration_status: 'WAITING_LIST', status: null },
        { id: 'r3', tournament_id: 't1', registration_status: 'CANCELLED', status: null },
        { id: 'r4', tournament_id: 't2', registration_status: 'PENDING', status: null },
      ],
      payments: [
        { id: 'p1', registration_id: 'r1', payment_status: 'SUCCESSFUL', amount: 1000 },
        { id: 'p2', registration_id: 'r2', payment_status: 'PENDING', amount: 500 },
        { id: 'p3', registration_id: null, payment_status: 'SUCCESSFUL', amount: 400 },
        { id: 'p4', registration_id: 'r3', payment_status: 'PENDING', amount: 200 },
      ],
      team_owners: [
        { id: 'o1', tournament_id: 't1', status: 'PENDING' },
        { id: 'o2', tournament_id: 't2', status: 'ACTIVE' },
      ],
    };
    const from = vi.fn((table: string) => mockQuery(rows[table]));
    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.tournaments).toMatchObject([
      {
        id: 't1',
        stats: {
          totalRegistered: 3,
          confirmedCount: 1,
          waitlistCount: 1,
          availableSlots: 2,
          successfulPayments: 1,
          pendingPayments: 1,
          revenuePaise: 1000,
          ownerCount: 1,
          pendingOwners: 1,
          ownerSlotsRemaining: 3,
        },
      },
      {
        id: 't2',
        stats: {
          totalRegistered: 1,
          pendingPayments: 1,
          ownerCount: 1,
          ownerSlotsRemaining: 1,
        },
      },
    ]);
    expect(json.globalStats).toEqual({
      totalRegisteredPlayers: 4,
      totalSuccessfulPayments: 2,
      totalPendingPayments: 2,
      totalRevenuePaise: 1400,
    });
  });
});
