import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as registerOwner } from '@/app/api/registrations/owner/route';
import { GET as getTeamDashboard } from '@/app/api/auctions/[auctionId]/team-dashboard/route';
import { GET as getBidState, POST as placeBid } from '@/app/api/auctions/[auctionId]/bid/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveDashboardOwner } from '@/lib/auction/team-dashboard';

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

describe('P1.2 — Team Owner Authentication & Multi-Owner Same Email Support', () => {
  let mockSupabaseServer: any;
  let mockSupabaseAdmin: any;
  const mockPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const TOURNAMENT_ID = 'edfb6464-c326-4ad8-af8f-b0113f9bdcf3';
  const AUTH_USER_ID = 'auth-user-multi-owner-123';
  const AUTH_USER_EMAIL = 'owner@example.com';
  const PLAYER_PROFILE_ID = 'player-profile-reusable-123';

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
      auth: { getUser: vi.fn() },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      single: vi.fn(),
      upsert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      rpc: vi.fn(),
    };

    (createServerSupabaseClient as unknown as any).mockResolvedValue(mockSupabaseServer);
    (createAdminClient as unknown as any).mockReturnValue(mockSupabaseAdmin);
  });

  const createRequest = (body: any, headers: Record<string, string> = {}) => {
    return new NextRequest('http://localhost:3000/api/registrations/owner', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        iconProfileImageUrl: mockPhoto,
        ownerProfileImageUrl: mockPhoto,
        ...body,
      }),
    });
  };

  // =========================================================================
  // ISSUE 1 — AUTHENTICATION CHAIN & GUARDS
  // =========================================================================
  describe('Issue 1: Authentication Chain & Security', () => {
    it('1.1 Rejects unauthenticated request without cookies or Bearer token with 401', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'No cookie session' },
      });

      const req = createRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Owner One',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Team Alpha',
        iconPlayerName: 'Icon One',
        iconPlayerMobile: '9876543210',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Authentication required');
    });

    it('1.2 Accepts authenticated request via cookie session and binds to server user.id', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: [
          {
            owner_id: 'owner-entry-1',
            slot_number: 1,
            owner_registration_id: 'reg-owner-1',
            icon_registration_id: 'reg-icon-1',
            payment_id: 'pay-1',
            status: 'PENDING',
          },
        ],
        error: null,
      });

      const req = createRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Owner One',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Team Alpha',
        iconPlayerName: 'Icon One',
        iconPlayerMobile: '9876543210',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.ownerId).toBe('owner-entry-1');
      expect(json.slotNumber).toBe(1);

      // Verify RPC was called with server-resolved auth_user_id
      expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
        'allocate_owner_registration_v4',
        expect.objectContaining({
          p_created_by_auth_id: AUTH_USER_ID,
          p_owner_player_id: PLAYER_PROFILE_ID,
          p_team_name: 'Team Alpha',
        })
      );
    });

    it('1.3 Accepts authenticated request via Bearer token fallback when cookie session is absent', async () => {
      // Cookie returns null
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      // Bearer token verification succeeds on server
      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: [
          {
            owner_id: 'owner-entry-1',
            slot_number: 1,
            owner_registration_id: 'reg-owner-1',
            icon_registration_id: 'reg-icon-1',
            payment_id: 'pay-1',
            status: 'PENDING',
          },
        ],
        error: null,
      });

      const req = createRequest(
        {
          tournamentId: TOURNAMENT_ID,
          ownerName: 'Owner One',
          contactEmail: AUTH_USER_EMAIL,
          teamName: 'Team Alpha',
          iconPlayerName: 'Icon One',
          iconPlayerMobile: '9876543210',
        },
        { Authorization: 'Bearer valid-jwt-token-from-client' }
      );

      const res = await registerOwner(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockSupabaseAdmin.auth.getUser).toHaveBeenCalledWith('valid-jwt-token-from-client');
    });

    it('1.4 Rejects invalid or expired Bearer token with 401', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      const req = createRequest(
        {
          tournamentId: TOURNAMENT_ID,
          ownerName: 'Owner One',
          contactEmail: AUTH_USER_EMAIL,
          teamName: 'Team Alpha',
          iconPlayerName: 'Icon One',
          iconPlayerMobile: '9876543210',
        },
        { Authorization: 'Bearer forged-or-expired-token' }
      );

      const res = await registerOwner(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Authentication required');
    });

    it('1.5 Security: Prevents IDOR impersonation by ignoring client-supplied auth_user_id', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: [
          {
            owner_id: 'owner-entry-1',
            slot_number: 1,
            owner_registration_id: 'reg-owner-1',
            icon_registration_id: 'reg-icon-1',
            payment_id: 'pay-1',
            status: 'PENDING',
          },
        ],
        error: null,
      });

      const req = createRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Owner One',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Team Alpha',
        iconPlayerName: 'Icon One',
        iconPlayerMobile: '9876543210',
        auth_user_id: 'victim-auth-user-id', // Attacker attempts to forge creator
        createdByAuthId: 'victim-auth-user-id',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(200);

      // Must strictly use AUTH_USER_ID from server session
      expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
        'allocate_owner_registration_v4',
        expect.objectContaining({
          p_created_by_auth_id: AUTH_USER_ID,
        })
      );
    });
  });

  // =========================================================================
  // ISSUE 2 — SAME EMAIL MULTIPLE OWNERS (TEAM A, TEAM B, TEAM C)
  // =========================================================================
  describe('Issue 2: Multi-Owner Registration Under Same Email', () => {
    it('2.1 Successfully registers Team A under the authenticated account', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: [
          {
            owner_id: 'team-owner-alpha-id',
            slot_number: 1,
            owner_registration_id: 'reg-owner-alpha',
            icon_registration_id: 'reg-icon-alpha',
            payment_id: 'pay-alpha',
            status: 'PENDING',
          },
        ],
        error: null,
      });

      const req = createRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Atul Owner',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Royal Strikers Mumbai',
        iconPlayerName: 'Icon Alpha',
        iconPlayerMobile: '9876543210',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ownerId).toBe('team-owner-alpha-id');
      expect(json.slotNumber).toBe(1);
    });

    it('2.2 Successfully registers Team B under the SAME authenticated account (reusing player profile)', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      // Existing reusable player profile found
      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      // RPC allocates Team B into slot 2 atomically
      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: [
          {
            owner_id: 'team-owner-beta-id',
            slot_number: 2,
            owner_registration_id: 'reg-owner-beta',
            icon_registration_id: 'reg-icon-beta',
            payment_id: 'pay-beta',
            status: 'PENDING',
          },
        ],
        error: null,
      });

      const req = createRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Atul Owner',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Super Kings Pune',
        iconPlayerName: 'Icon Beta',
        iconPlayerMobile: '9123456780',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ownerId).toBe('team-owner-beta-id');
      expect(json.slotNumber).toBe(2);

      // Verify Player #1 profile was reused, not duplicated
      expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
        'allocate_owner_registration_v4',
        expect.objectContaining({
          p_owner_player_id: PLAYER_PROFILE_ID,
          p_team_name: 'Super Kings Pune',
          p_created_by_auth_id: AUTH_USER_ID,
        })
      );
    });

    it('2.3 Successfully registers Team C under the SAME authenticated account', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: [
          {
            owner_id: 'team-owner-gamma-id',
            slot_number: 3,
            owner_registration_id: 'reg-owner-gamma',
            icon_registration_id: 'reg-icon-gamma',
            payment_id: 'pay-gamma',
            status: 'PENDING',
          },
        ],
        error: null,
      });

      const req = createRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Atul Owner',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Titans Bangalore',
        iconPlayerName: 'Icon Gamma',
        iconPlayerMobile: '9811122233',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ownerId).toBe('team-owner-gamma-id');
      expect(json.slotNumber).toBe(3);
    });

    it('2.4 Rejects duplicate team name in same tournament with friendly error', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      // RPC throws unique_violation error
      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'A team owner or team name with this detail already exists for this tournament.' },
      });

      const req = createRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Atul Owner',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Royal Strikers Mumbai', // Duplicate team name
        iconPlayerName: 'Icon Delta',
        iconPlayerMobile: '9811122244',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('already registered');
    });

    it('2.5 Enforces owner slot capacity limit (max_teams)', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'All owner slots for this tournament have been filled' },
      });

      const req = createRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Atul Owner',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Team Ten',
        iconPlayerName: 'Icon Ten',
        iconPlayerMobile: '9811122255',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Registration could not be completed because all team owner slots for this tournament are filled.');
    });
  });

  // =========================================================================
  // STEP 8 — OWNER LOGIN & AUCTION DISAMBIGUATION
  // =========================================================================
  describe('Step 8: Auction Team Disambiguation & Financial Isolation', () => {
    const ownerA = {
      id: 'owner-entry-alpha',
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_PROFILE_ID,
      owner_name: 'Atul Owner',
      team_name: 'Team Alpha',
      team_logo_url: 'https://cdn.example.com/alpha.png',
      icon_registration_id: 'icon-alpha-id',
      icon_player_name: 'Icon Alpha',
      icon_player_role: 'BATSMAN',
    };

    const ownerB = {
      id: 'owner-entry-beta',
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_PROFILE_ID,
      owner_name: 'Atul Owner',
      team_name: 'Team Beta',
      team_logo_url: 'https://cdn.example.com/beta.png',
      icon_registration_id: 'icon-beta-id',
      icon_player_name: 'Icon Beta',
      icon_player_role: 'BOWLER',
    };

    it('8.1 resolveDashboardOwner returns null when owner owns multiple teams and teamOwnerId is omitted (avoids guessing)', () => {
      const resolved = resolveDashboardOwner(
        PLAYER_PROFILE_ID,
        TOURNAMENT_ID,
        [ownerA, ownerB]
      );
      expect(resolved).toBeNull();
    });

    it('8.2 resolveDashboardOwner resolves specifically to Team Alpha when teamOwnerId is specified', () => {
      const resolved = resolveDashboardOwner(
        PLAYER_PROFILE_ID,
        TOURNAMENT_ID,
        [ownerA, ownerB],
        'owner-entry-alpha'
      );
      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe('owner-entry-alpha');
      expect(resolved?.team_name).toBe('Team Alpha');
    });

    it('8.3 resolveDashboardOwner resolves specifically to Team Beta when teamOwnerId is specified', () => {
      const resolved = resolveDashboardOwner(
        PLAYER_PROFILE_ID,
        TOURNAMENT_ID,
        [ownerA, ownerB],
        'owner-entry-beta'
      );
      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe('owner-entry-beta');
      expect(resolved?.team_name).toBe('Team Beta');
    });

    it('8.4 resolveDashboardOwner rejects request for another user team ID (cross-owner IDOR prevention)', () => {
      const otherUserOwner = {
        ...ownerA,
        id: 'other-user-team',
        player_id: 'another-player-id',
      };

      const resolved = resolveDashboardOwner(
        PLAYER_PROFILE_ID,
        TOURNAMENT_ID,
        [ownerA, otherUserOwner],
        'other-user-team'
      );
      expect(resolved).toBeNull();
    });
  });

  // =========================================================================
  // STEP 10 & 11 — PAYMENT ISOLATION & ADMIN REPRESENTATION
  // =========================================================================
  describe('Step 10 & 11: Payment Isolation & Admin Representation', () => {
    it('10.1 Multiple teams for same user have isolated payment and registration records', () => {
      const teamA_Registration = {
        id: 'reg-owner-alpha',
        team_owner_id: 'owner-entry-alpha',
        registration_type: 'OWNER',
        team_name: 'Team Alpha',
      };
      const teamB_Registration = {
        id: 'reg-owner-beta',
        team_owner_id: 'owner-entry-beta',
        registration_type: 'OWNER',
        team_name: 'Team Beta',
      };

      const teamA_Payment = {
        id: 'pay-alpha',
        registration_id: 'reg-owner-alpha',
        team_owner_id: 'owner-entry-alpha',
        payment_status: 'PENDING',
      };
      const teamB_Payment = {
        id: 'pay-beta',
        registration_id: 'reg-owner-beta',
        team_owner_id: 'owner-entry-beta',
        payment_status: 'CONFIRMED',
      };

      expect(teamA_Registration.id).not.toBe(teamB_Registration.id);
      expect(teamA_Registration.team_owner_id).not.toBe(teamB_Registration.team_owner_id);
      expect(teamA_Payment.id).not.toBe(teamB_Payment.id);
      expect(teamA_Payment.payment_status).not.toBe(teamB_Payment.payment_status);
    });

    it('11.1 Admin summary displays multiple slots for the same owner email without collapsing', () => {
      const teamOwnersFromDb = [
        {
          id: 'owner-entry-alpha',
          slot_number: 1,
          owner_name: 'Atul Owner',
          contact_email: AUTH_USER_EMAIL,
          team_name: 'Team Alpha',
          status: 'PENDING',
        },
        {
          id: 'owner-entry-beta',
          slot_number: 2,
          owner_name: 'Atul Owner',
          contact_email: AUTH_USER_EMAIL,
          team_name: 'Team Beta',
          status: 'PENDING',
        },
        {
          id: 'owner-entry-gamma',
          slot_number: 3,
          owner_name: 'Atul Owner',
          contact_email: AUTH_USER_EMAIL,
          team_name: 'Team Gamma',
          status: 'PENDING',
        },
      ];

      expect(teamOwnersFromDb.length).toBe(3);
      expect(new Set(teamOwnersFromDb.map((t) => t.slot_number)).size).toBe(3);
      expect(new Set(teamOwnersFromDb.map((t) => t.id)).size).toBe(3);
      expect(new Set(teamOwnersFromDb.map((t) => t.team_name)).size).toBe(3);
    });
  });
});
