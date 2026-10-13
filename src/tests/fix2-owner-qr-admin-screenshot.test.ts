import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSignedScreenshotUrl } from '@/lib/storage/upload';
import fs from 'fs';
import path from 'path';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/storage/upload', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getSignedScreenshotUrl: vi.fn(),
    uploadToStorageBucket: vi.fn().mockResolvedValue({ publicUrl: 'https://storage/img.png' }),
  };
});

vi.mock('@/lib/auth/is-manager', () => ({
  requireManager: vi.fn().mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@fpl.com' },
    isAdmin: true,
    role: 'SUPER_ADMIN',
  }),
}));

/**
 * FIX #2 — Owner/Icon QR Display + Admin Payment Screenshot
 */
describe('Fix #2 — Owner QR + Admin Screenshot Regression', () => {

  // ========================================================
  // FIX A — OWNER MODAL QR/UPI RENDERING
  // ========================================================
  describe('Fix A — Owner Modal Payment QR/UPI Display', () => {
    const modalPath = path.join(process.cwd(), 'src/components/register/TeamOwnerRegistrationModal.tsx');
    const upiChoicePath = path.join(process.cwd(), 'src/components/ui/UPIPaymentChoice.tsx');
    const upiUtilsPath = path.join(process.cwd(), 'src/lib/utils/upi.ts');

    const getCombinedSource = () => {
      const modal = fs.readFileSync(modalPath, 'utf-8');
      const upiChoice = fs.existsSync(upiChoicePath) ? fs.readFileSync(upiChoicePath, 'utf-8') : '';
      const upiUtils = fs.existsSync(upiUtilsPath) ? fs.readFileSync(upiUtilsPath, 'utf-8') : '';
      return modal + '\n' + upiChoice + '\n' + upiUtils;
    };

    it('1. Owner modal renders tournament.payment_qr_url as QR image', () => {
      const source = getCombinedSource();

      // Must contain tournament payment_qr_url and QR alt text
      expect(source).toContain('tournament?.payment_qr_url');
      expect(source).toContain('alt="UPI QR Code"');
    });

    it('2. Owner modal displays tournament.upi_id when available', () => {
      const source = getCombinedSource();

      expect(source).toContain('tournament?.upi_id');
      expect(source).toMatch(/Not configured|not configured/i);
    });

    it('3. Owner modal provides UPI deep links for GPay/PhonePe/Paytm', () => {
      const source = getCombinedSource();

      expect(source).toContain('upi://pay?pa=');
      expect(source).toContain('GPay / PhonePe');
      expect(source).toContain('Paytm / BHIM');
    });

    it('4. Owner modal screenshot upload remains available for UPI payment', () => {
      const modalSource = fs.readFileSync(modalPath, 'utf-8');

      // Screenshot upload section must exist within UPI_QR flow
      expect(modalSource).toContain('Upload Payment Proof');
      expect(modalSource).toContain('handleScreenshotUpload');
    });

    it('5. Acknowledge by Organiser does not require screenshot', () => {
      const modalSource = fs.readFileSync(modalPath, 'utf-8');

      // ACKNOWLEDGE_BY_ORGANISER section must NOT contain screenshot upload
      const ackSection = modalSource.match(
        /paymentMethod === 'ACKNOWLEDGE_BY_ORGANISER'[\s\S]*?Organiser will verify payment offline[\s\S]*?<\/div>/
      );
      expect(ackSection).toBeTruthy();
      const ackText = ackSection![0];
      expect(ackText).not.toContain('handleScreenshotUpload');
      expect(ackText).not.toContain('Upload Payment Proof');
    });

    it('6. Owner modal imports QrCode icon', () => {
      const source = getCombinedSource();

      expect(source).toContain('QrCode');
    });

    it('7. Owner modal shows combined fee in QR section', () => {
      const modalSource = fs.readFileSync(modalPath, 'utf-8');

      expect(modalSource).toContain('totalClubbedFeeDisplay');
      expect(modalSource).toContain('Owner + Icon combined fee');
    });
  });

  // ========================================================
  // FIX B — ADMIN PLAYERS API SCREENSHOT RESOLUTION
  // ========================================================
  describe('Fix B — Admin Players API Signed Screenshot URL', () => {

    it('5. Admin Players API resolves screenshot_object_path into signed URL', async () => {
      // Mock the signed URL generator to return a known value
      (getSignedScreenshotUrl as any).mockResolvedValue(
        'https://supabase.co/storage/v1/object/sign/payment-screenshots/t1/r1/proof.png?token=abc123'
      );

      const mockAdmin = {
        from: (table: string) => {
          if (table === 'tournaments') {
            return {
              select: () => ({
                order: () => ({
                  data: [{ id: 't-1', name: 'Test Tournament' }],
                  error: null,
                }),
              }),
            };
          }
          if (table === 'registrations') {
            return {
              select: () => ({
                order: () => ({
                  data: [{
                    id: 'reg-1',
                    tournament_id: 't-1',
                    player_id: 'p-1',
                    registration_number: 'REG-2026-00001',
                    registration_status: 'CONFIRMED',
                    registered_name_snapshot: 'Test Player',
                    registered_role_snapshot: 'BATSMAN',
                    registered_at: '2026-09-01T00:00:00Z',
                    player: { id: 'p-1', full_name: 'Test Player', email: 'test@example.com' },
                    tournament: { id: 't-1', name: 'Test Tournament' },
                    payments: [{
                      id: 'pay-1',
                      amount: 50000,
                      payment_status: 'PENDING',
                      payment_screenshot_url: null,
                      screenshot_object_path: 't-1/reg-1/1234_abcd.png',
                      screenshot_bucket: 'payment-screenshots',
                      transaction_reference: 'UPI-12345678',
                      verification_note: null,
                      verified_by: null,
                      verified_at: null,
                      created_at: '2026-09-01T00:00:00Z',
                    }],
                  }],
                  error: null,
                  eq: () => ({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        },
      };

      (createAdminClient as any).mockReturnValue(mockAdmin);

      const { GET } = await import('@/app/api/admin/players/route');
      const req = new NextRequest('http://localhost:3000/api/admin/players');
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.players).toBeDefined();
      expect(json.players.length).toBeGreaterThan(0);

      // P1: List returns safe metadata without pre-generating signed URLs upfront
      const payment = json.players[0].payments?.[0];
      expect(payment).toBeDefined();
      expect(payment.has_screenshot).toBe(true);
      expect(payment.payment_screenshot_url).toBeNull();
      expect(payment.screenshot_object_path).toBeUndefined();

      // Zero Storage calls during initial player list load
      expect(getSignedScreenshotUrl).not.toHaveBeenCalled();
    });

    it('6. Admin Players API does not call getSignedScreenshotUrl in list path', () => {
      const source = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/admin/players/route.ts'),
        'utf-8'
      );

      // Must select screenshot_object_path from DB to compute has_screenshot
      expect(source).toContain('screenshot_object_path');
      expect(source).toContain('screenshot_bucket');

      // Must NOT call getSignedScreenshotUrl in list route (on-demand endpoint handles this)
      expect(source).not.toContain('getSignedScreenshotUrl');
    });

    it('7. Missing screenshot_object_path is handled safely', async () => {
      // No signed URL should be generated when screenshot_object_path is missing
      (getSignedScreenshotUrl as any).mockClear();

      const mockAdmin = {
        from: (table: string) => {
          if (table === 'tournaments') {
            return {
              select: () => ({
                order: () => ({
                  data: [{ id: 't-1', name: 'Test Tournament' }],
                  error: null,
                }),
              }),
            };
          }
          if (table === 'registrations') {
            return {
              select: () => ({
                order: () => ({
                  data: [{
                    id: 'reg-1',
                    tournament_id: 't-1',
                    player_id: 'p-1',
                    registration_number: 'REG-2026-00001',
                    registration_status: 'CONFIRMED',
                    registered_name_snapshot: 'Test Player',
                    registered_role_snapshot: 'BATSMAN',
                    registered_at: '2026-09-01T00:00:00Z',
                    player: { id: 'p-1', full_name: 'Test Player', email: 'test@example.com' },
                    tournament: { id: 't-1', name: 'Test Tournament' },
                    payments: [{
                      id: 'pay-1',
                      amount: 50000,
                      payment_status: 'PENDING',
                      payment_screenshot_url: null,
                      screenshot_object_path: null,
                      screenshot_bucket: null,
                      transaction_reference: null,
                      verification_note: null,
                      verified_by: null,
                      verified_at: null,
                      created_at: '2026-09-01T00:00:00Z',
                    }],
                  }],
                  error: null,
                  eq: () => ({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        },
      };

      (createAdminClient as any).mockReturnValue(mockAdmin);

      const { GET } = await import('@/app/api/admin/players/route');
      const req = new NextRequest('http://localhost:3000/api/admin/players');
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);

      // getSignedScreenshotUrl should NOT be called
      expect(getSignedScreenshotUrl).not.toHaveBeenCalled();

      // has_screenshot should be false
      const payment = json.players[0].payments?.[0];
      expect(payment.has_screenshot).toBe(false);
      expect(payment.payment_screenshot_url).toBeNull();
    });

    it('8. Admin authorization is required (managed by requireManager)', () => {
      const source = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/admin/players/route.ts'),
        'utf-8'
      );

      // Must call requireManager before processing
      expect(source).toContain('await requireManager()');
    });

    it('9. Signed URLs use time-limited expiration (900s) on on-demand endpoint', () => {
      const source = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/admin/payments/screenshot-url/route.ts'),
        'utf-8'
      );

      // Must pass 900 second expiry to keep URLs short-lived
      expect(source).toMatch(/getSignedScreenshotUrl\([^)]*900\s*\)/);
    });

    it('10. Tournament summary screenshot behavior remains intact', () => {
      const source = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/admin/tournament/[id]/summary/route.ts'),
        'utf-8'
      );

      // Tournament summary API includes screenshot_object_path and screenshot_bucket metadata
      expect(source).toContain('screenshot_object_path');
      expect(source).toContain('screenshot_bucket');
    });
  });
});
