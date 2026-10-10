import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getMyRegistrationsApi } from '@/app/api/registrations/my/route';
import { GET as getRegistrationByIdApi } from '@/app/api/registrations/[id]/route';
import { computeDerivedRegistrationStatus } from '@/lib/utils/derived-status';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkIsAdmin } from '@/lib/auth/is-admin';
import { getSignedScreenshotUrl } from '@/lib/storage/upload';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/is-admin', () => ({ checkIsAdmin: vi.fn() }));
vi.mock('@/lib/storage/upload', () => ({
  getSignedScreenshotUrl: vi.fn(async (_bucket: string, path: string) => `https://signed.fairplay.test/${path}`),
}));

describe('Phase 1 — Player Post-Submission Redirect & My Registration Details', () => {
  let mockAuthUser: any;
  let mockDbRegistrations: any[];
  let mockDbPayments: any[];
  let mockDbPlayers: any[];
  let mockDbTournaments: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthUser = { id: 'auth-user-player-1', email: 'rohit@example.com' };

    mockDbPlayers = [
      {
        id: 'player-uuid-1',
        auth_user_id: 'auth-user-player-1',
        email: 'rohit@example.com',
        full_name: 'Rohit Sharma',
        cricket_role: 'BATSMAN',
        batting_style: 'RIGHT_HAND',
        bowling_style: 'RIGHT_ARM_OFF_BREAK',
        jersey_name: 'ROHIT',
        jersey_number: '45',
        jersey_size: 'L',
      },
      {
        id: 'player-uuid-victim',
        auth_user_id: 'auth-user-victim',
        email: 'victim@example.com',
        full_name: 'Victim Player',
      },
    ];

    mockDbTournaments = [
      {
        id: 'tournament-uuid-1',
        name: 'FairPlay Premier League 2026',
        tournament_date: '2026-11-20T10:00:00Z',
        registration_fee: 90000,
        payment_enabled: true,
        upi_id: 'titusalex786@okaxis',
        payment_qr_url: 'https://cdn.fairplay.test/qr.png',
      },
    ];

    mockDbRegistrations = [
      {
        id: 'reg-uuid-1',
        tournament_id: 'tournament-uuid-1',
        player_id: 'player-uuid-1',
        registration_number: 'REG-2026-ROHIT',
        registration_status: 'PENDING',
        registration_type: 'PLAYER',
        registered_name_snapshot: 'Rohit Sharma',
        registered_role_snapshot: 'BATSMAN',
        registered_batting_style_snapshot: 'RIGHT_HAND',
        registered_bowling_style_snapshot: 'RIGHT_ARM_OFF_BREAK',
        registered_jersey_name_snapshot: 'ROHIT',
        registered_jersey_number_snapshot: '45',
        registered_jersey_size_snapshot: 'L',
        registered_image_snapshot: 'https://images.fairplay.test/rohit.jpg',
        registered_at: '2026-10-10T08:00:00Z',
        created_by_auth_id: 'auth-user-player-1',
        admin_remarks: null,
      },
      {
        id: 'reg-uuid-victim',
        tournament_id: 'tournament-uuid-1',
        player_id: 'player-uuid-victim',
        registration_number: 'REG-2026-VICTIM',
        registration_status: 'CONFIRMED',
        registration_type: 'PLAYER',
        registered_name_snapshot: 'Victim Player',
        registered_role_snapshot: 'BOWLER',
        registered_batting_style_snapshot: 'LEFT_HAND',
        registered_bowling_style_snapshot: 'LEFT_ARM_FAST',
        registered_jersey_name_snapshot: 'VICTIM',
        registered_jersey_number_snapshot: '99',
        registered_jersey_size_snapshot: 'XL',
        registered_image_snapshot: 'https://images.fairplay.test/victim.jpg',
        registered_at: '2026-10-10T09:00:00Z',
        created_by_auth_id: 'auth-user-victim',
        admin_remarks: null,
      },
    ];

    mockDbPayments = [
      {
        id: 'pay-uuid-1',
        registration_id: 'reg-uuid-1',
        amount: 90000,
        payment_method: 'UPI_QR',
        payment_status: 'PENDING',
        transaction_reference: 'UPI425612345678',
        screenshot_bucket: 'payment-screenshots',
        screenshot_object_path: 'tournament-uuid-1/reg-uuid-1/receipt.png',
        created_at: '2026-10-10T08:05:00Z',
      },
      {
        id: 'pay-uuid-victim',
        registration_id: 'reg-uuid-victim',
        amount: 90000,
        payment_method: 'UPI_QR',
        payment_status: 'SUCCESSFUL',
        transaction_reference: 'UPI999999999999',
        screenshot_bucket: 'payment-screenshots',
        screenshot_object_path: 'tournament-uuid-1/reg-uuid-victim/receipt.png',
        created_at: '2026-10-10T09:05:00Z',
      },
    ];

    (createServerSupabaseClient as any).mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => {
          if (!mockAuthUser) return { data: { user: null }, error: new Error('Unauthorized') };
          return { data: { user: mockAuthUser }, error: null };
        }),
      },
    });

    (checkIsAdmin as any).mockResolvedValue({ isAdmin: false, isManager: false });

    (createAdminClient as any).mockReturnValue({
      from: vi.fn((table: string) => {
        let filterCol: string | null = null;
        let filterVal: any = null;
        let orFilter: string | null = null;
        let inVals: any[] | null = null;

        const queryObj: any = {
          select: vi.fn(() => queryObj),
          eq: vi.fn((col: string, val: any) => {
            filterCol = col;
            filterVal = val;
            return queryObj;
          }),
          or: vi.fn((clause: string) => {
            orFilter = clause;
            return queryObj;
          }),
          in: vi.fn((col: string, vals: any[]) => {
            filterCol = col;
            inVals = vals;
            return queryObj;
          }),
          order: vi.fn(() => queryObj),
          limit: vi.fn(() => queryObj),
          maybeSingle: vi.fn(async () => {
            if (table === 'players') {
              const match = mockDbPlayers.find((p) => p[filterCol!] === filterVal);
              return { data: match || null, error: null };
            }
            if (table === 'tournaments') {
              const match = mockDbTournaments.find((t) => t[filterCol!] === filterVal);
              return { data: match || null, error: null };
            }
            if (table === 'registrations') {
              const match = mockDbRegistrations.find(
                (r) => r.id === filterVal || r.registration_number === filterVal
              );
              if (match) {
                const playerMatch = mockDbPlayers.find((p) => p.id === match.player_id);
                return { data: { ...match, player: playerMatch }, error: null };
              }
              return { data: null, error: null };
            }
            if (table === 'payments') {
              const match = mockDbPayments.find((p) => p[filterCol!] === filterVal);
              return { data: match || null, error: null };
            }
            if (table === 'team_owners') {
              return { data: null, error: null };
            }
            return { data: null, error: null };
          }),
          then: (resolve: any) => {
            if (table === 'registrations') {
              let rows = [...mockDbRegistrations];
              if (orFilter) {
                rows = rows.filter(
                  (r) =>
                    r.created_by_auth_id === mockAuthUser?.id ||
                    r.player_id === 'player-uuid-1'
                );
              } else if (filterCol) {
                rows = rows.filter((r) => r[filterCol!] === filterVal);
              }
              const mapped = rows.map((r) => {
                const p = mockDbPlayers.find((pl) => pl.id === r.player_id);
                const t = mockDbTournaments.find((tm) => tm.id === r.tournament_id);
                return { ...r, player: p, tournament: t };
              });
              resolve({ data: mapped, error: null });
            } else if (table === 'payments') {
              let rows = [...mockDbPayments];
              if (inVals) {
                rows = rows.filter((p) => inVals!.includes(p.registration_id));
              }
              resolve({ data: rows, error: null });
            } else {
              resolve({ data: [], error: null });
            }
          },
        };
        return queryObj;
      }),
    });
  });

  // =========================================================================
  // 1. GET /api/registrations/my Security & Integrity Tests
  // =========================================================================
  describe('GET /api/registrations/my', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockAuthUser = null;
      const res = await getMyRegistrationsApi();
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Authentication required');
    });

    it('returns only the authenticated player registrations, never leaking other users', async () => {
      const res = await getMyRegistrationsApi();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.registrations).toHaveLength(1);
      expect(json.registrations[0].registration_number).toBe('REG-2026-ROHIT');
      expect(json.registrations[0].registered_name_snapshot).toBe('Rohit Sharma');
      // Verify victim registration is NOT present
      const victim = json.registrations.find((r: any) => r.registration_number === 'REG-2026-VICTIM');
      expect(victim).toBeUndefined();
    });

    it('returns full historical snapshots including Jersey Name, Number, Size, and Cricket attributes', async () => {
      const res = await getMyRegistrationsApi();
      const json = await res.json();
      const reg = json.registrations[0];

      expect(reg.registered_jersey_name_snapshot).toBe('ROHIT');
      expect(reg.registered_jersey_number_snapshot).toBe('45');
      expect(reg.registered_jersey_size_snapshot).toBe('L');
      expect(reg.registered_role_snapshot).toBe('BATSMAN');
      expect(reg.registered_batting_style_snapshot).toBe('RIGHT_HAND');
      expect(reg.registered_bowling_style_snapshot).toBe('RIGHT_ARM_OFF_BREAK');
      expect(reg.registered_image_snapshot).toBe('https://images.fairplay.test/rohit.jpg');
    });

    it('resolves signed screenshot URL for private payment receipts', async () => {
      const res = await getMyRegistrationsApi();
      const json = await res.json();
      const reg = json.registrations[0];

      expect(reg.payment).toBeDefined();
      expect(reg.payment.transaction_reference).toBe('UPI425612345678');
      expect(reg.payment.payment_status).toBe('PENDING');
      expect(reg.payment.payment_screenshot_url).toBe(
        'https://signed.fairplay.test/tournament-uuid-1/reg-uuid-1/receipt.png'
      );
      expect(getSignedScreenshotUrl).toHaveBeenCalledWith(
        'payment-screenshots',
        'tournament-uuid-1/reg-uuid-1/receipt.png',
        1800
      );
    });
  });

  // =========================================================================
  // 2. GET /api/registrations/[id] Security & Ownership Tests
  // =========================================================================
  describe('GET /api/registrations/[id]', () => {
    it('returns 401 when request is unauthenticated', async () => {
      mockAuthUser = null;
      const req = new NextRequest('http://localhost/api/registrations/reg-uuid-1');
      const res = await getRegistrationByIdApi(req, { params: Promise.resolve({ id: 'reg-uuid-1' }) });
      expect(res.status).toBe(401);
    });

    it('returns 404 when registration does not exist (no fallback leakage of other registrations)', async () => {
      const req = new NextRequest('http://localhost/api/registrations/non-existent-uuid');
      const res = await getRegistrationByIdApi(req, {
        params: Promise.resolve({ id: 'non-existent-uuid' }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('Registration record not found');
    });

    it('blocks unauthorized access with 403 when user attempts to view another player registration', async () => {
      // Authenticated user is player 1, attempting to access victim registration
      const req = new NextRequest('http://localhost/api/registrations/reg-uuid-victim');
      const res = await getRegistrationByIdApi(req, {
        params: Promise.resolve({ id: 'reg-uuid-victim' }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('You are not authorized to view this registration');
    });

    it('allows player to view their own registration by UUID or registration_number', async () => {
      const req = new NextRequest('http://localhost/api/registrations/reg-uuid-1');
      const res = await getRegistrationByIdApi(req, { params: Promise.resolve({ id: 'reg-uuid-1' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.registration.registration_number).toBe('REG-2026-ROHIT');
      expect(json.registration.registered_jersey_name_snapshot).toBe('ROHIT');
      expect(json.registration.registered_jersey_number_snapshot).toBe('45');
    });

    it('allows DB admin to view any registration', async () => {
      (checkIsAdmin as any).mockResolvedValue({ isAdmin: true, isManager: false });
      const req = new NextRequest('http://localhost/api/registrations/reg-uuid-victim');
      const res = await getRegistrationByIdApi(req, {
        params: Promise.resolve({ id: 'reg-uuid-victim' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.registration.registration_number).toBe('REG-2026-VICTIM');
    });
  });

  // =========================================================================
  // 3. Derived Registration Status Logic Acceptance Tests
  // =========================================================================
  describe('Derived Registration Status Specifications', () => {
    it('CORRECTION_REQUIRED: returns Correction Required with warning badge', () => {
      const status = computeDerivedRegistrationStatus(
        { registration_status: 'CORRECTION_REQUESTED' },
        { payment_status: 'PENDING' },
        { payment_enabled: true, registration_fee: 90000 }
      );
      expect(status.key).toBe('CORRECTION_REQUIRED');
      expect(status.label).toBe('Correction Required');
      expect(status.badgeVariant).toBe('warning');
    });

    it('CONFIRMED: only returns confirmed when registration is CONFIRMED and payment is SUCCESSFUL', () => {
      const status = computeDerivedRegistrationStatus(
        { registration_status: 'CONFIRMED' },
        { payment_status: 'SUCCESSFUL' },
        { payment_enabled: true, registration_fee: 90000 }
      );
      expect(status.key).toBe('CONFIRMED');
      expect(status.label).toBe('Registration Confirmed');
      expect(status.badgeVariant).toBe('success');
    });

    it('PENDING payment NEVER incorrectly shows CONFIRMED even if registration is CONFIRMED', () => {
      const status = computeDerivedRegistrationStatus(
        { registration_status: 'CONFIRMED' },
        { payment_status: 'PENDING' },
        { payment_enabled: true, registration_fee: 90000 }
      );
      expect(status.key).toBe('PAYMENT_PENDING');
      expect(status.label).toBe('Payment Verification Pending');
      expect(status.badgeVariant).toBe('warning');
    });

    it('REJECTED: returns Registration Rejected when status is REJECTED or FAILED', () => {
      const status = computeDerivedRegistrationStatus(
        { registration_status: 'REJECTED' },
        { payment_status: 'FAILED' }
      );
      expect(status.key).toBe('REJECTED');
      expect(status.label).toBe('Registration Rejected');
      expect(status.badgeVariant).toBe('danger');
    });

    it('WAITLISTED: returns Waitlisted with waitlist position', () => {
      const status = computeDerivedRegistrationStatus(
        { registration_status: 'WAITING_LIST', waitlist_position: 4 },
        { payment_status: 'PENDING' }
      );
      expect(status.key).toBe('WAITLISTED');
      expect(status.label).toBe('Waitlisted');
      expect(status.description).toContain('Waitlist Position #4');
    });
  });
});
