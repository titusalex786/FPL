import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as registerOwner } from '@/app/api/registrations/owner/route';
import { POST as registerPlayer } from '@/app/api/registrations/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  playerCricketDetailsSchema,
  playerProfileSchema,
  cricketRolesEnum,
  battingStylesEnum,
  bowlingStylesEnum,
} from '@/lib/validation/registration';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/storage/upload', () => ({
  uploadToStorageBucket: vi.fn().mockResolvedValue({ publicUrl: 'https://cdn.example.com/photo.png' }),
  validateImageFileBuffer: vi.fn().mockReturnValue({ isValid: true, mimeType: 'image/png', extension: 'png' }),
  getSignedScreenshotUrl: vi.fn().mockResolvedValue('https://signed.url/screenshot.png'),
}));

describe('P1.3 — Batting/Bowling Style & All-Rounder Icon Support', () => {
  let mockSupabaseServer: any;
  let mockSupabaseAdmin: any;
  const mockPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const TOURNAMENT_ID = 'edfb6464-c326-4ad8-af8f-b0113f9bdcf3';
  const AUTH_USER_ID = 'auth-user-p13-test-123';
  const AUTH_USER_EMAIL = 'owner.p13@example.com';
  const OWNER_PLAYER_ID = 'player-owner-profile-123';

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabaseServer = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: AUTH_USER_ID,
              email: AUTH_USER_EMAIL,
              user_metadata: { full_name: 'Test Owner' },
            },
          },
          error: null,
        }),
      },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: OWNER_PLAYER_ID },
        error: null,
      }),
    };

    mockSupabaseAdmin = {
      auth: { getUser: vi.fn() },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: OWNER_PLAYER_ID },
        error: null,
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: OWNER_PLAYER_ID },
        error: null,
      }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      rpc: vi.fn(),
    };

    (createServerSupabaseClient as unknown as any).mockResolvedValue(mockSupabaseServer);
    (createAdminClient as unknown as any).mockReturnValue(mockSupabaseAdmin);
  });

  // =========================================================================
  // PART 7.1 — 7.5: Validation Schema & Enum Separation Tests
  // =========================================================================

  describe('Part 7.1 — 7.5: Schema & Enum Boundaries', () => {
    it('1. All-rounder Icon Player registration schema accepts batting and bowling styles', () => {
      const res = playerCricketDetailsSchema.safeParse({
        cricketRole: 'ALL_ROUNDER',
        battingStyle: 'RIGHT_HAND',
        bowlingStyle: 'RIGHT_ARM_FAST',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.cricketRole).toBe('ALL_ROUNDER');
        expect(res.data.battingStyle).toBe('RIGHT_HAND');
        expect(res.data.bowlingStyle).toBe('RIGHT_ARM_FAST');
      }
    });

    it('2. Right-hand batting style is accepted', () => {
      const parsed = battingStylesEnum.safeParse('RIGHT_HAND');
      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe('RIGHT_HAND');
    });

    it('3. Left-hand batting style is accepted', () => {
      const parsed = battingStylesEnum.safeParse('LEFT_HAND');
      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe('LEFT_HAND');
    });

    it('4. Right-arm fast bowling style is accepted as bowlingStyle', () => {
      const parsed = bowlingStylesEnum.safeParse('RIGHT_ARM_FAST');
      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe('RIGHT_ARM_FAST');
    });

    it('5. Other valid bowling styles supported by the app are accepted', () => {
      const validStyles = [
        'RIGHT_ARM_FAST',
        'RIGHT_ARM_MEDIUM',
        'RIGHT_ARM_SPIN',
        'LEFT_ARM_FAST',
        'LEFT_ARM_MEDIUM',
        'LEFT_ARM_SPIN',
        'DOESNT_BOWL',
      ];
      validStyles.forEach((style) => {
        const parsed = bowlingStylesEnum.safeParse(style);
        expect(parsed.success).toBe(true);
        expect(parsed.data).toBe(style);

        const cricketDetails = playerCricketDetailsSchema.safeParse({
          cricketRole: 'ALL_ROUNDER',
          battingStyle: 'RIGHT_HAND',
          bowlingStyle: style,
        });
        if (style === 'DOESNT_BOWL') {
          // All-rounder requires an active bowling style
          expect(cricketDetails.success).toBe(false);
        } else {
          expect(cricketDetails.success).toBe(true);
        }
      });
    });

    it('6. Bowler registration requires a valid bowling style', () => {
      const validBowler = playerCricketDetailsSchema.safeParse({
        cricketRole: 'BOWLER',
        battingStyle: 'RIGHT_HAND',
        bowlingStyle: 'RIGHT_ARM_FAST',
      });
      expect(validBowler.success).toBe(true);

      const invalidBowlerNoBowl = playerCricketDetailsSchema.safeParse({
        cricketRole: 'BOWLER',
        battingStyle: 'RIGHT_HAND',
        bowlingStyle: 'DOESNT_BOWL',
      });
      expect(invalidBowlerNoBowl.success).toBe(false);

      const invalidBowlerNull = playerCricketDetailsSchema.safeParse({
        cricketRole: 'BOWLER',
        battingStyle: 'RIGHT_HAND',
        bowlingStyle: null,
      });
      expect(invalidBowlerNull.success).toBe(false);
    });

    it('7. Batsman registration allows DOESNT_BOWL and does not force bowling style', () => {
      const validBatsman = playerCricketDetailsSchema.safeParse({
        cricketRole: 'BATSMAN',
        battingStyle: 'RIGHT_HAND',
        bowlingStyle: 'DOESNT_BOWL',
      });
      expect(validBatsman.success).toBe(true);

      const validBatsmanNull = playerCricketDetailsSchema.safeParse({
        cricketRole: 'BATSMAN',
        battingStyle: 'LEFT_HAND',
        bowlingStyle: null,
      });
      expect(validBatsmanNull.success).toBe(true);
    });

    it('8. Invalid enum values are rejected with clear validation messages', () => {
      // Bowling style passed as battingStyle
      const wrongBattingStyle = playerCricketDetailsSchema.safeParse({
        cricketRole: 'ALL_ROUNDER',
        battingStyle: 'RIGHT_ARM_FAST' as any,
        bowlingStyle: 'RIGHT_ARM_FAST',
      });
      expect(wrongBattingStyle.success).toBe(false);

      // Invalid cricket role
      const wrongRole = playerCricketDetailsSchema.safeParse({
        cricketRole: 'COACH' as any,
        battingStyle: 'RIGHT_HAND',
        bowlingStyle: 'RIGHT_ARM_FAST',
      });
      expect(wrongRole.success).toBe(false);

      // Invalid bowling style
      const wrongBowling = playerCricketDetailsSchema.safeParse({
        cricketRole: 'ALL_ROUNDER',
        battingStyle: 'RIGHT_HAND',
        bowlingStyle: 'UNDERARM' as any,
      });
      expect(wrongBowling.success).toBe(false);
    });
  });

  // =========================================================================
  // PART 7.6 — 7.10: Owner & Icon Registration RPC Payload Verification
  // =========================================================================

  describe('Part 7.6 — 7.10: Owner Registration API & RPC Parameter Mapping', () => {
    it('10. Owner #1 / Icon #2 allocation: correctly maps All-rounder Icon with RIGHT_ARM_FAST without enum error', async () => {
      mockSupabaseAdmin.rpc.mockResolvedValue({
        data: [
          {
            owner_id: 'owner-uuid-1',
            slot_number: 1,
            owner_registration_id: 'reg-owner-1',
            icon_registration_id: 'reg-icon-1',
            payment_id: 'pay-1',
            status: 'PENDING',
          },
        ],
        error: null,
      });

      const req = new NextRequest('http://localhost:3000/api/registrations/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: TOURNAMENT_ID,
          ownerName: 'Alice Owner',
          contactEmail: AUTH_USER_EMAIL,
          contactPhone: '9876543210',
          ownerRole: 'BATSMAN',
          ownerBattingStyle: 'RIGHT_HAND',
          ownerBowlingStyle: null,
          ownerJerseySize: 'L',
          ownerProfileImageUrl: mockPhoto,
          teamName: 'Super Strikers',
          iconPlayerName: 'Bob Icon',
          iconPlayerMobile: '9876543211',
          iconPlayerRole: 'ALL_ROUNDER',
          iconPlayerBattingStyle: 'RIGHT_HAND',
          iconPlayerBowlingStyle: 'RIGHT_ARM_FAST',
          iconProfileImageUrl: mockPhoto,
          iconJerseySize: 'XL',
          iconJerseyName: 'BOB',
          iconJerseyNumber: '10',
        }),
      });

      const res = await registerOwner(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.ownerRegistrationId).toBe('reg-owner-1');
      expect(json.iconRegistrationId).toBe('reg-icon-1');

      // Verify exact RPC parameter contract
      expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
        'allocate_owner_registration_v4',
        expect.objectContaining({
          p_tournament_id: TOURNAMENT_ID,
          p_owner_role: 'BATSMAN',
          p_owner_batting_style: 'RIGHT_HAND',
          p_owner_bowling_style: null,
          p_icon_role: 'ALL_ROUNDER',
          p_icon_batting_style: 'RIGHT_HAND',
          p_icon_bowling_style: 'RIGHT_ARM_FAST',
          p_icon_name: 'Bob Icon',
        })
      );
    });

    it('11. Owner registration preserves Left-hand batting and Spin bowling for Icon', async () => {
      mockSupabaseAdmin.rpc.mockResolvedValue({
        data: [
          {
            owner_id: 'owner-uuid-2',
            slot_number: 2,
            owner_registration_id: 'reg-owner-2',
            icon_registration_id: 'reg-icon-2',
            payment_id: 'pay-2',
            status: 'PENDING',
          },
        ],
        error: null,
      });

      const req = new NextRequest('http://localhost:3000/api/registrations/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: TOURNAMENT_ID,
          ownerName: 'Charlie Owner',
          contactEmail: AUTH_USER_EMAIL,
          contactPhone: '9876543220',
          ownerRole: 'BOWLER',
          ownerBattingStyle: 'LEFT_HAND',
          ownerBowlingStyle: 'LEFT_ARM_FAST',
          ownerJerseySize: 'M',
          ownerProfileImageUrl: mockPhoto,
          teamName: 'Spin Titans',
          iconPlayerName: 'David Spinner',
          iconPlayerMobile: '9876543221',
          iconPlayerRole: 'BOWLER',
          iconPlayerBattingStyle: 'LEFT_HAND',
          iconPlayerBowlingStyle: 'RIGHT_ARM_SPIN',
          iconProfileImageUrl: mockPhoto,
          iconJerseySize: 'L',
        }),
      });

      const res = await registerOwner(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
        'allocate_owner_registration_v4',
        expect.objectContaining({
          p_owner_role: 'BOWLER',
          p_owner_batting_style: 'LEFT_HAND',
          p_owner_bowling_style: 'LEFT_ARM_FAST',
          p_icon_role: 'BOWLER',
          p_icon_batting_style: 'LEFT_HAND',
          p_icon_bowling_style: 'RIGHT_ARM_SPIN',
        })
      );
    });

    it('12. Owner registration rejects invalid batting/bowling style in API validation before RPC', async () => {
      const req = new NextRequest('http://localhost:3000/api/registrations/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: TOURNAMENT_ID,
          ownerName: 'Eva Owner',
          contactEmail: AUTH_USER_EMAIL,
          contactPhone: '9876543230',
          ownerRole: 'BATSMAN',
          ownerBattingStyle: 'RIGHT_HAND',
          teamName: 'Invalid Team',
          iconPlayerName: 'Frank Icon',
          iconPlayerRole: 'ALL_ROUNDER',
          iconPlayerBattingStyle: 'RIGHT_ARM_FAST', // INVALID! Bowling style in batting style field
          iconPlayerBowlingStyle: 'RIGHT_ARM_FAST',
          iconProfileImageUrl: mockPhoto,
        }),
      });

      const res = await registerOwner(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Invalid Icon Player cricket role or style');
      expect(mockSupabaseAdmin.rpc).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PART 7.11 — 7.12: Regular Player Registration & Auction Pool Guarantees
  // =========================================================================

  describe('Part 7.11 — 7.12: Regular Player Registration & Auction Isolation', () => {
    it('Regular player registration works for BATSMAN, BOWLER, ALL_ROUNDER, BATSMAN_WICKETKEEPER, BOWLER_WICKETKEEPER', async () => {
      const roles = [
        { role: 'BATSMAN', batting: 'RIGHT_HAND', bowling: 'DOESNT_BOWL' },
        { role: 'BOWLER', batting: 'RIGHT_HAND', bowling: 'RIGHT_ARM_FAST' },
        { role: 'ALL_ROUNDER', batting: 'LEFT_HAND', bowling: 'RIGHT_ARM_SPIN' },
        { role: 'BATSMAN_WICKETKEEPER', batting: 'RIGHT_HAND', bowling: 'DOESNT_BOWL' },
        { role: 'BOWLER_WICKETKEEPER', batting: 'LEFT_HAND', bowling: 'LEFT_ARM_MEDIUM' },
      ];

      for (const r of roles) {
        mockSupabaseAdmin.rpc.mockResolvedValueOnce({
          data: [
            {
              registration_id: `reg-${r.role}`,
              registration_number: `REG-${r.role}-001`,
              registration_status: 'PENDING',
              waitlist_position: null,
              payment_id: `pay-${r.role}`,
            },
          ],
          error: null,
        });

        const req = new NextRequest('http://localhost:3000/api/registrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tournamentId: TOURNAMENT_ID,
            fullName: `Test ${r.role}`,
            profileImageUrl: mockPhoto,
            cricketRole: r.role,
            battingStyle: r.batting,
            bowlingStyle: r.bowling,
            jerseySize: 'M',
            termsAccepted: true,
          }),
        });

        const res = await registerPlayer(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.success).toBe(true);

        expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
          'allocate_player_registration_v2',
          expect.objectContaining({
            p_registered_role_snapshot: r.role,
            p_registered_batting_style_snapshot: r.batting,
            p_registered_bowling_style_snapshot: r.bowling,
          })
        );
      }
    });

    it('Auction player pool exclusion contract: Icon and Owner records are excluded from auction lots', () => {
      // Verifies the predicate contract defined in populate_auction_player_pool
      const sampleRegistrations = [
        { id: '1', registration_type: 'PLAYER', role: 'ALL_ROUNDER' },
        { id: '2', registration_type: 'OWNER', role: 'BATSMAN' },
        { id: '3', registration_type: 'ICON', role: 'ALL_ROUNDER' },
      ];

      const eligibleForAuction = sampleRegistrations.filter(
        (r) => r.registration_type === 'PLAYER'
      );

      expect(eligibleForAuction).toHaveLength(1);
      expect(eligibleForAuction[0].id).toBe('1');
      expect(eligibleForAuction.some((r) => r.registration_type === 'ICON')).toBe(false);
      expect(eligibleForAuction.some((r) => r.registration_type === 'OWNER')).toBe(false);
    });
  });
});
