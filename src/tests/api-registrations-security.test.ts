import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as registerPlayer } from '@/app/api/registrations/route';
import { POST as registerOwner } from '@/app/api/registrations/owner/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/storage/upload', () => ({
  uploadToStorageBucket: vi.fn(),
}));

describe('API Route Security - /api/registrations', () => {
  let mockSupabaseServer: any;
  let mockSupabaseAdmin: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabaseServer = {
      auth: { getUser: vi.fn() },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };

    mockSupabaseAdmin = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      rpc: vi.fn(),
    };

    (createServerSupabaseClient as unknown as any).mockResolvedValue(mockSupabaseServer);
    (createAdminClient as unknown as any).mockReturnValue(mockSupabaseAdmin);
  });

  const createMockRequest = (body: any) => {
    return new NextRequest('http://localhost:3000/api/registrations', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  };

  it('A. Anonymous POST → 401', async () => {
    mockSupabaseServer.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'No user' } });
    const req = createMockRequest({ fullName: 'Test', profileImageUrl: 'url' });

    const res = await registerPlayer(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Authentication required');
  });

  it('B. Authenticated user registering themselves → existing flow succeeds', async () => {
    mockSupabaseServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-123' } }, error: null });

    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: { id: 'player-123' }, error: null });
    mockSupabaseAdmin.maybeSingle.mockResolvedValueOnce({ data: { id: 'tourn-123', registration_fee: 100 }, error: null });
    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{ registration_id: 'r-1', registration_number: '123', registration_status: 'PENDING', waitlist_position: null, payment_id: 'p-1' }],
      error: null
    });

    const req = createMockRequest({ fullName: 'Test', profileImageUrl: 'url', tournamentId: 'tourn-123' });
    const res = await registerPlayer(req);

    expect(res.status).toBe(200);
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith('allocate_player_registration_v2', expect.objectContaining({
      p_player_id: 'player-123'
    }));
  });

  it.each([
    ['BATSMAN', 'RIGHT_HAND', 'DOESNT_BOWL'],
    ['BOWLER', 'LEFT_HAND', 'RIGHT_ARM_FAST'],
    ['ALL_ROUNDER', 'RIGHT_HAND', 'RIGHT_ARM_SPIN'],
    ['BATSMAN_WICKETKEEPER', 'LEFT_HAND', 'DOESNT_BOWL'],
    ['BOWLER_WICKETKEEPER', 'RIGHT_HAND', 'LEFT_ARM_MEDIUM'],
  ])('B2. Regular %s registration keeps batting and bowling fields separate', async (role, battingStyle, bowlingStyle) => {
    mockSupabaseServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-123' } }, error: null });
    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: { id: 'player-123' }, error: null });
    mockSupabaseAdmin.maybeSingle.mockResolvedValueOnce({ data: { id: 'tourn-123', registration_fee: 100 }, error: null });
    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{ registration_id: 'r-1', registration_number: '123', registration_status: 'PENDING', waitlist_position: null, payment_id: 'p-1' }],
      error: null,
    });

    const req = createMockRequest({
      fullName: 'Test Player',
      profileImageUrl: 'url',
      tournamentId: 'tourn-123',
      cricketRole: role,
      battingStyle,
      bowlingStyle,
    });
    const res = await registerPlayer(req);

    expect(res.status).toBe(200);
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
      'allocate_player_registration_v2',
      expect.objectContaining({
        p_registered_role_snapshot: role,
        p_registered_batting_style_snapshot: battingStyle,
        p_registered_bowling_style_snapshot: bowlingStyle,
      })
    );
  });

  it('B3. Invalid batting or bowling enum values are rejected before calling the database RPC', async () => {
    mockSupabaseServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-123' } }, error: null });

    const req = createMockRequest({
      fullName: 'Test Player',
      profileImageUrl: 'url',
      cricketRole: 'BOWLER',
      battingStyle: 'RIGHT_ARM_FAST',
      bowlingStyle: 'RIGHT_ARM_FAST',
    });
    const res = await registerPlayer(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid cricket role or style');
    expect(json.details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'battingStyle',
        message: expect.stringContaining('RIGHT_HAND'),
      }),
    ]));
    expect(mockSupabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it('C. Authenticated user attempting to supply another player\'s playerId → rejected/ignored', async () => {
    mockSupabaseServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-123' } }, error: null });

    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: { id: 'my-player-123' }, error: null });
    mockSupabaseAdmin.maybeSingle.mockResolvedValueOnce({ data: { id: 'tourn-123' }, error: null });
    mockSupabaseAdmin.rpc.mockResolvedValueOnce({ data: [{}], error: null });

    const req = createMockRequest({ fullName: 'Test', profileImageUrl: 'url', playerId: 'hacker-supplied-id' });
    await registerPlayer(req);

    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith('allocate_player_registration_v2', expect.objectContaining({
      p_player_id: 'my-player-123'
    }));
  });

  it('D. Authenticated user attempting to use another person\'s email for identity → cannot change target player', async () => {
    mockSupabaseServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-123' } }, error: null });

    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: { id: 'my-player-123' }, error: null });
    mockSupabaseAdmin.maybeSingle.mockResolvedValueOnce({ data: { id: 'tourn-123' }, error: null });
    mockSupabaseAdmin.rpc.mockResolvedValueOnce({ data: [{}], error: null });

    const req = createMockRequest({ fullName: 'Test', profileImageUrl: 'url', email: 'otherperson@example.com' });
    await registerPlayer(req);

    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith('allocate_player_registration_v2', expect.objectContaining({
      p_player_id: 'my-player-123'
    }));
  });

  it('E. Client-supplied paymentScreenshotUrl → ignored/rejected', async () => {
    mockSupabaseServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-123' } }, error: null });
    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: { id: 'player-123' }, error: null });
    mockSupabaseAdmin.maybeSingle.mockResolvedValueOnce({ data: { id: 'tourn-123' }, error: null });
    mockSupabaseAdmin.rpc.mockResolvedValueOnce({ data: [{}], error: null });

    const req = createMockRequest({
      fullName: 'Test',
      profileImageUrl: 'url',
      paymentScreenshotUrl: 'https://hacker.com/fake.png'
    });
    await registerPlayer(req);

    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith('allocate_player_registration_v2', expect.objectContaining({
      p_screenshot_object_path: null
    }));
  });

  it('F. Owner registration cannot specify another player\'s ownerPlayerId', async () => {
    mockSupabaseServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-123' } }, error: null });
    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: { id: 'my-player-123' }, error: null });
    mockSupabaseAdmin.rpc.mockResolvedValueOnce({ data: [{}], error: null });

    const req = new NextRequest('http://localhost:3000/api/registrations/owner', {
      method: 'POST',
      body: JSON.stringify({
        tournamentId: 'tourn-123',
        ownerName: 'Owner',
        contactEmail: 'owner@example.com',
        iconProfileImageUrl: 'data:image/png;base64,iVBORw0KGgo=',
        playerId: 'hacker-supplied-id'
      }),
    });

    await registerOwner(req);

    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith('allocate_owner_registration_v4', expect.objectContaining({
      p_owner_player_id: 'my-player-123'
    }));
  });

  it('G. Icon all-rounder submits batting and bowling styles to separate RPC arguments', async () => {
    mockSupabaseServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-123' } }, error: null });
    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: { id: 'my-player-123' }, error: null });
    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{
        owner_id: 'owner-1',
        slot_number: 1,
        owner_registration_id: 'owner-reg-1',
        icon_registration_id: 'icon-reg-1',
        payment_id: 'payment-1',
        status: 'PENDING',
      }],
      error: null,
    });

    const req = new NextRequest('http://localhost:3000/api/registrations/owner', {
      method: 'POST',
      body: JSON.stringify({
        tournamentId: 'tourn-123',
        ownerName: 'Owner',
        contactEmail: 'owner@example.com',
        teamName: 'Team One',
        ownerRole: 'BOWLER',
        ownerBattingStyle: 'LEFT_HAND',
        ownerBowlingStyle: 'LEFT_ARM_SPIN',
        iconPlayerName: 'Icon All-rounder',
        iconPlayerRole: 'ALL_ROUNDER',
        iconPlayerBattingStyle: 'RIGHT_HAND',
        iconPlayerBowlingStyle: 'RIGHT_ARM_FAST',
        iconProfileImageUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    });

    const res = await registerOwner(req);

    expect(res.status).toBe(200);
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
      'allocate_owner_registration_v4',
      expect.objectContaining({
        p_owner_role: 'BOWLER',
        p_owner_batting_style: 'LEFT_HAND',
        p_owner_bowling_style: 'LEFT_ARM_SPIN',
        p_icon_role: 'ALL_ROUNDER',
        p_icon_batting_style: 'RIGHT_HAND',
        p_icon_bowling_style: 'RIGHT_ARM_FAST',
      })
    );
  });

  it('H. Owner endpoint clearly rejects a bowling enum value used as a batting style', async () => {
    mockSupabaseServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-123' } }, error: null });

    const req = new NextRequest('http://localhost:3000/api/registrations/owner', {
      method: 'POST',
      body: JSON.stringify({
        tournamentId: 'tourn-123',
        ownerName: 'Owner',
        contactEmail: 'owner@example.com',
        ownerBattingStyle: 'RIGHT_ARM_FAST',
        iconProfileImageUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    });

    const res = await registerOwner(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid Owner cricket role or style');
    expect(mockSupabaseAdmin.rpc).not.toHaveBeenCalled();
  });
});
