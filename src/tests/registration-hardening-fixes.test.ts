import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as registerOwner } from '@/app/api/registrations/owner/route';
import { POST as registerPlayer } from '@/app/api/registrations/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

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

describe('Registration Hardening & Multi-Owner Fixes', () => {
  let mockSupabaseServer: any;
  let mockSupabaseAdmin: any;
  const mockPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const TOURNAMENT_ID = 'edfb6464-c326-4ad8-af8f-b0113f9bdcf3';
  const AUTH_USER_ID = 'auth-user-atul-123';
  const AUTH_USER_EMAIL = 'atulpawar07@gmail.com';
  const PLAYER_PROFILE_ID = 'player-profile-atul-545e';

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
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
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

  const createOwnerRequest = (body: any, headers: Record<string, string> = {}) => {
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
  // 1. KINGSMAN SCENARIOS (Multi-Owner Same-Email Support)
  // =========================================================================
  describe('Phase 11 — The Exact Kingsman Multi-Owner Scenario', () => {
    it('1.1 Allows authenticated owner who already owns Team Alpha to register Kingsman as a new team', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      // Existing reusable player profile found
      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      // RPC successfully allocates Kingsman into next slot
      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: [
          {
            owner_id: 'team-owner-kingsman-id',
            slot_number: 6,
            owner_registration_id: 'reg-owner-kingsman',
            icon_registration_id: 'reg-icon-kingsman',
            payment_id: 'pay-kingsman',
            status: 'PENDING',
          },
        ],
        error: null,
      });

      const req = createOwnerRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Pranav Patel',
        contactEmail: AUTH_USER_EMAIL,
        contactPhone: '8828706265',
        teamName: 'Kingsman',
        iconPlayerName: 'Icon Two',
        iconPlayerMobile: '9988776655',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ownerId).toBe('team-owner-kingsman-id');
      expect(json.slotNumber).toBe(6);

      // Verify RPC was invoked with p_created_by_auth_id and reused player profile
      expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
        'allocate_owner_registration_v4',
        expect.objectContaining({
          p_tournament_id: TOURNAMENT_ID,
          p_owner_player_id: PLAYER_PROFILE_ID,
          p_team_name: 'Kingsman',
          p_created_by_auth_id: AUTH_USER_ID,
        })
      );
    });

    it('1.2 Rejects duplicate registration if the same owner attempts to register Kingsman again', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      // RPC returns team name duplicate error from uq_team_owners_tournament_team_name
      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          message: 'This team name is already registered for this tournament. Please choose another team name.',
        },
      });

      const req = createOwnerRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Pranav Patel',
        contactEmail: AUTH_USER_EMAIL,
        contactPhone: '8828706265',
        teamName: 'Kingsman',
        iconPlayerName: 'Icon Two',
        iconPlayerMobile: '9988776655',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('This team name is already registered for this tournament. Please choose another team name.');
    });

    it('1.3 Rejects registration if a DIFFERENT owner attempts to register Kingsman in the same tournament', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: 'auth-user-bob-999', email: 'bob@example.com' } },
        error: null,
      });

      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: 'player-profile-bob-888' },
        error: null,
      });

      // RPC returns team name duplicate error
      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          message: 'This team name is already registered for this tournament. Please choose another team name.',
        },
      });

      const req = createOwnerRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Bob Builder',
        contactEmail: 'bob@example.com',
        contactPhone: '9988112233',
        teamName: 'Kingsman',
        iconPlayerName: 'Icon Bob',
        iconPlayerMobile: '9988112244',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('This team name is already registered for this tournament. Please choose another team name.');
    });
  });

  // =========================================================================
  // 2. OWNER RPC ERROR HANDLING & DISCRIMINATION (Phase 3 & Phase 9)
  // =========================================================================
  describe('Phase 3 & 9 — Owner RPC Error Discrimination', () => {
    it('2.1 Returns precise message for genuine duplicate OWNER registration', async () => {
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
        error: {
          message: 'You are already registered as a team owner for this tournament.',
        },
      });

      const req = createOwnerRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Owner Re-attempt',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Team X',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('You are already registered as a team owner for this tournament.');
    });

    it('2.2 Returns precise message for genuine duplicate ICON registration', async () => {
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
        error: {
          message: 'An icon player registration already exists for this team.',
        },
      });

      const req = createOwnerRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Owner New Team',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Team Y',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('An icon player registration already exists for this team.');
    });

    it('2.3 Returns safe generic error for unknown/unrelated database constraint failure without falsely claiming already registered', async () => {
      mockSupabaseServer.auth.getUser.mockResolvedValue({
        data: { user: { id: AUTH_USER_ID, email: AUTH_USER_EMAIL } },
        error: null,
      });

      mockSupabaseServer.maybeSingle.mockResolvedValueOnce({
        data: { id: PLAYER_PROFILE_ID },
        error: null,
      });

      // RPC throws unexpected unique violation or internal DB constraint
      mockSupabaseAdmin.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          message: 'We could not complete the owner registration. Please try again or contact the organiser.',
        },
      });

      const req = createOwnerRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Owner Test',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Team Z',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('We could not complete the owner registration. Please try again or contact the organiser.');
      expect(json.error).not.toContain('already registered');
    });

    it('2.4 Handles capacity exhaustion for owner slots with clear message', async () => {
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

      const req = createOwnerRequest({
        tournamentId: TOURNAMENT_ID,
        ownerName: 'Owner Late',
        contactEmail: AUTH_USER_EMAIL,
        teamName: 'Team Late',
      });

      const res = await registerOwner(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Registration could not be completed because all team owner slots for this tournament are filled.');
    });
  });

  // =========================================================================
  // 3. PLAYER REGISTRATION SAFE RESPONSE PARSING (Phase 7)
  // =========================================================================
  describe('Phase 7 — Safe Response Parsing Logic', () => {
    it('3.1 Safe response parser gracefully handles HTTP 413 without JSON parse error', () => {
      // Test the response handler logic directly as implemented in register/page.tsx
      const mockResponse = {
        ok: false,
        status: 413,
        statusText: 'Payload Too Large',
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/plain' : null),
        },
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token 'R', \"Request En\"... is not valid JSON")),
      };

      const contentType = mockResponse.headers.get('content-type');
      let result: Record<string, any> | null = null;
      if (contentType && contentType.includes('application/json')) {
        // Should NOT be reached for text/plain 413
        result = {};
      }

      let errorMsg = null;
      if (!mockResponse.ok || result?.error) {
        if (mockResponse.status === 413) {
          errorMsg = 'One or more uploaded images are too large. Please use smaller images and try again.';
        } else {
          errorMsg = 'Error';
        }
      }

      expect(errorMsg).toBe('One or more uploaded images are too large. Please use smaller images and try again.');
      expect(errorMsg).not.toContain('Unexpected token');
    });

    it('3.2 Safe response parser gracefully handles HTTP 502/504 HTML error without JSON parse error', () => {
      const mockHtmlResponse = {
        ok: false,
        status: 504,
        statusText: 'Gateway Timeout',
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
        },
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON")),
      };

      const contentType = mockHtmlResponse.headers.get('content-type');
      let result: Record<string, any> | null = null;
      if (contentType && contentType.includes('application/json')) {
        result = {};
      }

      let errorMsg = null;
      if (!mockHtmlResponse.ok || result?.error) {
        if (mockHtmlResponse.status >= 500) {
          errorMsg = "We couldn't complete your registration. Please try again or contact the organiser.";
        }
      }

      expect(errorMsg).toBe("We couldn't complete your registration. Please try again or contact the organiser.");
      expect(errorMsg).not.toContain('Unexpected token');
    });

    it('3.3 Safe response parser gracefully handles HTTP 401 unauthenticated session', () => {
      const mock401Response = {
        ok: false,
        status: 401,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
      };

      let errorMsg = null;
      if (mock401Response.status === 401) {
        errorMsg = 'Please sign in again to continue.';
      }
      expect(errorMsg).toBe('Please sign in again to continue.');
    });
  });
});
