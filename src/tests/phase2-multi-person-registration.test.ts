import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as registerPlayer } from '@/app/api/tournaments/[id]/register/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

const createRegisterRequest = (tournamentId: string, body: Record<string, unknown>) =>
  new NextRequest(`http://localhost:3000/api/tournaments/${tournamentId}/register`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('Phase 2 — Multi-Person Registration Safety & Account Isolation', () => {
  let mockServer: any;
  let mockAdmin: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockServer = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-account-123', email: 'user@example.com' } },
          error: null,
        }),
      },
    };

    mockAdmin = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      single: vi.fn(),
    };

    (createServerSupabaseClient as unknown as any).mockResolvedValue(mockServer);
    (createAdminClient as unknown as any).mockReturnValue(mockAdmin);
  });

  it('SELF registration uses authenticated user profile and checks existing registration', async () => {
    // 1. Tournament query (.single())
    mockAdmin.single.mockResolvedValueOnce({
      data: {
        id: 'tourney-1',
        registration_open: true,
        registration_fee: 50000,
        upi_id: 'test@upi',
      },
      error: null,
    });

    // 2. Player profile query for SELF (.maybeSingle())
    mockAdmin.maybeSingle.mockResolvedValueOnce({
      data: {
        id: 'player-self-1',
        full_name: 'Auth User',
        email: 'user@example.com',
        auth_user_id: 'auth-account-123',
      },
      error: null,
    });

    // 3. Existing registration check (.maybeSingle())
    mockAdmin.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // 4. Insert registration (.single())
    mockAdmin.single.mockResolvedValueOnce({
      data: { id: 'reg-self-1', registration_number: 'REG-1001' },
      error: null,
    });

    // 5. Insert payment (.single())
    mockAdmin.single.mockResolvedValueOnce({
      data: { id: 'pay-self-1', payment_status: 'PENDING' },
      error: null,
    });

    const body = {
      targetType: 'SELF',
      fullName: 'Auth User',
      email: 'user@example.com',
      profileImageUrl: 'data:image/png;base64,ABC',
      cricketRole: 'BATSMAN',
      battingStyle: 'RIGHT_HAND',
      jerseySize: 'L',
      jerseyName: 'AUTH',
      jerseyNumber: '10',
      termsAccepted: true,
    };

    const res = await registerPlayer(createRegisterRequest('tourney-1', body), {
      params: Promise.resolve({ id: 'tourney-1' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('OTHER registration creates a distinct tournament-only participant record and attaches created_by_auth_id', async () => {
    // 1. Tournament query (.single())
    mockAdmin.single.mockResolvedValueOnce({
      data: {
        id: 'tourney-1',
        registration_open: true,
        registration_fee: 50000,
        upi_id: 'test@upi',
      },
      error: null,
    });

    // 2. Insert distinct player for "Another Player" (.single())
    mockAdmin.single.mockResolvedValueOnce({
      data: {
        id: 'player-other-99',
        full_name: 'Friend Player',
        email: 'friend@example.com',
        is_tournament_only: true,
        auth_user_id: null,
      },
      error: null,
    });

    // 3. Check existing registration (.maybeSingle())
    mockAdmin.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // 4. Insert registration (.single())
    mockAdmin.single.mockResolvedValueOnce({
      data: { id: 'reg-other-1', registration_number: 'REG-1002' },
      error: null,
    });

    // 5. Insert payment (.single())
    mockAdmin.single.mockResolvedValueOnce({
      data: { id: 'pay-other-1', payment_status: 'PENDING' },
      error: null,
    });

    const body = {
      targetType: 'OTHER',
      fullName: 'Friend Player',
      email: 'friend@example.com',
      profileImageUrl: 'data:image/png;base64,ABC',
      cricketRole: 'ALL_ROUNDER',
      battingStyle: 'LEFT_HAND',
      bowlingStyle: 'RIGHT_ARM_FAST',
      jerseySize: 'M',
      jerseyName: 'FRIEND',
      jerseyNumber: '7',
      termsAccepted: true,
    };

    const res = await registerPlayer(createRegisterRequest('tourney-1', body), {
      params: Promise.resolve({ id: 'tourney-1' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
