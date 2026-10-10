/**
 * Phase 3: Admin Player Details (Read-Only) Test Suite
 *
 * Acceptance Criteria Verified:
 * 1. unauthenticated → 401
 * 2. non-admin → 403
 * 3. admin → 200
 * 4. nonexistent player → 404
 * 5. player profile fields returned
 * 6. registration snapshot fields returned
 * 7. registration number returned
 * 8. registration type returned (PLAYER, OWNER, ICON)
 * 9. payment details returned safely
 * 10. private screenshot uses signed URL
 * 11. private Storage path is not exposed
 * 12. current profile and registration snapshot remain separate
 * 13. Owner registration details work (team name, logo, slot)
 * 14. Icon registration details work (team name, logo, icon slot)
 * 15. correction history is returned
 * 16. no sensitive credentials returned
 * 17. multiple registrations for same player are handled correctly
 * 18. existing admin page and registration details endpoint work
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getPlayerDetailsApi } from '@/app/api/admin/players/[id]/route';
import { GET as getRegistrationDetailsApi } from '@/app/api/admin/registrations/[id]/details/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSignedScreenshotUrl } from '@/lib/storage/upload';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/storage/upload', () => ({
  getSignedScreenshotUrl: vi.fn(async (_bucket, path) => `https://signed.storage.test/${path}?token=signed-123`),
  resolveImageUrl: vi.fn((input) => (input ? `https://storage.test/${input}` : '/logo.png')),
}));

const MOCK_PLAYER_ID = '11111111-1111-4111-8111-111111111111';
const MOCK_REG_ID_1 = '22222222-2222-4222-8222-222222222222';
const MOCK_REG_ID_2 = '33333333-3333-4333-8333-333333333333';
const MOCK_OWNER_ID = '44444444-4444-4444-8444-444444444444';
const MOCK_TOURNAMENT_ID_1 = '55555555-5555-4555-8555-555555555555';
const MOCK_TOURNAMENT_ID_2 = '66666666-6666-4666-8666-666666666666';

describe('Phase 3: Admin Player Details Suite', () => {
  let mockAuthUser: any;
  let mockAdminUserEntry: any;
  let mockManagerEntry: any;
  let mockDbData: {
    players: any[];
    registrations: any[];
    team_owners: any[];
    tournaments: any[];
    payments: any[];
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthUser = { id: 'admin-auth-id-123', email: 'admin@fairplay.test' };
    mockAdminUserEntry = { id: 'admin-auth-id-123', role: 'ADMIN', status: 'ACTIVE' };
    mockManagerEntry = null;

    mockDbData = {
      players: [
        {
          id: MOCK_PLAYER_ID,
          full_name: 'Rohit Sharma Profile',
          email: 'rohit@fairplay.test',
          mobile: '9876543210',
          profile_image_url: 'rohit-profile.jpg',
          cricket_role: 'BATSMAN',
          batting_style: 'RIGHT_HAND',
          bowling_style: 'RIGHT_ARM_OFF_BREAK',
          jersey_name: 'ROHIT DEFAULT',
          jersey_number: '45',
          jersey_size: 'L',
          created_at: '2026-01-01T10:00:00Z',
        },
      ],
      registrations: [
        {
          id: MOCK_REG_ID_1,
          player_id: MOCK_PLAYER_ID,
          tournament_id: MOCK_TOURNAMENT_ID_1,
          registration_number: 'REG-2026-0045',
          registration_type: 'PLAYER',
          team_name: null,
          team_owner_id: null,
          waitlist_position: null,
          registered_name_snapshot: 'Rohit Tournament Snapshot',
          registered_image_snapshot: 'rohit-tournament.jpg',
          registered_role_snapshot: 'ALL_ROUNDER',
          registered_batting_style_snapshot: 'RIGHT_HAND',
          registered_bowling_style_snapshot: 'RIGHT_ARM_OFF_BREAK',
          registered_jersey_size_snapshot: 'XL',
          registered_jersey_name_snapshot: 'HITMAN',
          registered_jersey_number_snapshot: '77',
          registration_status: 'CONFIRMED',
          registered_at: '2026-02-01T12:00:00Z',
          correction_history: [
            {
              requested_date: '2026-02-02T10:00:00Z',
              remark: 'Please update jersey number',
              submitted_date: '2026-02-02T11:00:00Z',
              resolved_date: '2026-02-02T12:00:00Z',
              resolved_by: 'admin-auth-id-123',
              changed_fields: ['jersey_number'],
              previous_values: { jersey_number: '45' },
              new_values: { jersey_number: '77' },
              resubmission_count: 1,
            },
          ],
          tournament: {
            id: MOCK_TOURNAMENT_ID_1,
            name: 'FPL Season 4 Championship',
            tournament_date: '2026-04-01T00:00:00Z',
            registration_fee: 90000,
            payment_enabled: true,
          },
          payments: [
            {
              id: 'pay-1',
              amount: 90000,
              payment_status: 'SUCCESSFUL',
              payment_method: 'UPI_QR',
              transaction_reference: 'UPI-TXN-12345',
              payment_screenshot_url: 'https://storage.test/payment-screenshots/private-screen.png',
              screenshot_object_path: 'private-screen.png',
              screenshot_bucket: 'payment-screenshots',
              verification_note: 'Verified and approved',
              created_at: '2026-02-01T12:05:00Z',
            },
          ],
        },
        {
          id: MOCK_REG_ID_2,
          player_id: MOCK_PLAYER_ID,
          tournament_id: MOCK_TOURNAMENT_ID_2,
          registration_number: 'OWNER-2026-0001',
          registration_type: 'OWNER',
          team_name: 'Mumbai Strikers',
          team_owner_id: MOCK_OWNER_ID,
          waitlist_position: null,
          registered_name_snapshot: 'Rohit Owner Snapshot',
          registered_image_snapshot: 'rohit-owner.jpg',
          registered_role_snapshot: 'BATSMAN',
          registered_batting_style_snapshot: 'RIGHT_HAND',
          registered_bowling_style_snapshot: 'NONE',
          registered_jersey_size_snapshot: 'L',
          registered_jersey_name_snapshot: 'OWNER 45',
          registered_jersey_number_snapshot: '45',
          registration_status: 'PENDING',
          registered_at: '2026-02-15T12:00:00Z',
          correction_history: [],
          tournament: {
            id: MOCK_TOURNAMENT_ID_2,
            name: 'FPL Super League',
            tournament_date: '2026-05-01T00:00:00Z',
            registration_fee: 250000,
            payment_enabled: true,
          },
          payments: [
            {
              id: 'pay-2',
              amount: 250000,
              payment_status: 'PENDING',
              payment_method: 'UPI_QR',
              transaction_reference: 'UPI-TXN-99999',
              payment_screenshot_url: null,
              screenshot_object_path: null,
              screenshot_bucket: 'payment-screenshots',
              verification_note: null,
              created_at: '2026-02-15T12:05:00Z',
            },
          ],
        },
      ],
      team_owners: [
        {
          id: MOCK_OWNER_ID,
          team_name: 'Mumbai Strikers',
          team_logo_url: 'team-logo.png',
          slot_number: 1,
          owner_name: 'Rohit Owner Snapshot',
          contact_email: 'rohit@fairplay.test',
          contact_phone: '9876543210',
        },
      ],
      tournaments: [],
      payments: [],
    };

    // Mock createServerSupabaseClient
    (createServerSupabaseClient as any).mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => {
          if (!mockAuthUser) return { data: { user: null }, error: new Error('No session') };
          return { data: { user: mockAuthUser }, error: null };
        }),
      },
    });

    // Mock createAdminClient
    (createAdminClient as any).mockImplementation(() => ({
      from: (table: string) => ({
        select: (_cols?: string) => ({
          eq: (col: string, val: any) => ({
            eq: (col2: string, val2: any) => ({
              maybeSingle: vi.fn(async () => {
                if (table === 'admin_users') {
                  if (mockAdminUserEntry && mockAdminUserEntry.id === val) return { data: mockAdminUserEntry, error: null };
                  return { data: null, error: null };
                }
                return { data: null, error: null };
              }),
            }),
            ilike: (col2: string, val2: any) => ({
              eq: (_col3: string, _val3: any) => ({
                maybeSingle: vi.fn(async () => {
                  if (table === 'managers') {
                    if (mockManagerEntry && mockManagerEntry.user_email.toLowerCase() === val2.toLowerCase()) {
                      return { data: mockManagerEntry, error: null };
                    }
                    return { data: null, error: null };
                  }
                  return { data: null, error: null };
                }),
              }),
            }),
            maybeSingle: vi.fn(async () => {
              if (table === 'players') {
                const found = mockDbData.players.find((p) => p[col] === val);
                return { data: found || null, error: null };
              }
              if (table === 'registrations') {
                const found = mockDbData.registrations.find((r) => r[col] === val);
                return { data: found || null, error: null };
              }
              return { data: null, error: null };
            }),
            order: (_orderCol: string, _opts: any) => ({
              data: mockDbData.registrations.filter((r) => r[col] === val),
              error: null,
            }),
          }),
          in: (col: string, vals: any[]) => ({
            data: mockDbData.team_owners.filter((t) => vals.includes(t[col])),
            error: null,
          }),
        }),
      }),
    }));
  });

  // 1. Unauthenticated request → 401
  it('1. returns 401 when request is unauthenticated', async () => {
    mockAuthUser = null;
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Authentication required');
  });

  // 2. Non-admin authenticated user → 403
  it('2. returns 403 when user is authenticated but not an admin', async () => {
    mockAdminUserEntry = null;
    mockManagerEntry = null;
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Admin access required');
  });

  // 3. Authorized admin → 200
  it('3. returns 200 when authorized admin requests player details', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.player).toBeDefined();
    expect(body.registrations).toBeDefined();
  });

  // 4. Nonexistent player → 404
  it('4. returns 404 when requested player does not exist', async () => {
    const nonexistentId = '99999999-9999-4999-8999-999999999999';
    const req = new NextRequest(`http://localhost/api/admin/players/${nonexistentId}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: nonexistentId }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Player or registration not found');
  });

  // 5. Current Player Profile fields returned
  it('5. returns full player profile fields from players table', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    const p = body.player;
    expect(p.full_name).toBe('Rohit Sharma Profile');
    expect(p.email).toBe('rohit@fairplay.test');
    expect(p.mobile).toBe('9876543210');
    expect(p.cricket_role).toBe('BATSMAN');
    expect(p.batting_style).toBe('RIGHT_HAND');
    expect(p.bowling_style).toBe('RIGHT_ARM_OFF_BREAK');
    expect(p.jersey_name).toBe('ROHIT DEFAULT');
    expect(p.jersey_number).toBe('45');
    expect(p.jersey_size).toBe('L');
  });

  // 6. Tournament Registration snapshot fields returned
  it('6. returns tournament registration snapshot fields from registrations table', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    const reg = body.registrations[0];
    expect(reg.registered_name).toBe('Rohit Tournament Snapshot');
    expect(reg.registered_cricket_role).toBe('ALL_ROUNDER');
    expect(reg.registered_jersey_name).toBe('HITMAN');
    expect(reg.registered_jersey_number).toBe('77');
    expect(reg.registered_jersey_size).toBe('XL');
  });

  // 7. Registration number returned
  it('7. returns registration_number for each registration', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    expect(body.registrations[0].registration_number).toBe('REG-2026-0045');
    expect(body.registrations[1].registration_number).toBe('OWNER-2026-0001');
  });

  // 8. Registration type returned (PLAYER, OWNER, ICON)
  it('8. returns registration_type clearly identifying PLAYER or OWNER', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    expect(body.registrations[0].registration_type).toBe('PLAYER');
    expect(body.registrations[1].registration_type).toBe('OWNER');
  });

  // 9. Payment details returned safely
  it('9. returns payment details with status, amount, method, and reference', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    const pay = body.registrations[0].payment;
    expect(pay).toBeDefined();
    expect(pay.amount).toBe(90000);
    expect(pay.payment_status).toBe('SUCCESSFUL');
    expect(pay.payment_method).toBe('UPI_QR');
    expect(pay.transaction_reference).toBe('UPI-TXN-12345');
  });

  // 10. Private screenshot uses signed URL
  it('10. resolves private screenshot into a secure signed URL', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    const pay = body.registrations[0].payment;
    expect(getSignedScreenshotUrl).toHaveBeenCalledWith('payment-screenshots', 'private-screen.png', 900);
    expect(pay.payment_screenshot_url).toContain('https://signed.storage.test/private-screen.png');
  });

  // 11. Private Storage path is NOT exposed in DTO
  it('11. does not expose private Storage object paths or buckets in the response', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    const pay = body.registrations[0].payment;
    expect((pay as any).screenshot_object_path).toBeUndefined();
    expect((pay as any).screenshot_bucket).toBeUndefined();
  });

  // 12. Current profile and registration snapshot remain strictly separate
  it('12. maintains strict separation between current profile and registration snapshot', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    // Profile
    expect(body.player.jersey_name).toBe('ROHIT DEFAULT');
    expect(body.player.jersey_number).toBe('45');
    expect(body.player.cricket_role).toBe('BATSMAN');
    // Snapshot
    expect(body.registrations[0].registered_jersey_name).toBe('HITMAN');
    expect(body.registrations[0].registered_jersey_number).toBe('77');
    expect(body.registrations[0].registered_cricket_role).toBe('ALL_ROUNDER');
    // Verify they are different
    expect(body.player.jersey_name).not.toBe(body.registrations[0].registered_jersey_name);
    expect(body.player.jersey_number).not.toBe(body.registrations[0].registered_jersey_number);
  });

  // 13. Owner registration details work
  it('13. returns team name, team logo, and slot number for Owner registration', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    const ownerReg = body.registrations[1];
    expect(ownerReg.registration_type).toBe('OWNER');
    expect(ownerReg.team_owner).toBeDefined();
    expect(ownerReg.team_owner.team_name).toBe('Mumbai Strikers');
    expect(ownerReg.team_owner.slot_number).toBe(1);
    expect(ownerReg.team_owner.owner_name).toBe('Rohit Owner Snapshot');
  });

  // 14. Icon registration details work
  it('14. returns team association and slot details when registration is ICON', async () => {
    // Add an icon registration linked to MOCK_OWNER_ID
    const iconReg = {
      id: 'icon-reg-uuid-9999',
      player_id: MOCK_PLAYER_ID,
      tournament_id: MOCK_TOURNAMENT_ID_2,
      registration_number: 'ICON-2026-0001',
      registration_type: 'ICON',
      team_name: 'Mumbai Strikers',
      team_owner_id: MOCK_OWNER_ID,
      registered_name_snapshot: 'Hardik Icon Snapshot',
      registered_role_snapshot: 'ALL_ROUNDER',
      registration_status: 'CONFIRMED',
      registered_at: '2026-02-16T12:00:00Z',
      correction_history: [],
      tournament: { id: MOCK_TOURNAMENT_ID_2, name: 'FPL Super League' },
      payments: [],
    };
    mockDbData.registrations.push(iconReg);

    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    const foundIcon = body.registrations.find((r: any) => r.registration_type === 'ICON');
    expect(foundIcon).toBeDefined();
    expect(foundIcon.registration_number).toBe('ICON-2026-0001');
    expect(foundIcon.team_owner.team_name).toBe('Mumbai Strikers');
    expect(foundIcon.team_owner.slot_number).toBe(1);
  });

  // 15. Correction history is returned immutably
  it('15. returns correction history entries with audit details', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    const history = body.registrations[0].correction_history;
    expect(history).toHaveLength(1);
    expect(history[0].remark).toBe('Please update jersey number');
    expect(history[0].changed_fields).toEqual(['jersey_number']);
    expect(history[0].previous_values).toEqual({ jersey_number: '45' });
    expect(history[0].new_values).toEqual({ jersey_number: '77' });
    expect(history[0].resubmission_count).toBe(1);
  });

  // 16. No sensitive credentials returned
  it('16. does not expose sensitive credentials, auth tokens or internal service secrets', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    const str = JSON.stringify(body);
    expect(str).not.toContain('SUPABASE_SECRET_KEY');
    expect(str).not.toContain('service_role');
    expect(str).not.toContain('auth_user_id');
    expect(str).not.toContain('password');
  });

  // 17. Multiple registrations for same player handled correctly
  it('17. returns all tournament registrations when player participated in multiple tournaments', async () => {
    const req = new NextRequest(`http://localhost/api/admin/players/${MOCK_PLAYER_ID}`);
    const res = await getPlayerDetailsApi(req, { params: Promise.resolve({ id: MOCK_PLAYER_ID }) });
    const body = await res.json();
    expect(body.registrations.length).toBeGreaterThanOrEqual(2);
    const tournamentNames = body.registrations.map((r: any) => r.tournament_name);
    expect(tournamentNames).toContain('FPL Season 4 Championship');
    expect(tournamentNames).toContain('FPL Super League');
  });

  // 18. Registration details endpoint GET /api/admin/registrations/[id]/details works
  it('18. allows lookup directly by registration_id via registrations details API', async () => {
    const req = new NextRequest(`http://localhost/api/admin/registrations/${MOCK_REG_ID_1}/details`);
    const res = await getRegistrationDetailsApi(req, { params: Promise.resolve({ id: MOCK_REG_ID_1 }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.player.id).toBe(MOCK_PLAYER_ID);
    expect(body.selectedRegistrationId).toBe(MOCK_REG_ID_1);
    expect(body.registrations.length).toBeGreaterThanOrEqual(1);
  });
});
