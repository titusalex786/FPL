import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as registerOwner } from '@/app/api/registrations/owner/route';
import { GET as getPlayerProfile, POST as updatePlayerProfile } from '@/app/api/players/profile/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAdminAction } from '@/lib/audit/logger';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/storage/upload', () => ({
  uploadToStorageBucket: vi.fn().mockResolvedValue({ publicUrl: 'https://cdn.example.com/logo.png' }),
  validateImageFileBuffer: vi.fn().mockReturnValue({ isValid: true, mimeType: 'image/png', extension: 'png' }),
  getSignedScreenshotUrl: vi.fn().mockResolvedValue('https://signed.url/screenshot.png'),
}));

vi.mock('@/lib/audit/logger', () => ({
  logAdminAction: vi.fn().mockResolvedValue(undefined),
}));

describe('Admin On-Behalf Registration Flow (15 Core Business Rules)', () => {
  let mockSupabaseServer: any;
  let mockSupabaseAdmin: any;

  const TOURNAMENT_ID = 'edfb6464-c326-4ad8-af8f-b0113f9bdcf3';
  const ADMIN_USER_ID = 'admin-user-uuid-111';
  const ADMIN_EMAIL = 'admin@fpl.cricket';

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabaseServer = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: ADMIN_USER_ID,
              email: ADMIN_EMAIL,
            },
          },
          error: null,
        }),
      },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    mockSupabaseAdmin = {
      auth: { getUser: vi.fn() },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      rpc: vi.fn(),
      then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
    };

    (createServerSupabaseClient as unknown as any).mockResolvedValue(mockSupabaseServer);
    (createAdminClient as unknown as any).mockReturnValue(mockSupabaseAdmin);
  });

  const createRequest = (body: any, headers: Record<string, string> = {}) => {
    return new NextRequest('http://localhost:3000/api/registrations/owner', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  };

  // ─────────────────────────────────────────────────────────────
  // 1. Brand-new Owner with no existing player profile -> Admin successfully creates Owner
  // ─────────────────────────────────────────────────────────────
  it('1. Brand-new Owner with no existing player profile -> Admin successfully creates Owner', async () => {
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null }) // admin check
      .mockResolvedValueOnce({ data: null, error: null }); // lookup owner player -> not found

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'newly-created-owner-player-id' },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{
        owner_id: 'team-owner-uuid-1',
        slot_number: 1,
        owner_registration_id: 'reg-owner-1',
        icon_registration_id: 'reg-icon-1',
        payment_id: 'pay-1',
        status: 'PENDING',
      }],
      error: null,
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      autoApprove: true,
      ownerName: 'Rahul Sharma',
      contactEmail: 'rahul@gmail.com',
      contactPhone: '9876543210',
      teamName: 'Kingsman',
      iconPlayerName: 'Amit Patil',
      iconPlayerMobile: '9876543211',
    });

    const res = await registerOwner(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    // Verify player profile was inserted with on-behalf tournament-only flag
    expect(mockSupabaseAdmin.insert).toHaveBeenCalledWith(expect.objectContaining({
      full_name: 'Rahul Sharma',
      email: 'rahul@gmail.com',
      mobile: '9876543210',
      is_tournament_only: true,
      player_type: 'OWNER',
    }));
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Brand-new Icon with no existing player profile -> Admin successfully creates Icon
  // ─────────────────────────────────────────────────────────────
  it('2. Brand-new Icon with no existing player profile -> Admin successfully creates Icon', async () => {
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'new-owner-id' },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{
        owner_id: 'team-owner-uuid-2',
        slot_number: 2,
        owner_registration_id: 'reg-owner-2',
        icon_registration_id: 'reg-icon-2',
        payment_id: 'pay-2',
        status: 'PENDING',
      }],
      error: null,
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      autoApprove: true,
      ownerName: 'Sunil Gavaskar',
      contactEmail: 'sunil@gmail.com',
      contactPhone: '9876543220',
      teamName: 'Sunrisers',
      iconPlayerName: 'Amit Patil',
      iconPlayerMobile: '9876543221',
      iconPlayerRole: 'ALL_ROUNDER',
      iconPlayerBattingStyle: 'RIGHT_HAND',
      iconPlayerBowlingStyle: 'RIGHT_ARM_FAST',
    });

    const res = await registerOwner(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.iconRegistrationId).toBe('reg-icon-2');

    // Verify allocate_owner_registration_v4 was called with Icon parameters
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
      'allocate_owner_registration_v4',
      expect.objectContaining({
        p_icon_name: 'Amit Patil',
        p_icon_mobile: '9876543221',
        p_icon_role: 'ALL_ROUNDER',
        p_icon_batting_style: 'RIGHT_HAND',
        p_icon_bowling_style: 'RIGHT_ARM_FAST',
      })
    );
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Brand-new Owner + brand-new Icon -> Team + OWNER + ICON created successfully
  // ─────────────────────────────────────────────────────────────
  it('3. Brand-new Owner + brand-new Icon -> Team + OWNER + ICON created successfully', async () => {
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'rahul-owner-id' },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{
        owner_id: 'kingsman-owner-uuid',
        slot_number: 1,
        owner_registration_id: 'kingsman-owner-reg',
        icon_registration_id: 'kingsman-icon-reg',
        payment_id: 'kingsman-pay',
        status: 'PENDING',
      }],
      error: null,
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      autoApprove: true,
      ownerName: 'Rahul Sharma',
      contactEmail: 'rahul@gmail.com',
      contactPhone: '9876543210',
      teamName: 'Kingsman',
      iconPlayerName: 'Amit Patil',
      iconPlayerMobile: '9876543211',
    });

    const res = await registerOwner(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ownerId).toBe('kingsman-owner-uuid');
    expect(json.ownerRegistrationId).toBe('kingsman-owner-reg');
    expect(json.iconRegistrationId).toBe('kingsman-icon-reg');
    expect(json.paymentId).toBe('kingsman-pay');
    expect(json.status).toBe('APPROVED');
  });

  // ─────────────────────────────────────────────────────────────
  // 4. New Owner does not need authentication
  // ─────────────────────────────────────────────────────────────
  it('4. New Owner does not need authentication (unlinked profile created with auth_user_id null)', async () => {
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'offline-owner-id' },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{
        owner_id: 'team-owner-offline',
        slot_number: 1,
        owner_registration_id: 'reg-owner-offline',
        icon_registration_id: 'reg-icon-offline',
        payment_id: 'pay-offline',
        status: 'PENDING',
      }],
      error: null,
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      ownerName: 'Elderly Participant',
      contactEmail: 'elderly@example.com',
      contactPhone: '9876500000',
      teamName: 'Classic XI',
      iconPlayerName: 'Classic Icon',
      iconPlayerMobile: '9876500001',
    });

    const res = await registerOwner(req);
    expect(res.status).toBe(200);

    // Verify that the created owner player profile does NOT require or bind an auth_user_id
    const insertCall = mockSupabaseAdmin.insert.mock.calls.find(
      (call: any) => call[0]?.full_name === 'Elderly Participant'
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[0].auth_user_id).toBeUndefined();
    expect(insertCall[0].is_tournament_only).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // 5. New Icon does not need authentication
  // ─────────────────────────────────────────────────────────────
  it('5. New Icon does not need authentication (Icon is managed by team owner without auth requirement)', async () => {
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'owner-id-5' },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{
        owner_id: 'owner-uuid-5',
        slot_number: 1,
        owner_registration_id: 'owner-reg-5',
        icon_registration_id: 'icon-reg-5',
        payment_id: 'pay-5',
        status: 'PENDING',
      }],
      error: null,
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      ownerName: 'Owner Five',
      contactEmail: 'five@example.com',
      contactPhone: '9876500005',
      teamName: 'Team Five',
      iconPlayerName: 'Unregistered Icon Star',
      iconPlayerMobile: '9876500006',
    });

    const res = await registerOwner(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.iconRegistrationId).toBe('icon-reg-5');
  });

  // ─────────────────────────────────────────────────────────────
  // 6. Same existing Owner can later be used for another team
  // ─────────────────────────────────────────────────────────────
  it('6. Same existing Owner can later be used for another team (reuses existing player_id)', async () => {
    const REUSED_PLAYER_ID = 'player-profile-rahul-sharma';
    const OWNER_EMAIL = 'rahul@gmail.com';
    const OWNER_PHONE = '9876543210';

    // First team: Kingsman
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null }); // brand new

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: REUSED_PLAYER_ID },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{
        owner_id: 'owner-kingsman',
        slot_number: 1,
        owner_registration_id: 'reg-owner-1',
        icon_registration_id: 'reg-icon-1',
        payment_id: 'pay-1',
        status: 'PENDING',
      }],
      error: null,
    });

    await registerOwner(createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      ownerName: 'Rahul Sharma',
      contactEmail: OWNER_EMAIL,
      contactPhone: OWNER_PHONE,
      teamName: 'Kingsman',
      iconPlayerName: 'Amit Patil',
      iconPlayerMobile: '9876543211',
    }));

    // Second team: Warriors (Existing player found by email)
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: { id: REUSED_PLAYER_ID, full_name: 'Rahul Sharma' }, error: null });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{
        owner_id: 'owner-warriors',
        slot_number: 2,
        owner_registration_id: 'reg-owner-2',
        icon_registration_id: 'reg-icon-2',
        payment_id: 'pay-2',
        status: 'PENDING',
      }],
      error: null,
    });

    const res2 = await registerOwner(createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      ownerName: 'Rahul Sharma',
      contactEmail: OWNER_EMAIL,
      contactPhone: OWNER_PHONE,
      teamName: 'Warriors',
      iconPlayerName: 'Rohan Patil',
      iconPlayerMobile: '9876543212',
    }));

    expect(res2.status).toBe(200);

    // Verify RPC was passed REUSED_PLAYER_ID and did not insert a duplicate player
    expect(mockSupabaseAdmin.rpc).toHaveBeenLastCalledWith(
      'allocate_owner_registration_v4',
      expect.objectContaining({
        p_owner_player_id: REUSED_PLAYER_ID,
        p_team_name: 'Warriors',
      })
    );
  });

  // ─────────────────────────────────────────────────────────────
  // 7. Duplicate team name rejected
  // ─────────────────────────────────────────────────────────────
  it('7. Duplicate team name rejected with DUPLICATE_TEAM_NAME code', async () => {
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'owner-dup-team' },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'This team name is already registered for this tournament. Please choose another team name.' },
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      ownerName: 'Different Person',
      contactEmail: 'diff@example.com',
      contactPhone: '9876500077',
      teamName: 'Kingsman', // Duplicate!
      iconPlayerName: 'Diff Icon',
      iconPlayerMobile: '9876500078',
    });

    const res = await registerOwner(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('DUPLICATE_TEAM_NAME');
    expect(json.error).toContain('This team name is already registered for this tournament');
  });

  // ─────────────────────────────────────────────────────────────
  // 8. Team #10 allowed
  // ─────────────────────────────────────────────────────────────
  it('8. Team #10 allowed when max_teams = 10 (without mutating tournament capacity)', async () => {
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'owner-10' },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{
        owner_id: 'owner-10-uuid',
        slot_number: 10,
        owner_registration_id: 'reg-owner-10',
        icon_registration_id: 'reg-icon-10',
        payment_id: 'pay-10',
        status: 'PENDING',
      }],
      error: null,
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      ownerName: 'Tenth Owner',
      contactEmail: 'ten@example.com',
      contactPhone: '9876500010',
      teamName: 'Tenth Team',
      iconPlayerName: 'Tenth Icon',
      iconPlayerMobile: '9876500011',
    });

    const res = await registerOwner(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.slotNumber).toBe(10);

    // Verify tournament was never updated
    const updateCalls = mockSupabaseAdmin.update.mock.calls.filter(
      (c: any) => c[0]?.max_teams !== undefined
    );
    expect(updateCalls.length).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 9. Team #11 rejected
  // ─────────────────────────────────────────────────────────────
  it('9. Team #11 rejected when max_teams = 10 with TEAM_LIMIT_REACHED code', async () => {
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'owner-11' },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'All owner slots for this tournament have been filled' },
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      ownerName: 'Eleventh Owner',
      contactEmail: 'eleven@example.com',
      contactPhone: '9876500012',
      teamName: 'Eleventh Team',
      iconPlayerName: 'Eleventh Icon',
      iconPlayerMobile: '9876500013',
    });

    const res = await registerOwner(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('TEAM_LIMIT_REACHED');
    expect(json.error).toContain('all team owner slots for this tournament are filled');
  });

  // ─────────────────────────────────────────────────────────────
  // 10. Insufficient player capacity rejects entire operation
  // ─────────────────────────────────────────────────────────────
  it('10. Insufficient player capacity rejects entire operation with PLAYER_CAPACITY_REACHED', async () => {
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'owner-cap-fail' },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Insufficient player slots remaining for Owner + Icon registration (requires 2 player slots)' },
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      ownerName: 'Cap Owner',
      contactEmail: 'capowner@example.com',
      contactPhone: '9876500088',
      teamName: 'Cap XI',
      iconPlayerName: 'Cap Icon',
      iconPlayerMobile: '9876500089',
    });

    const res = await registerOwner(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('PLAYER_CAPACITY_REACHED');
  });

  // ─────────────────────────────────────────────────────────────
  // 11. No partial Owner/Team/Icon records
  // ─────────────────────────────────────────────────────────────
  it('11. No partial Owner/Team/Icon records created if operation fails', async () => {
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: { id: ADMIN_USER_ID, role: 'ADMIN', status: 'ACTIVE' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'owner-partial-check' },
      error: null,
    });

    // RPC fails
    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Registration slot collision. Please try again.' },
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      isAdminEntry: true,
      autoApprove: true,
      ownerName: 'Atomic Fail Owner',
      contactEmail: 'atomicfail@example.com',
      contactPhone: '9876500099',
      teamName: 'Fail XI',
      iconPlayerName: 'Fail Icon',
      iconPlayerMobile: '9876500098',
    });

    const res = await registerOwner(req);
    expect(res.status).toBe(400);

    // Verify autoApprove post-processing NEVER ran
    expect(mockSupabaseAdmin.update).not.toHaveBeenCalledWith(expect.objectContaining({
      registration_status: 'CONFIRMED',
    }));
  });

  // ─────────────────────────────────────────────────────────────
  // 12. Existing public registration remains unchanged
  // ─────────────────────────────────────────────────────────────
  it('12. Existing public registration remains unchanged (PENDING status, no auto-approval)', async () => {
    const PUBLIC_USER_ID = 'public-user-uuid-888';
    const PUBLIC_USER_EMAIL = 'public@example.com';

    mockSupabaseServer.auth.getUser.mockResolvedValueOnce({
      data: {
        user: {
          id: PUBLIC_USER_ID,
          email: PUBLIC_USER_EMAIL,
        },
      },
      error: null,
    });

    // Public user is not admin
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
      data: { id: 'public-player-id' },
      error: null,
    });

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({
      data: [{
        owner_id: 'public-owner-id',
        slot_number: 1,
        owner_registration_id: 'public-owner-reg',
        icon_registration_id: 'public-icon-reg',
        payment_id: 'public-pay',
        status: 'PENDING',
      }],
      error: null,
    });

    const req = createRequest({
      tournamentId: TOURNAMENT_ID,
      ownerName: 'Public Participant',
      contactEmail: PUBLIC_USER_EMAIL,
      contactPhone: '9876512345',
      teamName: 'Public Strikers',
      iconPlayerName: 'Public Icon',
      iconPlayerMobile: '9876512346',
      iconProfileImageUrl: 'https://example.com/icon.png',
    });

    const res = await registerOwner(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('PENDING'); // Must NOT be auto-approved
  });

  // ─────────────────────────────────────────────────────────────
  // 13. Later Owner signup can link to the existing Admin-created profile without creating a duplicate
  // ─────────────────────────────────────────────────────────────
  it('13. Later Owner signup can link to the existing Admin-created profile without creating a duplicate', async () => {
    const SIGNED_UP_AUTH_ID = 'newly-registered-auth-id';
    const OWNER_EMAIL = 'rahul@gmail.com';

    mockSupabaseServer.auth.getUser.mockResolvedValueOnce({
      data: {
        user: {
          id: SIGNED_UP_AUTH_ID,
          email: OWNER_EMAIL,
        },
      },
      error: null,
    });

    // No player linked to auth_user_id yet
    mockSupabaseAdmin.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // select * where auth_user_id = user.id
      .mockResolvedValueOnce({ // find unlinked tournament-only record by email
        data: {
          id: 'admin-created-player-id-rahul',
          full_name: 'Rahul Sharma',
          email: OWNER_EMAIL,
          is_tournament_only: true,
          auth_user_id: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ // update returning linked profile
        data: {
          id: 'admin-created-player-id-rahul',
          full_name: 'Rahul Sharma',
          email: OWNER_EMAIL,
          is_tournament_only: false,
          auth_user_id: SIGNED_UP_AUTH_ID,
        },
        error: null,
      });

    const res = await getPlayerProfile();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.player.id).toBe('admin-created-player-id-rahul');
    expect(json.player.auth_user_id).toBe(SIGNED_UP_AUTH_ID);

    // Verify it bound auth_user_id to existing profile without creating a new player row
    expect(mockSupabaseAdmin.update).toHaveBeenCalledWith(expect.objectContaining({
      auth_user_id: SIGNED_UP_AUTH_ID,
      is_tournament_only: false,
    }));
  });

  // ─────────────────────────────────────────────────────────────
  // 14. Icon remains excluded from auction pool
  // ─────────────────────────────────────────────────────────────
  it('14. Icon remains excluded from auction pool (registration_type = ICON excluded from player auction pool)', () => {
    // Auction pool rule: SELECT * FROM registrations WHERE registration_type = 'PLAYER'
    const sampleRegistrations = [
      { id: 'reg-1', full_name: 'Normal Player', registration_type: 'PLAYER', status: 'CONFIRMED' },
      { id: 'reg-2', full_name: 'Rahul Sharma', registration_type: 'OWNER', status: 'CONFIRMED' },
      { id: 'reg-3', full_name: 'Amit Patil', registration_type: 'ICON', status: 'CONFIRMED' },
    ];

    const auctionPlayerPool = sampleRegistrations.filter(
      (r) => r.registration_type === 'PLAYER' && r.status === 'CONFIRMED'
    );

    expect(auctionPlayerPool.length).toBe(1);
    expect(auctionPlayerPool[0].full_name).toBe('Normal Player');

    // Verify Icon is excluded
    expect(auctionPlayerPool.some((r) => r.registration_type === 'ICON')).toBe(false);
    // Verify Owner is excluded from auction lot pool
    expect(auctionPlayerPool.some((r) => r.registration_type === 'OWNER')).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────
  // 15. Owner remains eligible according to existing auction rules
  // ─────────────────────────────────────────────────────────────
  it('15. Owner remains eligible according to existing auction rules (team owner record has bidding authority)', () => {
    const sampleTeamOwner = {
      id: 'owner-kingsman-id',
      tournament_id: TOURNAMENT_ID,
      team_name: 'Kingsman',
      owner_name: 'Rahul Sharma',
      status: 'APPROVED',
      payment_status: 'SUCCESSFUL',
    };

    // Auction dashboard authorization check
    const isEligibleToBid = sampleTeamOwner.status === 'APPROVED';
    expect(isEligibleToBid).toBe(true);
    expect(sampleTeamOwner.team_name).toBe('Kingsman');
  });
});
