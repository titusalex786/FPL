/**
 * Payment Screenshot Authorization & Lifecycle Regression Tests
 *
 * Covers:
 * A. Authorized normal Player uploads payment screenshot -> PASS
 * B. Authorized normal Player replaces screenshot -> PASS
 * C. Unauthorized user attempts to upload for another Player -> 403 BLOCKED
 * D. Unauthenticated request -> 401 BLOCKED
 * E. Authorized Owner payment upload -> PASS
 * F. Authorized Icon / teammate payment upload (created_by_auth_id / team owner) -> PASS
 * G. Missing payment row: handled safely with correct fee calculation and rollback on DB failure
 * H. Screenshot upload does not automatically confirm payment (status remains PENDING)
 * I. Resubmission / correction screenshot upload works
 * J. Existing screenshot privacy and private bucket isolation remain intact
 * K. Lookup by registration_number (e.g. REG-2026-0001) works identically to UUID
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as uploadScreenshotApi } from '@/app/api/registrations/[id]/screenshot/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkIsAdmin } from '@/lib/auth/is-admin';
import { uploadToStorageBucket, validateImageFileBuffer } from '@/lib/storage/upload';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/is-admin', () => ({ checkIsAdmin: vi.fn() }));
vi.mock('@/lib/storage/upload', () => ({
  uploadToStorageBucket: vi.fn(),
  validateImageFileBuffer: vi.fn(() => ({ isValid: true, mimeType: 'image/png', extension: 'png' })),
}));
vi.mock('@/lib/notifications/create-notification', () => ({
  sendNotification: vi.fn().mockResolvedValue(true),
}));

const VALID_PNG_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeRequest(regId: string, body: Record<string, unknown>) {
  return {
    req: new NextRequest(`http://localhost/api/registrations/${regId}/screenshot`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id: regId }),
  };
}

describe('Payment Screenshot Authorization & Upload Suite', () => {
  let mockServerAuthUser: any;
  let mockDbStore: Record<string, any>;
  let mockStorageRemoved: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageRemoved = [];
    mockDbStore = {};
    mockServerAuthUser = { id: 'auth-user-player-1', email: 'player1@example.com' };

    (createServerSupabaseClient as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockImplementation(async () => {
          if (!mockServerAuthUser) return { data: { user: null }, error: new Error('No session') };
          return { data: { user: mockServerAuthUser }, error: null };
        }),
      },
    });

    (checkIsAdmin as any).mockResolvedValue({ isAdmin: false, isManager: false });
    (uploadToStorageBucket as any).mockResolvedValue({
      bucket: 'payment-screenshots',
      objectPath: 'tourney-1/reg-1/receipt.png',
    });

    const createChain = (tableName: string) => {
      const chain: any = {
        _table: tableName,
        _filters: {},
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockImplementation((payload: any) => {
          mockDbStore[`${tableName}_last_update`] = payload;
          return chain;
        }),
        insert: vi.fn().mockImplementation((payload: any) => {
          mockDbStore[`${tableName}_last_insert`] = payload;
          if (mockDbStore[`${tableName}_insert_error`]) {
            return Promise.resolve({ error: mockDbStore[`${tableName}_insert_error`] });
          }
          return Promise.resolve({ data: payload, error: null });
        }),
        eq: vi.fn().mockImplementation((col: string, val: any) => {
          chain._filters[col] = val;
          return chain;
        }),
        or: vi.fn().mockImplementation((val: string) => {
          chain._filters['or'] = val;
          return chain;
        }),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          if (tableName === 'registrations') {
            const reg = mockDbStore['registration'];
            if (!reg) return { data: null, error: null };
            // Support lookup by id or registration_number
            if (chain._filters['id'] && reg.id !== chain._filters['id']) {
              return { data: null, error: null };
            }
            if (chain._filters['registration_number'] && reg.registration_number !== chain._filters['registration_number']) {
              return { data: null, error: null };
            }
            return { data: reg, error: null };
          }
          if (tableName === 'players') {
            return { data: mockDbStore['playerProfile'] || null, error: null };
          }
          if (tableName === 'payments') {
            return { data: mockDbStore['existingPayment'] || null, error: null };
          }
          if (tableName === 'tournaments') {
            return { data: mockDbStore['tournament'] || { registration_fee: 50000, owner_registration_fee: 100000 }, error: null };
          }
          if (tableName === 'team_owners') {
            return { data: mockDbStore['teamOwner'] || null, error: null };
          }
          return { data: null, error: null };
        }),
      };
      return chain;
    };

    (createAdminClient as any).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => createChain(table)),
      storage: {
        from: vi.fn().mockImplementation((bucket: string) => ({
          remove: vi.fn().mockImplementation(async (paths: string[]) => {
            mockStorageRemoved.push(...paths);
            return { error: null };
          }),
        })),
      },
    });
  });

  // A. Authorized normal Player uploads a payment screenshot: PASS
  it('A. Authorized normal Player who created the registration uploads screenshot successfully', async () => {
    mockDbStore['registration'] = {
      id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      tournament_id: 'tourney-1',
      player_id: 'player-db-1',
      registration_number: 'REG-2026-0001',
      registration_type: 'PLAYER',
      registered_name_snapshot: 'Rohit Sharma',
      created_by_auth_id: 'auth-user-player-1',
      player: { id: 'player-db-1', auth_user_id: 'auth-user-player-1', email: 'player1@example.com' },
    };
    mockDbStore['playerProfile'] = { id: 'player-db-1' };
    mockDbStore['existingPayment'] = null; // New payment

    const { req, params } = makeRequest('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', {
      screenshotBase64: VALID_PNG_BASE64,
      transactionReference: 'UPI-123456789',
    });

    const res = await uploadScreenshotApi(req, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.registrationId).toBe('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d');
    expect(uploadToStorageBucket).toHaveBeenCalledWith(
      'payment-screenshots',
      expect.stringContaining('tourney-1/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d/'),
      expect.any(Buffer),
      'image/png'
    );
    expect(mockDbStore['payments_last_insert']).toBeDefined();
    expect(mockDbStore['payments_last_insert'].payment_status).toBe('PENDING');
  });

  // B. Authorized normal Player replaces an existing screenshot: PASS
  it('B. Authorized normal Player replaces an existing screenshot (updates payment to PENDING)', async () => {
    mockDbStore['registration'] = {
      id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      tournament_id: 'tourney-1',
      player_id: 'player-db-1',
      registration_number: 'REG-2026-0001',
      registration_type: 'PLAYER',
      registered_name_snapshot: 'Rohit Sharma',
      created_by_auth_id: 'auth-user-player-1',
      player: { id: 'player-db-1', auth_user_id: 'auth-user-player-1', email: 'player1@example.com' },
    };
    mockDbStore['playerProfile'] = { id: 'player-db-1' };
    mockDbStore['existingPayment'] = { id: 'payment-existing-1', payment_status: 'PENDING' };

    const { req, params } = makeRequest('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', {
      screenshotBase64: VALID_PNG_BASE64,
      transactionReference: 'UPI-9999888877',
    });

    const res = await uploadScreenshotApi(req, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockDbStore['payments_last_update']).toBeDefined();
    expect(mockDbStore['payments_last_update'].transaction_reference).toBe('UPI-9999888877');
    expect(mockDbStore['payments_last_update'].payment_status).toBe('PENDING');
  });

  // C. Unauthorized user attempts to upload for another Player: BLOCKED
  it('C. Unauthorized attacker is strictly BLOCKED from uploading screenshot for another player', async () => {
    // Authenticated as attacker
    mockServerAuthUser = { id: 'attacker-auth-id', email: 'attacker@example.com' };
    mockDbStore['playerProfile'] = { id: 'attacker-player-id' };

    // Registration belongs to legitimate victim
    mockDbStore['registration'] = {
      id: 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e',
      tournament_id: 'tourney-1',
      player_id: 'victim-player-id',
      registration_number: 'REG-2026-9999',
      registration_type: 'PLAYER',
      registered_name_snapshot: 'Victim Player',
      created_by_auth_id: 'legitimate-creator-auth-id',
      player: { id: 'victim-player-id', auth_user_id: 'victim-auth-id', email: 'victim@example.com' },
    };

    const { req, params } = makeRequest('b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e', {
      screenshotBase64: VALID_PNG_BASE64,
      transactionReference: 'UPI-111222333',
    });

    const res = await uploadScreenshotApi(req, { params });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('You are not authorized to upload a screenshot for this registration');
    expect(uploadToStorageBucket).not.toHaveBeenCalled();
  });

  // D. Unauthenticated request: BLOCKED
  it('D. Unauthenticated request is BLOCKED with 401', async () => {
    mockServerAuthUser = null; // No session

    const { req, params } = makeRequest('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', {
      screenshotBase64: VALID_PNG_BASE64,
      transactionReference: 'UPI-111222333',
    });

    const res = await uploadScreenshotApi(req, { params });
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Authentication required');
    expect(uploadToStorageBucket).not.toHaveBeenCalled();
  });

  // E. Authorized Owner payment upload: PASS
  it('E. Authorized Team Owner uploads screenshot for OWNER registration: PASS', async () => {
    mockServerAuthUser = { id: 'owner-auth-id', email: 'owner@franchise.com' };
    mockDbStore['playerProfile'] = { id: 'owner-player-id' };
    mockDbStore['registration'] = {
      id: 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f',
      tournament_id: 'tourney-1',
      player_id: 'owner-player-id',
      registration_number: 'REG-2026-OWN-01',
      registration_type: 'OWNER',
      registered_name_snapshot: 'Team Owner Person',
      created_by_auth_id: 'owner-auth-id',
      player: { id: 'owner-player-id', auth_user_id: 'owner-auth-id', email: 'owner@franchise.com' },
    };
    mockDbStore['tournament'] = { registration_fee: 50000, owner_registration_fee: 100000 };

    const { req, params } = makeRequest('c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f', {
      screenshotBase64: VALID_PNG_BASE64,
      transactionReference: 'UPI-OWNER-998877',
    });

    const res = await uploadScreenshotApi(req, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockDbStore['payments_last_insert'].amount).toBe(150000); // 50000 player + 100000 owner
  });

  // F. Authorized Icon/combined Owner payment flow: PASS
  it('F. Authorized Team Owner uploads screenshot for Icon registration (where creator is owner): PASS', async () => {
    mockServerAuthUser = { id: 'owner-auth-id', email: 'owner@franchise.com' };
    mockDbStore['playerProfile'] = { id: 'owner-player-id' };

    // Icon player has a different player_id, but was created by owner
    mockDbStore['registration'] = {
      id: 'd4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a',
      tournament_id: 'tourney-1',
      player_id: 'icon-player-id', // DIFFERENT from owner-player-id
      registration_number: 'REG-2026-ICON-01',
      registration_type: 'ICON',
      registered_name_snapshot: 'Star Icon Player',
      created_by_auth_id: 'owner-auth-id', // OWNER CREATED IT
      player: { id: 'icon-player-id', auth_user_id: null, email: null },
    };

    const { req, params } = makeRequest('d4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a', {
      screenshotBase64: VALID_PNG_BASE64,
      transactionReference: 'UPI-ICON-776655',
    });

    const res = await uploadScreenshotApi(req, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  // F2. Authorized Teammate registration: PASS
  it('F2. Authorized user who registered a teammate (targetType: OTHER) can upload payment screenshot', async () => {
    mockServerAuthUser = { id: 'captain-auth-id', email: 'captain@example.com' };
    mockDbStore['playerProfile'] = { id: 'captain-player-id' };

    // Teammate has their own tournament-only player row
    mockDbStore['registration'] = {
      id: 'e5f6a7b8-c9d0-1e2f-3a4b-5c6d7e8f9a0b',
      tournament_id: 'tourney-1',
      player_id: 'teammate-player-id',
      registration_number: 'REG-2026-TEAM-01',
      registration_type: 'PLAYER',
      registered_name_snapshot: 'Teammate Rahul',
      created_by_auth_id: 'captain-auth-id', // CAPTAIN CREATED IT
      player: { id: 'teammate-player-id', auth_user_id: null, email: 'teammate@example.com' },
    };

    const { req, params } = makeRequest('e5f6a7b8-c9d0-1e2f-3a4b-5c6d7e8f9a0b', {
      screenshotBase64: VALID_PNG_BASE64,
      transactionReference: 'UPI-TEAM-332211',
    });

    const res = await uploadScreenshotApi(req, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  // G. Missing payment row: rollback storage object on DB failure to prevent orphans
  it('G. Storage object is rolled back and removed if database insert fails', async () => {
    mockDbStore['registration'] = {
      id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      tournament_id: 'tourney-1',
      player_id: 'player-db-1',
      registration_number: 'REG-2026-0001',
      registration_type: 'PLAYER',
      registered_name_snapshot: 'Rohit Sharma',
      created_by_auth_id: 'auth-user-player-1',
      player: { id: 'player-db-1', auth_user_id: 'auth-user-player-1', email: 'player1@example.com' },
    };
    mockDbStore['existingPayment'] = null;
    mockDbStore['payments_insert_error'] = { message: 'Database constraint violation' };

    const { req, params } = makeRequest('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', {
      screenshotBase64: VALID_PNG_BASE64,
      transactionReference: 'UPI-123456789',
    });

    const res = await uploadScreenshotApi(req, { params });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Failed to create payment record');
    // Confirms uploaded object was cleaned up from storage
    expect(mockStorageRemoved.length).toBeGreaterThan(0);
  });

  // H. Screenshot upload does not automatically confirm payment
  it('H. Screenshot upload sets payment_status strictly to PENDING, never SUCCESSFUL', async () => {
    mockDbStore['registration'] = {
      id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      tournament_id: 'tourney-1',
      player_id: 'player-db-1',
      registration_number: 'REG-2026-0001',
      registration_type: 'PLAYER',
      registered_name_snapshot: 'Rohit Sharma',
      created_by_auth_id: 'auth-user-player-1',
      player: { id: 'player-db-1', auth_user_id: 'auth-user-player-1', email: 'player1@example.com' },
    };

    const { req, params } = makeRequest('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', {
      screenshotBase64: VALID_PNG_BASE64,
      transactionReference: 'UPI-123456789',
    });

    const res = await uploadScreenshotApi(req, { params });
    expect(res.status).toBe(200);

    expect(mockDbStore['payments_last_insert'].payment_status).toBe('PENDING');
    expect(mockDbStore['payments_last_insert'].payment_status).not.toBe('SUCCESSFUL');
    expect(mockDbStore['registrations_last_update'].registration_status).toBe('PENDING');
    expect(mockDbStore['registrations_last_update'].registration_status).not.toBe('CONFIRMED');
  });

  // I. Lookup by registration_number (e.g. REG-2026-0001) works identically to UUID
  it('I. Lookup by registration_number resolves properly and links payment with canonical UUID', async () => {
    mockDbStore['registration'] = {
      id: '00000000-0000-0000-0000-000000000001',
      tournament_id: 'tourney-1',
      player_id: 'player-db-1',
      registration_number: 'REG-2026-0001',
      registration_type: 'PLAYER',
      registered_name_snapshot: 'Rohit Sharma',
      created_by_auth_id: 'auth-user-player-1',
      player: { id: 'player-db-1', auth_user_id: 'auth-user-player-1', email: 'player1@example.com' },
    };

    const { req, params } = makeRequest('REG-2026-0001', {
      screenshotBase64: VALID_PNG_BASE64,
      transactionReference: 'UPI-REG-NUMBER-TEST',
    });

    const res = await uploadScreenshotApi(req, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // Verified that canonical UUID is returned and used
    expect(json.registrationId).toBe('00000000-0000-0000-0000-000000000001');
    expect(mockDbStore['payments_last_insert'].registration_id).toBe('00000000-0000-0000-0000-000000000001');
  });

  // J. Existing screenshot privacy and validation remain intact
  it('J. Raw external URLs are rejected to protect storage integrity and privacy', async () => {
    const { req, params } = makeRequest('reg-uuid-1', {
      screenshotUrl: 'https://arbitrary-attacker-site.com/fake.png',
      transactionReference: 'UPI-123456789',
    });

    const res = await uploadScreenshotApi(req, { params });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Arbitrary external screenshot URLs are not allowed');
    expect(uploadToStorageBucket).not.toHaveBeenCalled();
  });
});
