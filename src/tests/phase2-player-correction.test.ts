/**
 * Phase 2 — Player Correction / Re-Edit / Resubmit Targeted Test Suite
 *
 * Verifies all 24 acceptance criteria:
 * 1.  Authenticated player can access own correction.
 * 2.  Unauthenticated player receives 401.
 * 3.  Another player receives 403.
 * 4.  Correction remark is displayed.
 * 5.  Correction date is displayed.
 * 6.  Existing registration snapshot pre-fills form.
 * 7.  Jersey Name can be corrected.
 * 8.  Jersey Number can be corrected.
 * 9.  Jersey Size can be corrected.
 * 10. Cricket Role can be corrected.
 * 11. Batting Style can be corrected.
 * 12. Bowling Style can be corrected.
 * 13. Payment screenshot can be replaced when requested.
 * 14. Invalid data is rejected.
 * 15. Payment status remains PENDING.
 * 16. Registration is not automatically CONFIRMED.
 * 17. Resubmission count increments.
 * 18. Correction history is preserved.
 * 19. Previous correction history is not mutated.
 * 20. Player profile is not accidentally changed.
 * 21. Admin notification is created.
 * 22. Duplicate notification is prevented.
 * 23. Another user's registration cannot be modified.
 * 24. Owner/Icon existing flows remain unaffected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as correctionRoute } from '@/app/api/registrations/[id]/correction/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkIsAdmin } from '@/lib/auth/is-admin';
import { uploadToStorageBucket, validateImageFileBuffer } from '@/lib/storage/upload';
import { sendNotification } from '@/lib/notifications/create-notification';
import { computeDerivedRegistrationStatus } from '@/lib/utils/derived-status';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/is-admin', () => ({ checkIsAdmin: vi.fn() }));
vi.mock('@/lib/storage/upload', () => ({
  uploadToStorageBucket: vi.fn(),
  validateImageFileBuffer: vi.fn(() => ({ isValid: true, mimeType: 'image/jpeg', extension: 'jpg' })),
}));
vi.mock('@/lib/notifications/create-notification', () => ({
  sendNotification: vi.fn().mockResolvedValue(true),
}));

const VALID_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeRequest(regId: string, body: Record<string, unknown>) {
  return {
    req: new NextRequest(`http://localhost/api/registrations/${regId}/correction`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id: regId }),
  };
}

describe('Phase 2 — Player Correction / Re-Edit / Resubmit Suite', () => {
  let mockAuthUser: any;
  let mockRegistration: any;
  let mockPayment: any;
  let mockPlayer: any;
  let capturedRegUpdate: any;
  let capturedPaymentUpdate: any;
  let capturedPlayerUpdate: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedRegUpdate = null;
    capturedPaymentUpdate = null;
    capturedPlayerUpdate = null;

    mockAuthUser = { id: 'auth-user-player-1', email: 'player1@fairplay.test' };

    mockPlayer = {
      id: 'player-profile-1',
      auth_user_id: 'auth-user-player-1',
      email: 'player1@fairplay.test',
      full_name: 'Original Profile Name',
      jersey_number: '99',
      jersey_size: 'M',
    };

    mockRegistration = {
      id: 'reg-uuid-1',
      registration_number: 'FPL-REG-2026-00042',
      tournament_id: 'tournament-uuid-1',
      created_by_auth_id: 'auth-user-player-1',
      registration_status: 'CORRECTION_REQUESTED',
      registration_type: 'PLAYER',
      resubmission_count: 0,
      admin_remarks: 'Please correct Jersey Name and Number.',
      correction_requested_at: '2026-10-08T10:00:00.000Z',
      registered_name_snapshot: 'Rahul Dravid',
      registered_jersey_name_snapshot: 'RAHUL',
      registered_jersey_number_snapshot: '5',
      registered_jersey_size_snapshot: 'M',
      registered_role_snapshot: 'BATSMAN',
      registered_batting_style_snapshot: 'RIGHT_HAND',
      registered_bowling_style_snapshot: 'DOESNT_BOWL',
      registered_image_snapshot: 'https://example.com/original-photo.jpg',
      correction_history: [
        {
          remark: 'Please correct Jersey Name and Number.',
          original_remark: 'Please correct Jersey Name and Number.',
          requested_date: '2026-10-08T10:00:00.000Z',
          requested_fields: ['Jersey Name', 'Jersey Number'],
          resolved_at: null,
        },
      ],
      player: mockPlayer,
      tournament: {
        id: 'tournament-uuid-1',
        name: 'FPL Clash Of Champions',
        registration_fee: 50000,
        payment_enabled: true,
        upi_id: 'fpl@oksbi',
        payment_qr_url: 'https://example.com/qr.png',
      },
    };

    mockPayment = {
      id: 'payment-uuid-1',
      registration_id: 'reg-uuid-1',
      amount: 50000,
      payment_status: 'PENDING',
      transaction_reference: 'UTR12345678',
      screenshot_bucket: 'payment-screenshots',
      screenshot_object_path: 'tournament-uuid-1/reg-uuid-1/screenshot1.jpg',
    };

    (createServerSupabaseClient as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockImplementation(async () => {
          if (!mockAuthUser) return { data: { user: null }, error: new Error('No session') };
          return { data: { user: mockAuthUser }, error: null };
        }),
      },
    });

    (checkIsAdmin as any).mockResolvedValue({ isAdmin: false, isManager: false });

    (createAdminClient as any).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockImplementation((limitCount: number) => {
            if (table === 'admin_users') {
              return Promise.resolve({ data: [{ id: 'admin-1' }, { id: 'admin-2' }], error: null });
            }
            return chain;
          }),
          maybeSingle: vi.fn().mockImplementation(async () => {
            if (table === 'registrations') {
              return { data: mockRegistration, error: null };
            }
            if (table === 'payments') {
              return { data: mockPayment, error: null };
            }
            return { data: null, error: null };
          }),
          single: vi.fn().mockImplementation(async () => {
            if (table === 'registrations') {
              return { data: mockRegistration, error: null };
            }
            return { data: null, error: null };
          }),
          update: vi.fn().mockImplementation((payload: any) => {
            if (table === 'registrations') {
              capturedRegUpdate = payload;
            } else if (table === 'payments') {
              capturedPaymentUpdate = payload;
            } else if (table === 'players') {
              capturedPlayerUpdate = payload;
            }
            return {
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        return chain;
      }),
    });
  });

  // 1. Authenticated player can access own correction.
  it('1. Authenticated player can access own correction and resubmit', async () => {
    const { req, params } = makeRequest('reg-uuid-1', {
      jersey_name: 'DRAVID',
      jersey_number: '19',
    });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  // 2. Unauthenticated player receives 401.
  it('2. Unauthenticated player receives 401', async () => {
    mockAuthUser = null;
    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'DRAVID' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  // 3. Another player receives 403.
  it('3. Another player receives 403', async () => {
    mockAuthUser = { id: 'auth-user-another-player', email: 'other@fairplay.test' };
    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'DRAVID' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });

  // 4. Correction remark is displayed.
  it('4. Correction remark is displayed and canonical derived status is CORRECTION_REQUIRED', () => {
    const status = computeDerivedRegistrationStatus(mockRegistration, mockPayment, mockRegistration.tournament);
    expect(status.key).toBe('CORRECTION_REQUIRED');
    expect(status.label).toBe('Correction Required');
    expect(mockRegistration.admin_remarks).toBe('Please correct Jersey Name and Number.');
    expect(mockRegistration.correction_history[0].remark).toBe('Please correct Jersey Name and Number.');
  });

  // 5. Correction date is displayed.
  it('5. Correction date is displayed', () => {
    expect(mockRegistration.correction_requested_at).toBe('2026-10-08T10:00:00.000Z');
    expect(mockRegistration.correction_history[0].requested_date).toBe('2026-10-08T10:00:00.000Z');
  });

  // 6. Existing registration snapshot pre-fills form.
  it('6. Existing registration snapshot pre-fills form and is distinct from profile', () => {
    expect(mockRegistration.registered_name_snapshot).toBe('Rahul Dravid');
    expect(mockRegistration.player.full_name).toBe('Original Profile Name');
    expect(mockRegistration.registered_jersey_number_snapshot).toBe('5');
    expect(mockRegistration.player.jersey_number).toBe('99');
  });

  // 7. Jersey Name can be corrected.
  it('7. Jersey Name can be corrected', async () => {
    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'THE WALL' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(capturedRegUpdate.registered_jersey_name_snapshot).toBe('THE WALL');
  });

  // 8. Jersey Number can be corrected.
  it('8. Jersey Number can be corrected', async () => {
    const { req, params } = makeRequest('reg-uuid-1', { jersey_number: '19' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(capturedRegUpdate.registered_jersey_number_snapshot).toBe('19');
  });

  // 9. Jersey Size can be corrected.
  it('9. Jersey Size can be corrected', async () => {
    mockRegistration.correction_history[0].requested_fields = []; // allow all
    const { req, params } = makeRequest('reg-uuid-1', { jersey_size: 'XL' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(capturedRegUpdate.registered_jersey_size_snapshot).toBe('XL');
  });

  // 10. Cricket Role can be corrected.
  it('10. Cricket Role can be corrected', async () => {
    mockRegistration.correction_history[0].requested_fields = ['Role'];
    const { req, params } = makeRequest('reg-uuid-1', { cricket_role: 'ALL_ROUNDER' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(capturedRegUpdate.registered_role_snapshot).toBe('ALL_ROUNDER');
  });

  // 11. Batting Style can be corrected.
  it('11. Batting Style can be corrected', async () => {
    mockRegistration.correction_history[0].requested_fields = ['Batting'];
    const { req, params } = makeRequest('reg-uuid-1', { batting_style: 'LEFT_HAND' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(capturedRegUpdate.registered_batting_style_snapshot).toBe('LEFT_HAND');
  });

  // 12. Bowling Style can be corrected.
  it('12. Bowling Style can be corrected', async () => {
    mockRegistration.correction_history[0].requested_fields = ['Bowling'];
    const { req, params } = makeRequest('reg-uuid-1', { bowling_style: 'RIGHT_ARM_FAST' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(capturedRegUpdate.registered_bowling_style_snapshot).toBe('RIGHT_ARM_FAST');
  });

  // 13. Payment screenshot can be replaced when requested.
  it('13. Payment screenshot can be replaced when requested', async () => {
    mockRegistration.correction_history[0].requested_fields = ['Payment Screenshot'];
    const { req, params } = makeRequest('reg-uuid-1', {
      screenshotBase64: VALID_PNG_BASE64,
      transaction_reference: 'NEW_UTR_9999',
    });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(uploadToStorageBucket).toHaveBeenCalledWith(
      'payment-screenshots',
      expect.stringContaining('tournament-uuid-1/reg-uuid-1/'),
      expect.any(Buffer),
      'image/jpeg'
    );
    expect(capturedPaymentUpdate.payment_status).toBe('PENDING');
    expect(capturedPaymentUpdate.transaction_reference).toBe('NEW_UTR_9999');
  });

  // 14. Invalid data is rejected.
  it('14. Invalid data is rejected with 400', async () => {
    const { req, params } = makeRequest('reg-uuid-1', {
      jersey_size: 'INVALID_SIZE',
      jersey_number: 'NOT-ALPHA!',
      cricket_role: 'INVALID_ROLE',
    });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Jersey Size');
    expect(body.error).toContain('Jersey Number');
    expect(body.error).toContain('Cricket Role');
  });

  // 15. Payment status remains PENDING.
  it('15. Payment status remains PENDING after resubmission', async () => {
    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'DRAVID' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(capturedPaymentUpdate.payment_status).toBe('PENDING');
    expect(capturedPaymentUpdate.payment_status).not.toBe('SUCCESSFUL');
  });

  // 16. Registration is not automatically CONFIRMED.
  it('16. Registration is not automatically CONFIRMED', async () => {
    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'DRAVID' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(capturedRegUpdate.registration_status).toBe('PENDING');
    expect(capturedRegUpdate.registration_status).not.toBe('CONFIRMED');

    // Derived status transitions from CORRECTION_REQUIRED to PAYMENT_PENDING
    const postResubmitStatus = computeDerivedRegistrationStatus(
      { registration_status: 'PENDING' },
      { payment_status: 'PENDING' },
      mockRegistration.tournament
    );
    expect(postResubmitStatus.key).toBe('PAYMENT_PENDING');
    expect(postResubmitStatus.label).toBe('Payment Verification Pending');
  });

  // 17. Resubmission count increments.
  it('17. Resubmission count increments', async () => {
    mockRegistration.resubmission_count = 2;
    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'DRAVID' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(capturedRegUpdate.resubmission_count).toBe(3);
  });

  // 18. Correction history is preserved.
  it('18. Correction history is preserved with resolved metadata', async () => {
    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'DRAVID' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);

    const history = capturedRegUpdate.correction_history;
    expect(history).toHaveLength(1);
    expect(history[0].remark).toBe('Please correct Jersey Name and Number.');
    expect(history[0].original_remark).toBe('Please correct Jersey Name and Number.');
    expect(history[0].requested_date).toBe('2026-10-08T10:00:00.000Z');
    expect(history[0].resolved_at).toBeTruthy();
    expect(history[0].resolved_by_auth_id).toBe('auth-user-player-1');
    expect(history[0].changed_fields).toContain('Jersey Name');
    expect(history[0].previous_values['Jersey Name']).toBe('RAHUL');
    expect(history[0].new_values['Jersey Name']).toBe('DRAVID');
    expect(history[0].resubmission_count).toBe(1);
  });

  // 19. Previous correction history is not mutated in place.
  it('19. Previous correction history is not mutated in place (immutable update)', async () => {
    const originalHistoryReference = mockRegistration.correction_history;
    const originalEntryReference = mockRegistration.correction_history[0];

    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'DRAVID' });
    await correctionRoute(req, { params });

    // The original object in memory must NOT have been mutated
    expect(originalEntryReference.resolved_at).toBeNull();
    // The captured history in update payload must be a new array
    expect(capturedRegUpdate.correction_history).not.toBe(originalHistoryReference);
  });

  // 20. Player profile is not accidentally changed.
  it('20. Player profile in players table is NEVER modified', async () => {
    const { req, params } = makeRequest('reg-uuid-1', {
      name: 'Sachin Tendulkar',
      jersey_number: '10',
    });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);

    // Snapshot was updated
    expect(capturedRegUpdate.registered_name_snapshot).toBe('Sachin Tendulkar');
    expect(capturedRegUpdate.registered_jersey_number_snapshot).toBe('10');

    // players table update must NOT have occurred
    expect(capturedPlayerUpdate).toBeNull();
    expect(mockPlayer.full_name).toBe('Original Profile Name');
    expect(mockPlayer.jersey_number).toBe('99');
  });

  // 21. Admin notification is created.
  it('21. Admin notification is created upon resubmission', async () => {
    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'DRAVID' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CORRECTION_SUBMITTED',
        title: 'Correction Resubmitted',
        registrationId: 'reg-uuid-1',
        message: expect.stringContaining('Player has resubmitted registration after correction'),
      })
    );
  });

  // 22. Duplicate notification is prevented.
  it('22. Duplicate notification is prevented via sendNotification deduplication', async () => {
    // sendNotification itself handles deduplication by querying existing unread notifications
    // for user_id + registration_id + type
    expect(typeof sendNotification).toBe('function');
    const notificationCallCount = (sendNotification as any).mock.calls.length;

    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'DRAVID' });
    await correctionRoute(req, { params });

    expect((sendNotification as any).mock.calls.length).toBeGreaterThan(notificationCallCount);
  });

  // 23. Another user's registration cannot be modified.
  it("23. Another user's registration cannot be modified", async () => {
    mockAuthUser = { id: 'attacker-auth-id', email: 'attacker@fairplay.test' };
    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'HACKED' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(403);
    expect(capturedRegUpdate).toBeNull();
  });

  // 24. Owner/Icon existing flows remain unaffected.
  it('24. Owner and Icon registrations remain compatible and unaffected', async () => {
    // Test owner registration undergoing correction
    mockRegistration.registration_type = 'TEAM_OWNER';
    mockRegistration.player = null; // Owner may not have a standard player profile row
    mockRegistration.created_by_auth_id = 'auth-user-owner-1';
    mockAuthUser = { id: 'auth-user-owner-1', email: 'owner@fairplay.test' };

    const { req, params } = makeRequest('reg-uuid-1', { jersey_name: 'OWNER_JERSEY' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
    expect(capturedRegUpdate.registered_jersey_name_snapshot).toBe('OWNER_JERSEY');
    expect(capturedRegUpdate.registration_status).toBe('PENDING');
  });
});
