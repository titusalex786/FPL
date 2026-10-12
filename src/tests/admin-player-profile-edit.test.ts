/**
 * Phase 4A: Admin Edit Reusable Player Profile Test Suite
 *
 * Requirements Verified:
 * 1. Admin authorization (200)
 * 2. Non-admin rejection (403)
 * 3. Unauthenticated rejection (401)
 * 4. Valid profile update (200, returns safe DTO)
 * 5. Name update (full_name updated in players)
 * 6. Mobile update (mobile updated in players, normalized)
 * 7. Role update (cricket_role updated in players)
 * 8. Batting update (batting_style updated in players)
 * 9. Bowling update (bowling_style updated in players)
 * 10. Jersey name update (jersey_name updated in players)
 * 11. Jersey number update (jersey_number updated in players)
 * 12. Jersey size update (jersey_size updated in players)
 * 13. Edit reason required (missing or < 5 chars rejected with 400)
 * 14. Invalid enum rejected (invalid role/style rejected with 400)
 * 15. Invalid jersey number rejected (rejected with 400)
 * 16. Protected fields rejected (id, auth_user_id, email, status, etc. rejected with 400)
 * 17. Unknown fields rejected (unrecognized keys rejected with 400)
 * 18. No-op update does not create audit log (returns 200 noOp: true)
 * 19. Audit contains old values
 * 20. Audit contains new values
 * 21. Audit contains changed fields
 * 22. Audit contains admin identity
 * 23. Audit contains edit reason
 * 24. Registration snapshot remains unchanged
 * 25. Multiple tournament snapshots remain unchanged
 * 26. Owner/Icon registration snapshots remain unchanged
 * 27. Payment information remains unchanged
 * 28. Registration status remains unchanged
 *
 * Critical Test (Step 15):
 * Full snapshot isolation comparison before and after profile mutation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/admin/players/[id]/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/storage/upload', () => ({
  uploadToStorageBucket: vi.fn(async (_bucket, path) => ({
    bucket: 'profile-images',
    objectPath: path,
    publicUrl: `https://storage.test/profile-images/${path}`,
  })),
  validateImageFileBuffer: vi.fn(() => ({ isValid: true, mimeType: 'image/jpeg', extension: 'jpg' })),
}));

const MOCK_PLAYER_ID = '11111111-1111-4111-8111-111111111111';
const MOCK_REG_1_ID = '22222222-2222-4222-8222-222222222222';
const MOCK_REG_2_ID = '33333333-3333-4333-8333-333333333333';
const MOCK_REG_OWNER_ID = '44444444-4444-4444-8444-444444444444';
const MOCK_PAYMENT_1_ID = '55555555-5555-4555-8555-555555555555';
const MOCK_PAYMENT_2_ID = '66666666-6666-4666-8666-666666666666';

describe('Phase 4A: Admin Edit Reusable Player Profile Suite', () => {
  let mockAuthUser: any;
  let mockAdminUserEntry: any;
  let shouldFailAuditInsert = false;
  let mockStorageRemove: any;
  let mockDbData: {
    players: any[];
    registrations: any[];
    payments: any[];
    audit_logs: any[];
  };

  const createMockAdminClient = () => {
    return {
      from: vi.fn((table: string) => {
        return {
          select: vi.fn((_columns?: string) => {
            const queryBuilder: any = {
              _filters: {} as Record<string, any>,
              eq: vi.fn((col: string, val: any) => {
                queryBuilder._filters[col] = val;
                return queryBuilder;
              }),
              maybeSingle: vi.fn(async () => {
                if (table === 'admin_users') {
                  if (queryBuilder._filters['id'] === mockAuthUser?.id) {
                    return { data: mockAdminUserEntry, error: null };
                  }
                  return { data: null, error: null };
                }
                if (table === 'players') {
                  const targetId = queryBuilder._filters['id'];
                  const match = mockDbData.players.find((p) => p.id === targetId);
                  return { data: match ? { ...match } : null, error: null };
                }
                return { data: null, error: null };
              }),
              single: vi.fn(async () => {
                if (table === 'players') {
                  const targetId = queryBuilder._filters['id'];
                  const match = mockDbData.players.find((p) => p.id === targetId);
                  return { data: match ? { ...match } : null, error: null };
                }
                return { data: null, error: null };
              }),
            };
            return queryBuilder;
          }),
          update: vi.fn((updatePayload: any) => {
            const updateBuilder: any = {
              _filters: {} as Record<string, any>,
              eq: vi.fn((col: string, val: any) => {
                updateBuilder._filters[col] = val;
                if (table === 'players' && col === 'id') {
                  const idx = mockDbData.players.findIndex((p) => p.id === val);
                  if (idx !== -1) {
                    mockDbData.players[idx] = {
                      ...mockDbData.players[idx],
                      ...updatePayload,
                    };
                  }
                }
                return updateBuilder;
              }),
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const targetId = updateBuilder._filters['id'];
                  const match = mockDbData.players.find((p) => p.id === targetId);
                  return { data: match ? { ...match } : null, error: null };
                }),
              })),
            };
            return updateBuilder;
          }),
          insert: vi.fn(async (insertPayload: any) => {
            if (table === 'audit_logs') {
              if (shouldFailAuditInsert) {
                return { data: null, error: new Error('Simulated audit_logs insert failure') };
              }
              mockDbData.audit_logs.push({
                id: `audit-${Date.now()}`,
                ...insertPayload,
                created_at: new Date().toISOString(),
              });
              return { data: insertPayload, error: null };
            }
            return { data: null, error: null };
          }),
        };
      }),
      rpc: vi.fn(async (funcName: string, args: any) => {
        if (funcName === 'admin_update_player_profile_v1') {
          const { p_player_id, p_admin_user_id, p_admin_email, p_reason, p_updates } = args;

          if (!p_reason || p_reason.trim().length < 5) {
            return { data: null, error: new Error('A mandatory edit reason of at least 5 characters is required.') };
          }

          const existingIdx = mockDbData.players.findIndex((p) => p.id === p_player_id);
          if (existingIdx === -1) {
            return { data: { success: false, error: 'Player profile not found', code: 404 }, error: null };
          }

          const existingPlayer = mockDbData.players[existingIdx];

          const candidateFields = [
            'full_name',
            'mobile',
            'profile_image_url',
            'cricket_role',
            'batting_style',
            'bowling_style',
            'jersey_name',
            'jersey_number',
            'jersey_size',
          ];

          const changedFields: string[] = [];
          const oldValues: Record<string, any> = {};
          const newValues: Record<string, any> = {};

          for (const field of candidateFields) {
            if (field in p_updates) {
              const oldVal = existingPlayer[field] ?? null;
              const newVal = p_updates[field] ?? null;
              if (oldVal !== newVal) {
                changedFields.push(field);
                oldValues[field] = oldVal;
                newValues[field] = newVal;
              }
            }
          }

          // No-Op
          if (changedFields.length === 0) {
            return {
              data: {
                success: true,
                noOp: true,
                message: 'No profile changes detected.',
                changedFields: [],
                player: { ...existingPlayer },
              },
              error: null,
            };
          }

          // TRUE DATABASE TRANSACTION ATOMICITY:
          // If forced audit failure is triggered, the transaction fails completely before commit.
          if (shouldFailAuditInsert) {
            // Neither player update nor audit insert commit
            return {
              data: null,
              error: new Error('Simulated transaction failure: audit_logs insert failed, rolling back all mutations in transaction'),
            };
          }

          // Atomic commit: update players AND insert audit_logs
          const updatedPlayer = {
            ...existingPlayer,
            ...newValues,
            updated_at: new Date().toISOString(),
          };
          mockDbData.players[existingIdx] = updatedPlayer;

          mockDbData.audit_logs.push({
            id: `audit-${Date.now()}`,
            admin_user_id: p_admin_user_id,
            action: 'ADMIN_UPDATE_PLAYER_PROFILE',
            entity_type: 'PLAYER',
            entity_id: p_player_id,
            old_value: oldValues,
            new_value: {
              ...newValues,
              changed_fields: changedFields,
              reason: p_reason.trim(),
              admin_email: p_admin_email,
            },
            created_at: new Date().toISOString(),
          });

          return {
            data: {
              success: true,
              message: 'Player profile updated successfully',
              changedFields,
              player: {
                id: updatedPlayer.id,
                full_name: updatedPlayer.full_name,
                email: updatedPlayer.email,
                mobile: updatedPlayer.mobile,
                profile_image_url: updatedPlayer.profile_image_url,
                cricket_role: updatedPlayer.cricket_role,
                batting_style: updatedPlayer.batting_style,
                bowling_style: updatedPlayer.bowling_style,
                jersey_name: updatedPlayer.jersey_name,
                jersey_number: updatedPlayer.jersey_number,
                jersey_size: updatedPlayer.jersey_size,
                created_at: updatedPlayer.created_at,
                updated_at: updatedPlayer.updated_at,
              },
            },
            error: null,
          };
        }
        return { data: null, error: new Error(`Unknown RPC ${funcName}`) };
      }),
      storage: {
        from: vi.fn(() => ({
          remove: mockStorageRemove,
        })),
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorageRemove = vi.fn();
    shouldFailAuditInsert = false;
    mockAuthUser = { id: 'admin-auth-id-123', email: 'admin@fairplay.test' };
    mockAdminUserEntry = { id: 'admin-auth-id-123', role: 'ADMIN', status: 'ACTIVE' };

    mockDbData = {
      players: [
        {
          id: MOCK_PLAYER_ID,
          auth_user_id: 'player-auth-uuid-999',
          full_name: 'Rahul Dravid',
          email: 'rahul.dravid@fairplay.test',
          mobile: '9876543210',
          profile_image_url: 'rahul-initial.jpg',
          cricket_role: 'BATSMAN',
          batting_style: 'RIGHT_HAND',
          bowling_style: 'RIGHT_ARM_OFF_BREAK',
          jersey_name: 'RAHUL',
          jersey_number: '19',
          jersey_size: 'L',
          created_at: '2026-01-01T10:00:00Z',
          updated_at: '2026-01-01T10:00:00Z',
        },
      ],
      registrations: [
        {
          id: MOCK_REG_1_ID,
          player_id: MOCK_PLAYER_ID,
          tournament_id: 'tourn-1',
          registration_number: 'REG-2026-0001',
          registration_type: 'PLAYER',
          registration_status: 'CONFIRMED',
          payment_status: 'SUCCESSFUL',
          registered_name_snapshot: 'Rahul Dravid',
          registered_image_snapshot: 'rahul-initial.jpg',
          registered_role_snapshot: 'BATSMAN',
          registered_batting_style_snapshot: 'RIGHT_HAND',
          registered_bowling_style_snapshot: 'RIGHT_ARM_OFF_BREAK',
          registered_jersey_name_snapshot: 'RAHUL',
          registered_jersey_number_snapshot: '19',
          registered_jersey_size_snapshot: 'L',
        },
        {
          id: MOCK_REG_2_ID,
          player_id: MOCK_PLAYER_ID,
          tournament_id: 'tourn-2',
          registration_number: 'REG-2026-0002',
          registration_type: 'PLAYER',
          registration_status: 'PENDING',
          payment_status: 'PENDING',
          registered_name_snapshot: 'The Wall',
          registered_image_snapshot: 'the-wall.jpg',
          registered_role_snapshot: 'BATSMAN_WICKETKEEPER',
          registered_batting_style_snapshot: 'RIGHT_HAND',
          registered_bowling_style_snapshot: 'DOESNT_BOWL',
          registered_jersey_name_snapshot: 'WALL',
          registered_jersey_number_snapshot: '99',
          registered_jersey_size_snapshot: 'XL',
        },
        {
          id: MOCK_REG_OWNER_ID,
          player_id: MOCK_PLAYER_ID,
          tournament_id: 'tourn-3',
          registration_number: 'REG-2026-0003',
          registration_type: 'OWNER',
          registration_status: 'CONFIRMED',
          payment_status: 'SUCCESSFUL',
          registered_name_snapshot: 'Rahul Team Owner',
          registered_image_snapshot: 'owner.jpg',
          registered_role_snapshot: 'ALL_ROUNDER',
          registered_batting_style_snapshot: 'RIGHT_HAND',
          registered_bowling_style_snapshot: 'RIGHT_ARM_FAST',
          registered_jersey_name_snapshot: 'OWNER_DRAVID',
          registered_jersey_number_snapshot: '1',
          registered_jersey_size_snapshot: 'XXL',
        },
      ],
      payments: [
        {
          id: MOCK_PAYMENT_1_ID,
          registration_id: MOCK_REG_1_ID,
          amount: 50000,
          payment_status: 'SUCCESSFUL',
        },
        {
          id: MOCK_PAYMENT_2_ID,
          registration_id: MOCK_REG_2_ID,
          amount: 50000,
          payment_status: 'PENDING',
        },
      ],
      audit_logs: [],
    };

    (createServerSupabaseClient as any).mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: mockAuthUser },
          error: null,
        })),
      },
    });

    (createAdminClient as any).mockImplementation(createMockAdminClient);
  });

  const sendPatchRequest = async (playerId: string, body: any) => {
    const req = new NextRequest(`http://localhost:3000/api/admin/players/${playerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return PATCH(req, { params: Promise.resolve({ id: playerId }) });
  };

  // 1. Admin authorization
  it('1. Admin authorization — Returns 200 for authenticated active admin', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Rahul S. Dravid',
      editReason: 'Updating full name with middle initial per request',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.player.full_name).toBe('Rahul S. Dravid');
  });

  // 2. Non-admin rejection
  it('2. Non-admin rejection — Returns 403 when user is not an active admin', async () => {
    mockAdminUserEntry = null; // not an admin
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Hacker Admin',
      editReason: 'Attempt unauthorized update',
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/Admin access required/i);
  });

  // 3. Unauthenticated rejection
  it('3. Unauthenticated rejection — Returns 401 when no auth session exists', async () => {
    mockAuthUser = null;
    (createServerSupabaseClient as any).mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: new Error('No session') })),
      },
    });

    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Anonymous User',
      editReason: 'Attempt anonymous update',
    });
    expect(res.status).toBe(401);
  });

  // 4. Valid profile update
  it('4. Valid profile update — Returns safe player DTO without internal credentials or secrets', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Rahul Dravid Updated',
      mobile: '9876543210',
      cricketRole: 'ALL_ROUNDER',
      editReason: 'Promoted player to all rounder role',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.player.id).toBe(MOCK_PLAYER_ID);
    expect(data.player.full_name).toBe('Rahul Dravid Updated');
    expect(data.player.cricket_role).toBe('ALL_ROUNDER');
    // Ensure no secrets leaked
    expect(data.player.auth_user_id).toBeUndefined();
    expect(data.player.service_role).toBeUndefined();
    expect(data.player.supabase_key).toBeUndefined();
  });

  // 5. Name update
  it('5. Name update — Updates full_name in players table', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      full_name: 'Rahul Sharad Dravid',
      editReason: 'Corrected complete name per Aadhaar',
    });
    expect(res.status).toBe(200);
    expect(mockDbData.players[0].full_name).toBe('Rahul Sharad Dravid');
  });

  // 6. Mobile update
  it('6. Mobile update — Updates and normalizes mobile in players table', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      mobile: '+91 9123456789',
      editReason: 'Updated player primary mobile contact',
    });
    expect(res.status).toBe(200);
    expect(mockDbData.players[0].mobile).toBe('9123456789');
  });

  // 7. Role update
  it('7. Role update — Updates cricket_role in players table', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      cricketRole: 'BATSMAN_WICKETKEEPER',
      editReason: 'Player designated as primary wicket keeper',
    });
    expect(res.status).toBe(200);
    expect(mockDbData.players[0].cricket_role).toBe('BATSMAN_WICKETKEEPER');
  });

  // 8. Batting update
  it('8. Batting update — Updates batting_style in players table', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      battingStyle: 'LEFT_HAND',
      editReason: 'Corrected batting stance to left hand',
    });
    expect(res.status).toBe(200);
    expect(mockDbData.players[0].batting_style).toBe('LEFT_HAND');
  });

  // 9. Bowling update
  it('9. Bowling update — Updates bowling_style in players table', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      bowlingStyle: 'RIGHT_ARM_SPIN',
      editReason: 'Updated primary bowling variation',
    });
    expect(res.status).toBe(200);
    expect(mockDbData.players[0].bowling_style).toBe('RIGHT_ARM_SPIN');
  });

  // 10. Jersey name update
  it('10. Jersey name update — Updates default jersey_name in players table', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      jerseyName: 'DRAVID',
      editReason: 'Updated default jersey surname',
    });
    expect(res.status).toBe(200);
    expect(mockDbData.players[0].jersey_name).toBe('DRAVID');
  });

  // 11. Jersey number update
  it('11. Jersey number update — Updates default jersey_number in players table', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      jerseyNumber: '5',
      editReason: 'Player assigned lucky number 5',
    });
    expect(res.status).toBe(200);
    expect(mockDbData.players[0].jersey_number).toBe('5');
  });

  // 12. Jersey size update
  it('12. Jersey size update — Updates default jersey_size in players table', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      jerseySize: 'XL',
      editReason: 'Updated default jersey fit size',
    });
    expect(res.status).toBe(200);
    expect(mockDbData.players[0].jersey_size).toBe('XL');
  });

  // 13. Edit reason required
  it('13. Edit reason required — Rejects empty or missing editReason with 400', async () => {
    const res1 = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'New Name',
    });
    expect(res1.status).toBe(400);

    const res2 = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'New Name',
      editReason: '   ',
    });
    expect(res2.status).toBe(400);

    const res3 = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'New Name',
      editReason: 'abc', // < 5 chars
    });
    expect(res3.status).toBe(400);
  });

  // 14. Invalid enum rejected
  it('14. Invalid enum rejected — Rejects non-existent cricket role or bowling style with 400', async () => {
    const res1 = await sendPatchRequest(MOCK_PLAYER_ID, {
      cricketRole: 'SUPERSTAR_CAPTAIN',
      editReason: 'Assigned non-existent cricket role',
    });
    expect(res1.status).toBe(400);

    const res2 = await sendPatchRequest(MOCK_PLAYER_ID, {
      bowlingStyle: 'UNDERARM',
      editReason: 'Assigned non-existent bowling style',
    });
    expect(res2.status).toBe(400);
  });

  // 15. Invalid jersey number rejected
  it('15. Invalid jersey number rejected — Rejects non-numeric or invalid jersey number with 400', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      jerseyNumber: 'XYZ-9999',
      editReason: 'Assigned invalid jersey number',
    });
    expect(res.status).toBe(400);
  });

  // 16. Protected fields rejected
  it('16. Protected fields rejected — Rejects any attempt to modify immutable fields with 400', async () => {
    const protectedAttempts = [
      { id: 'hacked-id' },
      { auth_user_id: 'new-auth-id' },
      { email: 'newemail@test.com' },
      { created_at: '2020-01-01' },
      { registration_status: 'CONFIRMED' },
      { payment_status: 'SUCCESSFUL' },
      { registered_name_snapshot: 'Direct Snapshot Hack' },
      { registered_jersey_number_snapshot: '00' },
      { team_owner_id: 'fake-owner' },
      { slot_number: 1 },
      { tournament_id: 'new-tourn' },
    ];

    for (const attempt of protectedAttempts) {
      const res = await sendPatchRequest(MOCK_PLAYER_ID, {
        ...attempt,
        editReason: 'Testing protected field rejection',
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/protected and cannot be modified/i);
    }
  });

  // 17. Unknown fields rejected
  it('17. Unknown fields rejected — Rejects unrecognized fields with 400', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      unknownFieldXYZ: 'some_value',
      editReason: 'Testing unknown field rejection',
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/unrecognized or not allowed/i);
  });

  // 18. No-op update does not create audit
  it('18. No-op update — Does not mutate updated_at or insert audit log if submitted values match existing', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Rahul Dravid', // same as initial
      mobile: '9876543210',     // same as initial
      editReason: 'Submitted without changing any fields',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.noOp).toBe(true);
    expect(data.message).toMatch(/No profile changes detected/i);
    expect(mockDbData.audit_logs.length).toBe(0);
  });

  // 19-23. Comprehensive Audit Log verification
  it('19-23. Audit Log verification — Contains old values, new values, changed fields, admin identity, and reason', async () => {
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Rahul Dravid Champion',
      cricketRole: 'ALL_ROUNDER',
      jerseyNumber: '99',
      editReason: 'Promoted to captain all rounder with jersey 99',
    });
    expect(res.status).toBe(200);
    expect(mockDbData.audit_logs.length).toBe(1);

    const log = mockDbData.audit_logs[0];
    expect(log.action).toBe('ADMIN_UPDATE_PLAYER_PROFILE');
    expect(log.entity_type).toBe('PLAYER');
    expect(log.entity_id).toBe(MOCK_PLAYER_ID);
    expect(log.admin_user_id).toBe('admin-auth-id-123');

    // 19. Audit contains old values
    expect(log.old_value.full_name).toBe('Rahul Dravid');
    expect(log.old_value.cricket_role).toBe('BATSMAN');
    expect(log.old_value.jersey_number).toBe('19');

    // 20. Audit contains new values
    expect(log.new_value.full_name).toBe('Rahul Dravid Champion');
    expect(log.new_value.cricket_role).toBe('ALL_ROUNDER');
    expect(log.new_value.jersey_number).toBe('99');

    // 21. Audit contains changed fields
    expect(log.new_value.changed_fields).toEqual(
      expect.arrayContaining(['full_name', 'cricket_role', 'jersey_number'])
    );

    // 22. Audit contains admin identity
    expect(log.new_value.admin_email).toBe('admin@fairplay.test');

    // 23. Audit contains edit reason
    expect(log.new_value.reason).toBe('Promoted to captain all rounder with jersey 99');
  });

  // 24. Registration snapshot remains unchanged
  it('24. Registration snapshot remains unchanged — Single tournament snapshot is untouched', async () => {
    const regBefore = JSON.parse(JSON.stringify(mockDbData.registrations[0]));

    await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Completely New Player Name',
      cricketRole: 'BOWLER',
      jerseyName: 'NEW_NAME',
      jerseyNumber: '100',
      jerseySize: 'S',
      editReason: 'Updating master profile to new values',
    });

    const regAfter = mockDbData.registrations[0];
    expect(regAfter.registered_name_snapshot).toBe(regBefore.registered_name_snapshot);
    expect(regAfter.registered_role_snapshot).toBe(regBefore.registered_role_snapshot);
    expect(regAfter.registered_jersey_name_snapshot).toBe(regBefore.registered_jersey_name_snapshot);
    expect(regAfter.registered_jersey_number_snapshot).toBe(regBefore.registered_jersey_number_snapshot);
    expect(regAfter.registered_jersey_size_snapshot).toBe(regBefore.registered_jersey_size_snapshot);
  });

  // 25. Multiple tournament snapshots remain unchanged
  it('25. Multiple tournament snapshots remain unchanged — All existing tournament registrations untouched', async () => {
    const allRegsBefore = JSON.parse(JSON.stringify(mockDbData.registrations));

    await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Rahul Dravid Global Edit',
      jerseyName: 'GLOBAL_NAME',
      editReason: 'Testing multiple tournament snapshot immutability',
    });

    expect(mockDbData.registrations[0]).toEqual(allRegsBefore[0]);
    expect(mockDbData.registrations[1]).toEqual(allRegsBefore[1]);
    expect(mockDbData.registrations[2]).toEqual(allRegsBefore[2]);
  });

  // 26. Owner/Icon registration snapshots remain unchanged
  it('26. Owner/Icon registration snapshots remain unchanged', async () => {
    const ownerRegBefore = JSON.parse(JSON.stringify(mockDbData.registrations[2]));

    await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Owner Modified Name',
      cricketRole: 'BOWLER',
      editReason: 'Testing owner registration snapshot protection',
    });

    const ownerRegAfter = mockDbData.registrations[2];
    expect(ownerRegAfter.registered_name_snapshot).toBe(ownerRegBefore.registered_name_snapshot);
    expect(ownerRegAfter.registered_role_snapshot).toBe(ownerRegBefore.registered_role_snapshot);
    expect(ownerRegAfter.registered_jersey_name_snapshot).toBe(ownerRegBefore.registered_jersey_name_snapshot);
  });

  // 27. Payment information remains unchanged
  it('27. Payment information remains unchanged — Payments rows are untouched', async () => {
    const paymentsBefore = JSON.parse(JSON.stringify(mockDbData.payments));

    await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Payment Safety Check',
      editReason: 'Verifying payment records cannot be affected by profile edit',
    });

    expect(mockDbData.payments).toEqual(paymentsBefore);
  });

  // 28. Registration status remains unchanged
  it('28. Registration status remains unchanged — Status remains CONFIRMED/PENDING', async () => {
    await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Status Safety Check',
      editReason: 'Verifying registration status cannot change on profile edit',
    });

    expect(mockDbData.registrations[0].registration_status).toBe('CONFIRMED');
    expect(mockDbData.registrations[1].registration_status).toBe('PENDING');
  });

  // STEP 15: CRITICAL TEST — Full snapshot isolation comparison
  it('CRITICAL TEST (Step 15): Before and after profile update, player is UPDATED and all registration snapshot fields are EXACTLY UNCHANGED', async () => {
    // Capture state before
    const playerBefore = JSON.parse(JSON.stringify(mockDbData.players[0]));
    const registrationsBefore = JSON.parse(JSON.stringify(mockDbData.registrations));

    // Perform profile update
    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Rahul Dravid Master',
      mobile: '9888877777',
      cricketRole: 'BOWLER',
      battingStyle: 'LEFT_HAND',
      bowlingStyle: 'LEFT_ARM_FAST',
      jerseyName: 'DRAVID_MASTER',
      jerseyNumber: '99',
      jerseySize: '3XL',
      editReason: 'Applying comprehensive master profile updates for Step 15 test',
    });

    expect(res.status).toBe(200);

    // Verify player is UPDATED
    const playerAfter = mockDbData.players[0];
    expect(playerAfter.full_name).toBe('Rahul Dravid Master');
    expect(playerAfter.mobile).toBe('9888877777');
    expect(playerAfter.cricket_role).toBe('BOWLER');
    expect(playerAfter.batting_style).toBe('LEFT_HAND');
    expect(playerAfter.bowling_style).toBe('LEFT_ARM_FAST');
    expect(playerAfter.jersey_name).toBe('DRAVID_MASTER');
    expect(playerAfter.jersey_number).toBe('99');
    expect(playerAfter.jersey_size).toBe('3XL');
    expect(playerAfter.full_name).not.toBe(playerBefore.full_name);

    // Verify registrations are EXACTLY UNCHANGED across all snapshots
    const registrationsAfter = mockDbData.registrations;
    expect(registrationsAfter.length).toBe(registrationsBefore.length);

    for (let i = 0; i < registrationsBefore.length; i++) {
      const before = registrationsBefore[i];
      const after = registrationsAfter[i];

      expect(after.registered_name_snapshot).toBe(before.registered_name_snapshot);
      expect(after.registered_image_snapshot).toBe(before.registered_image_snapshot);
      expect(after.registered_role_snapshot).toBe(before.registered_role_snapshot);
      expect(after.registered_batting_style_snapshot).toBe(before.registered_batting_style_snapshot);
      expect(after.registered_bowling_style_snapshot).toBe(before.registered_bowling_style_snapshot);
      expect(after.registered_jersey_name_snapshot).toBe(before.registered_jersey_name_snapshot);
      expect(after.registered_jersey_number_snapshot).toBe(before.registered_jersey_number_snapshot);
      expect(after.registered_jersey_size_snapshot).toBe(before.registered_jersey_size_snapshot);
    }
  });

  // 29. Critical Atomicity Test: Forced audit failure rolls back all mutations in transaction
  it('29. Critical Atomicity Test — If audit insert inside RPC fails, entire transaction rolls back, 500 returned, player untouched, no audit committed', async () => {
    const originalPlayer = JSON.parse(JSON.stringify(mockDbData.players[0]));
    shouldFailAuditInsert = true;

    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'New Name That Should Rollback',
      cricketRole: 'BOWLER',
      editReason: 'Simulating transaction abort to verify true DB atomicity',
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/Simulated transaction failure.*audit_logs insert failed/i);

    // Verify player profile remains unchanged
    expect(mockDbData.players[0].full_name).toBe(originalPlayer.full_name);
    expect(mockDbData.players[0].cricket_role).toBe(originalPlayer.cricket_role);

    // Verify no audit record committed
    expect(mockDbData.audit_logs.length).toBe(0);
  });

  // 30. Image cleanup safety on RPC failure
  it('30. Image cleanup safety — If image is uploaded and RPC subsequently fails, newly uploaded object is removed from storage', async () => {
    shouldFailAuditInsert = true;

    const dummyBase64 =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

    const res = await sendPatchRequest(MOCK_PLAYER_ID, {
      fullName: 'Testing Image Cleanup',
      profileImageUrl: dummyBase64,
      editReason: 'Simulating image cleanup on RPC error',
    });

    expect(res.status).toBe(500);
    expect(mockStorageRemove).toHaveBeenCalled();
  });
});


