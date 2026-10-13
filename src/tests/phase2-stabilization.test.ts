import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as registerPlayer } from '@/app/api/registrations/route';
import { POST as registerOwner } from '@/app/api/registrations/owner/route';
import { POST as approveRegistration } from '@/app/api/admin/registrations/[id]/approve/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/auth/is-manager', () => ({
  requireManager: vi.fn().mockResolvedValue({
    user: { id: 'admin-123', email: 'admin@fairplay.com' },
    role: 'ADMIN',
    isAdmin: true,
  }),
}));

vi.mock('@/lib/audit/logger', () => ({
  logAdminAction: vi.fn().mockResolvedValue(true),
}));

describe('Phase 2 Stabilization Tests', () => {
  const mockUser = { id: 'user-auth-777', email: 'account@example.com' };

  let mockSupabaseServer: any;
  let mockSupabaseAdmin: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabaseServer = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'players') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'player-self-1' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    mockSupabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'players') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(() =>
                  Promise.resolve({ data: { id: `player-other-${Date.now()}` }, error: null })
                ),
              }),
            }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'player-owner-1' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'tournaments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'tourney-test-1',
                    name: 'Test Tournament',
                    registration_fee: 50000,
                    owner_registration_fee: 250000,
                    registration_open: true,
                  },
                }),
              }),
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'tourney-test-1',
                      name: 'Test Tournament',
                      registration_fee: 50000,
                      registration_open: true,
                    },
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'registrations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'reg-1',
                    player_id: 'p-1',
                    tournament_id: 'tourney-test-1',
                    registration_status: 'PENDING',
                  },
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'pay-1', registration_id: 'reg-1' },
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === 'team_owners') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        return {};
      }),
      rpc: vi.fn(),
    };

    (createServerSupabaseClient as any).mockResolvedValue(mockSupabaseServer);
    (createAdminClient as any).mockReturnValue(mockSupabaseAdmin);
  });

  const createReq = (body: any) =>
    new NextRequest('http://localhost:3000/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('1. SELF player registration uses authenticated user player profile', async () => {
    mockSupabaseAdmin.rpc.mockResolvedValue({
      data: [{ registration_id: 'reg-self', registration_number: 'REG-001', registration_status: 'PENDING' }],
      error: null,
    });

    const res = await registerPlayer(createReq({
      registrationFor: 'SELF',
      fullName: 'Rahul Sharma',
      profileImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      cricketRole: 'BATSMAN',
      mobile: '9876543210',
    }));

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith('allocate_player_registration_v2', expect.objectContaining({
      p_player_id: 'player-self-1',
      p_created_by_auth_id: 'user-auth-777',
    }));
  });

  it('2. OTHER player registration creates a new tournament-only player record', async () => {
    mockSupabaseAdmin.rpc.mockResolvedValue({
      data: [{ registration_id: 'reg-other-1', registration_number: 'REG-002', registration_status: 'PENDING' }],
      error: null,
    });

    const res = await registerPlayer(createReq({
      registrationFor: 'OTHER',
      fullName: 'Amit Kumar',
      profileImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      cricketRole: 'BOWLER',
      battingStyle: 'RIGHT_HAND',
      bowlingStyle: 'RIGHT_ARM_FAST',
      mobile: '9876543211',
    }));

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('players');
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith('allocate_player_registration_v2', expect.objectContaining({
      p_created_by_auth_id: 'user-auth-777',
    }));
  });

  it('3. Reject Owner registration when Icon photo is missing', async () => {
    const ownerReq = new NextRequest('http://localhost:3000/api/registrations/owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournamentId: 'tourney-test-1',
        ownerName: 'Mahesh Owner',
        contactEmail: 'account@example.com',
        contactPhone: '9876543210',
        teamName: 'Mumbai Warriors',
        iconPlayerName: 'Raj Icon',
        iconPlayerMobile: '9876543212',
        // Missing iconProfileImageUrl
      }),
    });

    const res = await registerOwner(ownerReq);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('Icon player profile photo is required');
  });

  it('4. Owner registration with valid Icon photo passes p_icon_image_snapshot to RPC v4', async () => {
    mockSupabaseAdmin.rpc.mockResolvedValue({
      data: [{ owner_id: 'o-1', slot_number: 1, owner_registration_id: 'reg-owner-1', icon_registration_id: 'reg-icon-1', payment_id: 'pay-owner-1', status: 'PENDING' }],
      error: null,
    });

    const iconPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const ownerReq = new NextRequest('http://localhost:3000/api/registrations/owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournamentId: 'tourney-test-1',
        ownerName: 'Mahesh Owner',
        contactEmail: 'account@example.com',
        contactPhone: '9876543210',
        teamName: 'Mumbai Warriors',
        iconPlayerName: 'Raj Icon',
        iconPlayerMobile: '9876543212',
        iconProfileImageUrl: iconPhoto,
        paymentMethod: 'ACKNOWLEDGE_BY_ORGANISER',
      }),
    });

    const res = await registerOwner(ownerReq);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith('allocate_owner_registration_v4', expect.objectContaining({
      p_icon_image_snapshot: iconPhoto,
      p_payment_method: 'ACKNOWLEDGE_BY_ORGANISER',
    }));
  });

  it('5. Admin ACKNOWLEDGE_AND_APPROVE updates statuses correctly', async () => {
    const approveReq = new NextRequest('http://localhost:3000/api/admin/registrations/reg-1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ACKNOWLEDGE_AND_APPROVE' }),
    });

    const res = await approveRegistration(approveReq, { params: Promise.resolve({ id: 'reg-1' }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.status).toBe('CONFIRMED');
  });
});
