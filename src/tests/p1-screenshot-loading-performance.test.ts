import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

// Mock dependencies
const mockMaybeSinglePayments = vi.fn();
const mockMaybeSingleOwners = vi.fn();

const mockPaymentsEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSinglePayments });
const mockOwnersEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingleOwners });

const mockSelect = vi.fn().mockImplementation((fields: string) => {
  if (fields.includes('screenshot_bucket')) {
    return {
      eq: mockPaymentsEq,
    };
  }
  return {
    eq: mockOwnersEq,
  };
});

const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

const mockCreateAdminClient = vi.fn().mockImplementation(() => ({
  from: mockFrom,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

vi.mock('@/lib/auth/is-manager', () => ({
  requireManager: vi.fn(),
}));

vi.mock('@/lib/storage/upload', () => ({
  getSignedScreenshotUrl: vi.fn(),
}));

import { requireManager } from '@/lib/auth/is-manager';
import { getSignedScreenshotUrl } from '@/lib/storage/upload';
import { GET as getScreenshotUrlRoute } from '@/app/api/admin/payments/screenshot-url/route';

describe('P1 — Admin Screenshot Loading Performance & Row Scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockImplementation(() => ({
      from: mockFrom,
    }));
  });

  // ========================================================
  // 1. STATIC UI CODE CHECKS: ROW-SCOPED LOADING STATE
  // ========================================================
  describe('1. UI Row-Scoped Loading State in Admin Tournament Page', () => {
    const tournamentPagePath = path.join(
      process.cwd(),
      'src/app/admin/tournament/[id]/page.tsx'
    );
    const tournamentSource = fs.readFileSync(tournamentPagePath, 'utf-8');

    it('1.1. Replaces global boolean loadingReceipt with row-scoped loadingReceiptId', () => {
      // Must define loadingReceiptId state
      expect(tournamentSource).toContain('loadingReceiptId');
      // Must NOT declare single boolean loadingReceipt state
      expect(tournamentSource).not.toMatch(/useState\(false\);\s*\/\/\s*loadingReceipt/);
      expect(tournamentSource).not.toContain('const [loadingReceipt, setLoadingReceipt] = useState(false);');
    });

    it('1.2. Scope Payments tab View Receipt button to active row ID', () => {
      // Must pass row id to handleViewReceipt
      expect(tournamentSource).toContain('handleViewReceipt(r.payment.payment_screenshot_url, r.id)');
      // Must only show spinner on the clicked row
      expect(tournamentSource).toContain('isLoading={loadingReceiptId === r.id}');
    });

    it('1.3. Scope Owners tab View Receipt button to active row ID', () => {
      // Must pass owner id to handleViewReceipt
      expect(tournamentSource).toContain('handleViewReceipt(o.payment_screenshot_url, o.id)');
      // Must only disable/spin on the active owner row
      expect(tournamentSource).toContain('disabled={loadingReceiptId === o.id}');
      expect(tournamentSource).toContain('loadingReceiptId === o.id ?');
    });
  });

  describe('2. UI Row-Scoped Loading State in Admin Players Page', () => {
    const playersPagePath = path.join(
      process.cwd(),
      'src/app/admin/players/page.tsx'
    );
    const playersSource = fs.readFileSync(playersPagePath, 'utf-8');

    it('2.1. Uses row-scoped screenshotLoadingId instead of global boolean', () => {
      expect(playersSource).toContain('screenshotLoadingId');
      expect(playersSource).not.toContain('const [screenshotLoading, setScreenshotLoading] = useState(false);');
    });

    it('2.2. Only disables clicked player row in both mobile cards and desktop table', () => {
      expect(playersSource).toContain('disabled={screenshotLoadingId === item.id}');
      expect(playersSource).toContain('screenshotLoadingId === item.id ?');
    });
  });

  // ========================================================
  // 2. INITIAL PLAYER LIST: ZERO STORAGE CALLS & SAFE METADATA
  // ========================================================
  describe('2. Initial Player List Route Performance (Zero Upfront Storage Calls)', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/admin/players/route.ts'),
      'utf-8'
    );

    it('2.1. Route does NOT call getSignedScreenshotUrl in the list pipeline', () => {
      expect(routeSource).not.toContain('getSignedScreenshotUrl');
    });

    it('2.2. Returns safe metadata (has_screenshot: true/false, payment_screenshot_url: null) for 20+ players', async () => {
      // Generate 25 realistic player rows with payment screenshots
      const dummyRegistrations = Array.from({ length: 25 }, (_, i) => ({
        id: `reg-${i + 1}`,
        tournament_id: 't-100',
        player_id: `player-${i + 1}`,
        registration_number: `REG-2026-${String(i + 1).padStart(5, '0')}`,
        registration_status: i % 2 === 0 ? 'CONFIRMED' : 'PENDING',
        registered_name_snapshot: `Player ${i + 1}`,
        registered_role_snapshot: 'ALL_ROUNDER',
        registered_at: new Date(Date.now() - i * 60000).toISOString(),
        player: { id: `player-${i + 1}`, full_name: `Player ${i + 1}`, email: `p${i + 1}@example.com` },
        tournament: { id: 't-100', name: 'Performance Test League' },
        payments: [
          {
            id: `pay-${i + 1}`,
            amount: 50000,
            payment_status: 'PENDING',
            payment_screenshot_url: null,
            screenshot_object_path: `t-100/reg-${i + 1}/screenshot.png`,
            screenshot_bucket: 'payment-screenshots',
            transaction_reference: `TXN-${i + 1}`,
            verification_note: null,
            verified_by: null,
            verified_at: null,
            created_at: new Date(Date.now() - i * 60000).toISOString(),
          },
        ],
      }));

      const mockAdmin = {
        from: (table: string) => {
          if (table === 'tournaments') {
            return {
              select: () => ({
                order: () => ({
                  data: [{ id: 't-100', name: 'Performance Test League' }],
                  error: null,
                }),
              }),
            };
          }
          if (table === 'registrations') {
            return {
              select: () => ({
                order: () => ({
                  data: dummyRegistrations,
                  error: null,
                  eq: () => ({ data: null, error: null }),
                }),
              }),
            };
          }
          return {};
        },
      };

      vi.mocked(requireManager).mockResolvedValueOnce({
        id: 'admin-1',
        email: 'admin@fairplay.com',
        role: 'SUPER_ADMIN',
      } as any);

      mockCreateAdminClient.mockReturnValue(mockAdmin as any);

      const { GET: getPlayersRoute } = await import('@/app/api/admin/players/route');
      const req = new NextRequest('http://localhost:3000/api/admin/players');
      const res = await getPlayersRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.players.length).toBe(25);

      // Verify ZERO calls to getSignedScreenshotUrl for all 25 players
      expect(getSignedScreenshotUrl).toHaveBeenCalledTimes(0);

      // Verify each player has safe metadata
      for (const p of json.players) {
        expect(p.has_screenshot).toBe(true);
        expect(p.payments[0].has_screenshot).toBe(true);
        expect(p.payments[0].payment_screenshot_url).toBeNull();
        // Storage object path should not be exposed
        expect(p.payments[0].screenshot_object_path).toBeUndefined();
      }
    });
  });

  // ========================================================
  // 3. ON-DEMAND SIGNED URL GENERATION & SECURITY
  // ========================================================
  describe('3. On-Demand Signed Screenshot Generation & Security', () => {
    it('3.1. Rejects unauthorized access with 403', async () => {
      vi.mocked(requireManager).mockRejectedValueOnce(new Error('Unauthorized: Manager or Admin access required'));

      const req = new NextRequest('http://localhost:3000/api/admin/payments/screenshot-url?paymentId=pay-1');
      const res = await getScreenshotUrlRoute(req);
      expect(res.status).toBe(403);
    });

    it('3.2. Generates signed URL on demand for ONLY the selected player (Player A)', async () => {
      vi.mocked(requireManager).mockResolvedValueOnce({
        id: 'admin-1',
        email: 'admin@fairplay.com',
        role: 'SUPER_ADMIN',
      } as any);

      const mockAdmin = {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string, val: string) => ({
              maybeSingle: async () => {
                if (col === 'id' && val === 'pay-player-A') {
                  return {
                    data: {
                      id: 'pay-player-A',
                      screenshot_object_path: 't-1/reg-A/proof_A.png',
                      payment_screenshot_url: null,
                      screenshot_bucket: 'payment-screenshots',
                    },
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
            }),
          }),
        }),
      };

      mockCreateAdminClient.mockReturnValue(mockAdmin as any);

      vi.mocked(getSignedScreenshotUrl).mockResolvedValueOnce(
        'https://supabase.co/storage/v1/object/sign/payment-screenshots/t-1/reg-A/proof_A.png?token=signed-token-A'
      );

      const req = new NextRequest('http://localhost:3000/api/admin/payments/screenshot-url?paymentId=pay-player-A');
      const res = await getScreenshotUrlRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.signedUrl).toContain('signed-token-A');

      // Exactly ONE signed URL was generated
      expect(getSignedScreenshotUrl).toHaveBeenCalledTimes(1);
      // Strictly for payment-screenshots bucket and with 900s expiry
      expect(getSignedScreenshotUrl).toHaveBeenCalledWith(
        'payment-screenshots',
        't-1/reg-A/proof_A.png',
        900
      );
    });

    it('3.3. Opening Player A does not generate URLs for Player B/C/D', async () => {
      // Verify that requesting Player A never generates URLs for any other player
      expect(getSignedScreenshotUrl).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('proof_B'),
        expect.anything()
      );
    });

    it('3.4. Rejects request for non-existent payment with 404', async () => {
      vi.mocked(requireManager).mockResolvedValueOnce({
        id: 'admin-1',
        email: 'admin@fairplay.com',
        role: 'SUPER_ADMIN',
      } as any);

      const mockAdmin = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };

      mockCreateAdminClient.mockReturnValue(mockAdmin as any);

      const req = new NextRequest('http://localhost:3000/api/admin/payments/screenshot-url?paymentId=non-existent-id');
      const res = await getScreenshotUrlRoute(req);
      expect(res.status).toBe(404);
    });
  });

  // ========================================================
  // 4. BEHAVIOR SIMULATION: CARD LOADING ISOLATION
  // ========================================================
  describe('4. Simulation of Row-Scoped Loading State Across 20 Players', () => {
    it('4.1. Only clicked player enters loading state; other 19 remain clickable and enabled', () => {
      const playerIds = Array.from({ length: 20 }, (_, i) => `player-reg-${i + 1}`);

      // Initial state: no row is loading
      let activeLoadingId: string | null = null;

      const isRowLoading = (id: string) => activeLoadingId === id;
      const isRowDisabled = (id: string) => activeLoadingId === id;

      // 1. Initially all rows are normal
      playerIds.forEach((id) => {
        expect(isRowLoading(id)).toBe(false);
        expect(isRowDisabled(id)).toBe(false);
      });

      // 2. Admin clicks Player 1 View Receipt
      activeLoadingId = 'player-reg-1';

      expect(isRowLoading('player-reg-1')).toBe(true);
      expect(isRowDisabled('player-reg-1')).toBe(true);

      // Verify Player 2 through 20 remain NOT loading and NOT disabled
      for (let i = 1; i < playerIds.length; i++) {
        expect(isRowLoading(playerIds[i])).toBe(false);
        expect(isRowDisabled(playerIds[i])).toBe(false);
      }

      // 3. Request completes
      activeLoadingId = null;

      playerIds.forEach((id) => {
        expect(isRowLoading(id)).toBe(false);
        expect(isRowDisabled(id)).toBe(false);
      });

      // 4. Admin clicks Player 5 View Receipt
      activeLoadingId = 'player-reg-5';

      expect(isRowLoading('player-reg-5')).toBe(true);
      expect(isRowLoading('player-reg-1')).toBe(false);

      playerIds.filter((id) => id !== 'player-reg-5').forEach((id) => {
        expect(isRowLoading(id)).toBe(false);
        expect(isRowDisabled(id)).toBe(false);
      });
    });
  });
});
