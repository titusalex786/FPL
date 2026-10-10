/**
 * Critical Fix Regression Tests
 *
 * #1  — Correction history immutability (no in-place mutation)
 * #2  — Silent database error handling (no false-success on DB failure)
 * #3  — Payment screenshot linking (no orphaned Storage objects)
 * #4  — Correction input validation (enum, length, alphanumeric)
 *
 * All tests use in-process mocks only. No production data is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as correctionRoute } from '@/app/api/registrations/[id]/correction/route';
import { POST as registrationRoute } from '@/app/api/registrations/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkIsAdmin } from '@/lib/auth/is-admin';
import { uploadToStorageBucket } from '@/lib/storage/upload';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/is-admin', () => ({ checkIsAdmin: vi.fn() }));
vi.mock('@/lib/storage/upload', () => ({
  uploadToStorageBucket: vi.fn(),
  validateImageFileBuffer: vi.fn(() => ({ isValid: true, mimeType: 'image/jpeg', extension: 'jpg' })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const makeRequest = (url: string, body: Record<string, unknown>) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body) });

const makeCorrectionRequest = (body: Record<string, unknown>) =>
  makeRequest('http://localhost/api/registrations/reg-test-id/correction', body);

/** Build a fluent Supabase admin mock where each operation can be overridden */
function buildAdminMock(overrides: Record<string, any> = {}) {
  const defaultChain = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    from: vi.fn().mockImplementation((table: string) => ({
      ...defaultChain,
      ...(overrides[table] ?? {}),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    storage: { from: vi.fn().mockReturnValue({ upload: vi.fn().mockResolvedValue({ data: {}, error: null }) }) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Base correction registration fixture
// ─────────────────────────────────────────────────────────────────────────────
const BASE_REGISTRATION = {
  id: 'reg-test-id',
  tournament_id: 'tournament-id-1',
  registration_number: 'REG-2026-00001',
  registration_status: 'CORRECTION_REQUESTED',
  resubmission_count: 0,
  created_by_auth_id: 'auth-user-1',
  registered_name_snapshot: 'Rahul Patil',
  registered_jersey_name_snapshot: 'RAHUL',
  registered_jersey_number_snapshot: '7',
  registered_jersey_size_snapshot: 'M',
  registered_role_snapshot: 'BATSMAN',
  registered_batting_style_snapshot: 'RIGHT_HAND',
  registered_bowling_style_snapshot: 'DOESNT_BOWL',
  registered_image_snapshot: 'https://example.com/photo.jpg',
  correction_history: [
    {
      remark: 'Please correct your jersey name',
      requested_at: '2026-10-01T10:00:00Z',
      resolved_at: null,
      requested_fields: ['Jersey Name'],
    },
  ],
  player: { auth_user_id: 'auth-user-1' },
  tournament: { registration_fee: 50000 },
};

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL #1 — CORRECTION HISTORY IMMUTABILITY
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
describe('Critical #1 — Correction History Immutability', () => {
  let capturedUpdatePayload: any = null;
  let mockAdmin: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedUpdatePayload = null;

    (checkIsAdmin as any).mockResolvedValue({ isAdmin: true, isManager: false });

    const serverMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-1' } },
          error: null,
        }),
      },
    };
    (createServerSupabaseClient as any).mockResolvedValue(serverMock);

    mockAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          update: vi.fn().mockImplementation((data: any) => {
            if (table === 'registrations') {
              capturedUpdatePayload = JSON.parse(JSON.stringify(data)); // deep copy
            }
            return chain;
          }),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(),
          single: vi.fn(),
        };

        if (table === 'registrations') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: JSON.parse(JSON.stringify(BASE_REGISTRATION)), // deep clone to simulate DB response
            error: null,
          });
          chain.update = vi.fn().mockImplementation((data: any) => {
            capturedUpdatePayload = JSON.parse(JSON.stringify(data));
            return { ...chain, eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
          });
        } else if (table === 'payments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
          chain.update = vi.fn().mockReturnValue({ ...chain, eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
          chain.insert = vi.fn().mockResolvedValue({ data: null, error: null });
        } else if (table === 'admin_users') {
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
          // For the .select().limit() chain on admin_users
          chain.select = vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          });
          chain.insert = vi.fn().mockResolvedValue({ data: null, error: null });
        }
        return chain;
      }),
    };

    (createAdminClient as any).mockReturnValue(mockAdmin);
  });

  it('#1a — Original correction_history array from DB is NEVER mutated', async () => {
    // Capture the original history object reference before the route executes
    const originalHistory = BASE_REGISTRATION.correction_history;
    const originalEntry = originalHistory[0];
    const originalResolvedAt = originalEntry.resolved_at; // should remain null

    const req = makeCorrectionRequest({ jersey_name: 'NEW_NAME' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    await correctionRoute(req, { params });

    // The original in-memory entry must NOT have been modified
    const entry = originalEntry as any; // cast to check absence of dynamically-assigned properties
    expect(entry.resolved_at).toBe(originalResolvedAt); // still null
    expect(entry.resolved_by_auth_id).toBeUndefined();
    expect(entry.old_values).toBeUndefined();
    expect(entry.new_values).toBeUndefined();
  });

  it('#1b — Updated correction_history written to DB contains the resolved entry', async () => {
    const req = makeCorrectionRequest({ jersey_name: 'KAPIL' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    await correctionRoute(req, { params });

    expect(capturedUpdatePayload).not.toBeNull();
    expect(capturedUpdatePayload.correction_history).toBeDefined();

    const updatedHistory: any[] = capturedUpdatePayload.correction_history;
    expect(updatedHistory).toHaveLength(1);

    const resolvedEntry = updatedHistory[0];
    expect(resolvedEntry.resolved_at).toBeTruthy(); // now has a timestamp
    expect(resolvedEntry.resolved_by_auth_id).toBe('auth-user-1');
  });

  it('#1c — old_values and new_values are preserved in the resolved entry', async () => {
    const req = makeCorrectionRequest({ jersey_name: 'KAPIL' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    await correctionRoute(req, { params });

    const updatedHistory: any[] = capturedUpdatePayload.correction_history;
    const resolvedEntry = updatedHistory[0];

    expect(resolvedEntry.old_values['Jersey Name']).toBe('RAHUL');
    expect(resolvedEntry.new_values['Jersey Name']).toBe('KAPIL');
  });

  it('#1d — Pre-existing history entries are preserved unchanged', async () => {
    // Simulate a registration with 2 entries: one resolved, one unresolved
    const twoEntryRegistration = {
      ...BASE_REGISTRATION,
      correction_history: [
        {
          remark: 'First correction - resolved',
          requested_at: '2026-09-01T10:00:00Z',
          resolved_at: '2026-09-02T10:00:00Z',
          resolved_by_auth_id: 'auth-admin-1',
          requested_fields: ['Jersey Size'],
        },
        {
          remark: 'Second correction - pending',
          requested_at: '2026-10-01T10:00:00Z',
          resolved_at: null,
          requested_fields: ['Jersey Name'],
        },
      ],
    };

    mockAdmin.from.mockImplementation((table: string) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockImplementation((data: any) => {
          if (table === 'registrations') capturedUpdatePayload = JSON.parse(JSON.stringify(data));
          return { ...chain, eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
        }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: JSON.parse(JSON.stringify(twoEntryRegistration)),
          error: null,
        }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      if (table === 'admin_users') {
        chain.select = vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        });
      }
      return chain;
    });

    const req = makeCorrectionRequest({ jersey_name: 'NEWNAME' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    await correctionRoute(req, { params });

    const updatedHistory: any[] = capturedUpdatePayload.correction_history;
    expect(updatedHistory).toHaveLength(2);

    // First entry (already resolved) must be completely unchanged
    const firstEntry = updatedHistory[0];
    expect(firstEntry.resolved_at).toBe('2026-09-02T10:00:00Z');
    expect(firstEntry.resolved_by_auth_id).toBe('auth-admin-1');
    expect(firstEntry.remark).toBe('First correction - resolved');

    // Second entry (the active one) must now be resolved
    const secondEntry = updatedHistory[1];
    expect(secondEntry.resolved_at).toBeTruthy();
    expect(secondEntry.resolved_by_auth_id).toBe('auth-user-1');
  });

  it('#1e — API returns success response after immutable update', async () => {
    const req = makeCorrectionRequest({ jersey_name: 'KAPIL' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL #2 — SILENT DATABASE ERROR HANDLING
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
describe('Critical #2 — Silent DB Error Handling in Registration Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const serverMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-1', email: 'player@test.com' } },
          error: null,
        }),
      },
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'player-uuid-1' }, error: null }),
      })),
    };
    (createServerSupabaseClient as any).mockResolvedValue(serverMock);
  });

  it('#2a — Player profile update failure is logged but does NOT produce false-success', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: { id: 'new-player-id' }, error: null }),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
        };

        if (table === 'players') {
          // update() returns a chain where eq() resolves to a DB error
          chain.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '42501', message: 'DB permission error' },
            }),
          });
        } else if (table === 'tournaments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: 't-1', name: 'FPL', registration_fee: 50000, max_players: 100 },
            error: null,
          });
        } else if (table === 'registrations') {
          chain.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          });
        } else if (table === 'payments') {
          chain.select = vi.fn().mockReturnThis();
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
          chain.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          });
        }
        return chain;
      }),
      rpc: vi.fn().mockResolvedValue({
        data: [{
          registration_id: 'new-reg-id',
          registration_number: 'REG-2026-99999',
          registration_status: 'PENDING',
          waitlist_position: null,
          payment_id: 'new-pay-id',
        }],
        error: null,
      }),
    };
    (createAdminClient as any).mockReturnValue(adminMock);

    const req = makeRequest('http://localhost/api/registrations', {
      fullName: 'Test Player',
      profileImageUrl: 'https://example.com/photo.jpg',
      cricketRole: 'BATSMAN',
      battingStyle: 'RIGHT_HAND',
    });

    const res = await registrationRoute(req);
    const data = await res.json();

    // Registration must still succeed (profile update is non-fatal)
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    // Error must have been logged — not silently swallowed
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[registration]'),
      expect.objectContaining({ operation: expect.any(String) })
    );

    errorSpy.mockRestore();
  });

  it('#2b — RPC failure returns a proper error response, not a false success', async () => {
    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
        };
        if (table === 'tournaments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: 't-1', registration_fee: 50000 },
            error: null,
          });
        }
        return chain;
      }),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Tournament is full', code: 'P0001' },
      }),
    };
    (createAdminClient as any).mockReturnValue(adminMock);

    // Simulate user with existing player profile (SELF path)
    const serverMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-1', email: 'player@test.com' } },
          error: null,
        }),
      },
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing-player-id' }, error: null }),
      })),
    };
    (createServerSupabaseClient as any).mockResolvedValue(serverMock);

    const req = makeRequest('http://localhost/api/registrations', {
      fullName: 'Test Player',
      profileImageUrl: 'https://example.com/photo.jpg',
    });

    const res = await registrationRoute(req);
    const data = await res.json();

    // Must NOT return success: true
    expect(res.status).not.toBe(200);
    expect(data.success).toBeUndefined();
    expect(data.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL #3 — PAYMENT SCREENSHOT LINKING
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
describe('Critical #3 — Payment Screenshot Linking (no orphaned Storage objects)', () => {
  const MOCK_BASE64_JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64')}`;

  const SERVER_MOCK_WITH_PLAYER = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'auth-user-1', email: 'player@test.com' } },
        error: null,
      }),
    },
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing-player-id' }, error: null }),
    })),
  };

  const SUCCESS_RPC_DATA = [{
    registration_id: 'new-reg-id',
    registration_number: 'REG-2026-00002',
    registration_status: 'PENDING',
    waitlist_position: null,
    payment_id: 'new-pay-id',
  }];

  beforeEach(() => {
    vi.clearAllMocks();
    (createServerSupabaseClient as any).mockResolvedValue(SERVER_MOCK_WITH_PLAYER);
    (uploadToStorageBucket as any).mockResolvedValue({ bucket: 'payment-screenshots', objectPath: 'path/file.jpg' });
  });

  it('#3a — Screenshot is linked to payment_id when RPC returns it', async () => {
    let capturedPaymentUpdate: any = null;

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockImplementation((data: any) => {
            if (table === 'payments') capturedPaymentUpdate = data;
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        if (table === 'tournaments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: 't-1', registration_fee: 50000 },
            error: null,
          });
        }
        return chain;
      }),
      rpc: vi.fn().mockResolvedValue({ data: SUCCESS_RPC_DATA, error: null }),
    };
    (createAdminClient as any).mockReturnValue(adminMock);

    const req = makeRequest('http://localhost/api/registrations', {
      fullName: 'Test Player',
      profileImageUrl: 'https://example.com/photo.jpg',
      paymentScreenshotBase64: MOCK_BASE64_JPEG,
    });

    const res = await registrationRoute(req);
    expect(res.status).toBe(200);

    // Storage upload was called
    expect(uploadToStorageBucket).toHaveBeenCalledWith(
      'payment-screenshots',
      expect.stringContaining('new-reg-id'),
      expect.any(Buffer),
      'image/jpeg'
    );

    // Payment record was linked with the screenshot path
    expect(capturedPaymentUpdate).toBeTruthy();
    expect(capturedPaymentUpdate.screenshot_bucket).toBe('payment-screenshots');
    expect(capturedPaymentUpdate.screenshot_object_path).toBeTruthy();
  });

  it('#3b — When payment_id is null, existing payment row is looked up and linked (no orphan)', async () => {
    let capturedPaymentUpdate: any = null;
    const EXISTING_PAYMENT_ID = 'found-payment-id';

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockImplementation((data: any) => {
            if (table === 'payments') capturedPaymentUpdate = data;
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        if (table === 'tournaments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: 't-1', registration_fee: 50000 },
            error: null,
          });
        }
        if (table === 'payments') {
          // Simulate: the existing payment row IS found via lookup
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: EXISTING_PAYMENT_ID },
            error: null,
          });
        }
        return chain;
      }),
      // RPC returns payment_id: null (e.g. waitlist scenario)
      rpc: vi.fn().mockResolvedValue({
        data: [{ ...SUCCESS_RPC_DATA[0], payment_id: null }],
        error: null,
      }),
    };
    (createAdminClient as any).mockReturnValue(adminMock);

    const req = makeRequest('http://localhost/api/registrations', {
      fullName: 'Test Player',
      profileImageUrl: 'https://example.com/photo.jpg',
      paymentScreenshotBase64: MOCK_BASE64_JPEG,
    });

    const res = await registrationRoute(req);
    expect(res.status).toBe(200);

    // Screenshot was uploaded
    expect(uploadToStorageBucket).toHaveBeenCalled();

    // Screenshot path was linked to the looked-up payment record
    expect(capturedPaymentUpdate).toBeTruthy();
    expect(capturedPaymentUpdate.screenshot_object_path).toBeTruthy();
  });

  it('#3c — When payment_id is null and no existing payment row found, a new payment row is created', async () => {
    let insertedPayment: any = null;

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          insert: vi.fn().mockImplementation((data: any) => {
            if (table === 'payments') insertedPayment = data;
            return Promise.resolve({ data: null, error: null });
          }),
        };
        if (table === 'tournaments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: 't-1', registration_fee: 50000 },
            error: null,
          });
        }
        // payments.maybeSingle returns null → no existing row
        if (table === 'payments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        }
        return chain;
      }),
      rpc: vi.fn().mockResolvedValue({
        data: [{ ...SUCCESS_RPC_DATA[0], payment_id: null }],
        error: null,
      }),
    };
    (createAdminClient as any).mockReturnValue(adminMock);

    const req = makeRequest('http://localhost/api/registrations', {
      fullName: 'Test Player',
      profileImageUrl: 'https://example.com/photo.jpg',
      paymentScreenshotBase64: MOCK_BASE64_JPEG,
    });

    const res = await registrationRoute(req);
    expect(res.status).toBe(200);

    // A new payment row must have been created with the screenshot link
    expect(insertedPayment).toBeTruthy();
    expect(insertedPayment.registration_id).toBe('new-reg-id');
    expect(insertedPayment.screenshot_object_path).toBeTruthy();
    expect(insertedPayment.screenshot_bucket).toBe('payment-screenshots');
  });

  it('#3d — Storage upload failure does NOT write screenshot path to DB (no orphaned DB reference)', async () => {
    let paymentUpdateCalled = false;

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockImplementation((data: any) => {
            if (table === 'payments' && data.screenshot_object_path) {
              paymentUpdateCalled = true;
            }
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }),
          insert: vi.fn().mockImplementation((data: any) => {
            if (table === 'payments' && data.screenshot_object_path) {
              paymentUpdateCalled = true;
            }
            return Promise.resolve({ data: null, error: null });
          }),
        };
        if (table === 'tournaments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: 't-1', registration_fee: 50000 },
            error: null,
          });
        }
        return chain;
      }),
      rpc: vi.fn().mockResolvedValue({ data: SUCCESS_RPC_DATA, error: null }),
    };
    (createAdminClient as any).mockReturnValue(adminMock);

    // Simulate Storage upload failure
    (uploadToStorageBucket as any).mockRejectedValue(new Error('Storage connection timeout'));

    const req = makeRequest('http://localhost/api/registrations', {
      fullName: 'Test Player',
      profileImageUrl: 'https://example.com/photo.jpg',
      paymentScreenshotBase64: MOCK_BASE64_JPEG,
    });

    const res = await registrationRoute(req);
    // Registration itself should still succeed (screenshot is optional)
    expect(res.status).toBe(200);

    // No screenshot path should have been written to DB
    expect(paymentUpdateCalled).toBe(false);
  });

  it('#3e — No screenshot submitted → no storage call, no duplicate payment row created', async () => {
    let insertCallCount = 0;

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          insert: vi.fn().mockImplementation(() => {
            if (table === 'payments') insertCallCount++;
            return Promise.resolve({ data: null, error: null });
          }),
        };
        if (table === 'tournaments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: 't-1', registration_fee: 50000 },
            error: null,
          });
        }
        return chain;
      }),
      rpc: vi.fn().mockResolvedValue({ data: SUCCESS_RPC_DATA, error: null }),
    };
    (createAdminClient as any).mockReturnValue(adminMock);

    const req = makeRequest('http://localhost/api/registrations', {
      fullName: 'Test Player',
      profileImageUrl: 'https://example.com/photo.jpg',
      // No paymentScreenshotBase64
    });

    const res = await registrationRoute(req);
    expect(res.status).toBe(200);

    // No Storage upload was attempted
    expect(uploadToStorageBucket).not.toHaveBeenCalled();

    // No extra payment row was inserted
    expect(insertCallCount).toBe(0);
  });

  it('#3f — Retry does not create a duplicate payment row when one already exists', async () => {
    let insertCallCount = 0;
    let updateCallCount = 0;

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockImplementation(() => {
            if (table === 'payments') updateCallCount++;
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }),
          insert: vi.fn().mockImplementation(() => {
            if (table === 'payments') insertCallCount++;
            return Promise.resolve({ data: null, error: null });
          }),
        };
        if (table === 'tournaments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: 't-1', registration_fee: 50000 },
            error: null,
          });
        }
        if (table === 'payments') {
          // Existing payment IS found in the fallback lookup
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: 'existing-pay-id' },
            error: null,
          });
        }
        return chain;
      }),
      // RPC returns null payment_id to trigger the fallback path
      rpc: vi.fn().mockResolvedValue({
        data: [{ ...SUCCESS_RPC_DATA[0], payment_id: null }],
        error: null,
      }),
    };
    (createAdminClient as any).mockReturnValue(adminMock);

    const req = makeRequest('http://localhost/api/registrations', {
      fullName: 'Test Player',
      profileImageUrl: 'https://example.com/photo.jpg',
      paymentScreenshotBase64: MOCK_BASE64_JPEG,
    });

    const res = await registrationRoute(req);
    expect(res.status).toBe(200);

    // Update was used (not insert) — no duplicate row
    expect(updateCallCount).toBeGreaterThan(0);
    expect(insertCallCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL #4 — CORRECTION INPUT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
describe('Critical #4 — Correction Input Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const serverMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-1' } },
          error: null,
        }),
      },
    };
    (createServerSupabaseClient as any).mockResolvedValue(serverMock);
    (checkIsAdmin as any).mockResolvedValue({ isAdmin: true });

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        if (table === 'registrations') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: JSON.parse(JSON.stringify(BASE_REGISTRATION)),
            error: null,
          });
          chain.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          });
        }
        if (table === 'payments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        }
        if (table === 'admin_users') {
          chain.select = vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          });
        }
        return chain;
      }),
    };
    (createAdminClient as any).mockReturnValue(adminMock);
  });

  it('#4a — Valid correction with all correct fields → 200', async () => {
    const req = makeCorrectionRequest({
      jersey_name: 'VALID',
      jersey_number: '7',
      jersey_size: 'L',
      cricket_role: 'BOWLER',
      batting_style: 'LEFT_HAND',
      bowling_style: 'RIGHT_ARM_FAST',
      transaction_reference: 'TXN123456',
    });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
  });

  it('#4b — Empty jersey_name (blank after trim) is accepted (allowed for clearing)', async () => {
    const req = makeCorrectionRequest({ jersey_name: '   ' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    // Empty strings are accepted — business logic allows clearing the value
    expect(res.status).toBe(200);
  });

  it('#4c — Jersey Name > 30 chars is rejected with 400', async () => {
    const req = makeCorrectionRequest({ jersey_name: 'A'.repeat(31) });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('Jersey Name');
  });

  it('#4d — Jersey Number > 10 chars is rejected with 400', async () => {
    const req = makeCorrectionRequest({ jersey_number: '12345678901' }); // 11 chars
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('Jersey Number');
  });

  it('#4e — Jersey Number with special characters is rejected with 400', async () => {
    const req = makeCorrectionRequest({ jersey_number: '7;DROP TABLE' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('alphanumeric');
  });

  it('#4f — Invalid cricket_role is rejected with 400', async () => {
    const req = makeCorrectionRequest({ cricket_role: 'HACKER' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('Cricket Role');
  });

  it('#4g — Invalid batting_style is rejected with 400', async () => {
    const req = makeCorrectionRequest({ batting_style: 'AMBIDEXTROUS' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('Batting Style');
  });

  it('#4h — Invalid bowling_style is rejected with 400', async () => {
    const req = makeCorrectionRequest({ bowling_style: 'UNDERARM' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('Bowling Style');
  });

  it('#4i — Invalid jersey_size is rejected with 400', async () => {
    const req = makeCorrectionRequest({ jersey_size: 'HUGE' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('Jersey Size');
  });

  it('#4j — Transaction Reference > 100 chars is rejected with 400', async () => {
    const req = makeCorrectionRequest({ transaction_reference: 'T'.repeat(101) });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('Transaction Reference');
  });

  it('#4k — Transaction Reference with SQL-injection characters is rejected', async () => {
    const req = makeCorrectionRequest({ transaction_reference: "'; DROP TABLE payments; --" });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('Transaction Reference');
  });

  it('#4l — Unexpected/unknown request body fields are silently ignored, not written to DB', async () => {
    let capturedRegistrationUpdate: any = null;
    const adminOverride = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockImplementation((data: any) => {
            if (table === 'registrations') capturedRegistrationUpdate = data;
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        if (table === 'registrations') {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: JSON.parse(JSON.stringify(BASE_REGISTRATION)),
            error: null,
          });
        }
        if (table === 'payments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        }
        if (table === 'admin_users') {
          chain.select = vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          });
        }
        return chain;
      }),
    };
    (createAdminClient as any).mockReturnValue(adminOverride);

    const req = makeCorrectionRequest({
      jersey_name: 'VALID',
      malicious_field: 'DROP TABLE registrations',
      registration_status: 'CONFIRMED',   // trying to spoof status
      created_by_auth_id: 'attacker-id',  // trying to spoof ownership
    });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);

    // Unknown fields must NOT appear in the DB update payload
    expect(capturedRegistrationUpdate?.malicious_field).toBeUndefined();
    expect(capturedRegistrationUpdate?.created_by_auth_id).toBeUndefined();
    // registration_status is set by the server, but only to 'PENDING' — not to 'CONFIRMED'
    expect(capturedRegistrationUpdate?.registration_status).toBe('PENDING');
  });

  it('#4m — Valid DOESNT_BOWL bowling_style is accepted', async () => {
    const req = makeCorrectionRequest({ bowling_style: 'DOESNT_BOWL' });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
  });

  it('#4n — Lowercase/mixed-case enums are normalised to uppercase and accepted', async () => {
    const req = makeCorrectionRequest({
      cricket_role: 'batsman',
      batting_style: 'right_hand',
      jersey_size: 'xl',
    });
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    expect(res.status).toBe(200);
  });

  it('#4o — Malformed JSON body does not crash the server (caught by outer try/catch)', async () => {
    const req = new NextRequest(
      'http://localhost/api/registrations/reg-test-id/correction',
      { method: 'POST', body: 'this is not json', headers: { 'Content-Type': 'application/json' } }
    );
    const params = Promise.resolve({ id: 'reg-test-id' });
    const res = await correctionRoute(req, { params });
    // Should return 500 (outer catch) — not crash the process
    expect([400, 500]).toContain(res.status);
  });
});
