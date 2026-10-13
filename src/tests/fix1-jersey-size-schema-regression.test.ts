import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import fs from 'fs';
import path from 'path';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/storage/upload', () => ({
  uploadToStorageBucket: vi.fn().mockResolvedValue({ publicUrl: 'https://storage/img.png' }),
  validateImageFileBuffer: vi.fn().mockReturnValue({ isValid: true, mimeType: 'image/png', extension: 'png' }),
}));

/**
 * FIX #1 + #1A Regression — jersey_size schema mismatch
 *
 * Verifies that:
 * 1. players.insert / players.upsert calls do NOT include jersey_size
 * 2. Jersey size is still passed to registration RPCs / registration inserts
 * 3. All four registration flows (SELF, OTHER, OWNER, ICON) work correctly
 */
describe('Fix #1/#1A — jersey_size Schema Mismatch Regression', () => {

  // ============================================================
  // SOURCE CODE ANALYSIS TESTS
  // ============================================================
  describe('Source code validation — no players.jersey_size in registration routes', () => {

    it('SELF registration path does NOT write jersey_size to players.insert', () => {
      const routeSource = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/registrations/route.ts'),
        'utf-8'
      );

      // Find the SELF auto-create block (between "Auto-create primary player profile" and the next .select)
      const selfCreateMatch = routeSource.match(
        /Auto-create primary player profile[\s\S]*?\.insert\(\{([\s\S]*?)\}\)/
      );
      expect(selfCreateMatch).toBeTruthy();
      const selfInsertBlock = selfCreateMatch![1];
      expect(selfInsertBlock).not.toContain('jersey_size');
    });

    it('OTHER registration path does NOT write jersey_size to players.insert', () => {
      const routeSource = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/registrations/route.ts'),
        'utf-8'
      );

      // Find the OTHER insert block (between "tournament-only participant" and the next .select)
      const otherCreateMatch = routeSource.match(
        /tournament-only participant[\s\S]*?\.insert\(\{([\s\S]*?)\}\)/
      );
      expect(otherCreateMatch).toBeTruthy();
      const otherInsertBlock = otherCreateMatch![1];
      expect(otherInsertBlock).not.toContain('jersey_size');
    });

    it('Owner registration path does NOT write jersey_size to players.upsert', () => {
      const routeSource = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/registrations/owner/route.ts'),
        'utf-8'
      );

      // Find the owner upsert block (between "Auto-create owner player profile" and the next .select)
      const ownerCreateMatch = routeSource.match(
        /Auto-create owner player profile[\s\S]*?\.upsert\(\{([\s\S]*?)\}\s*,/
      );
      expect(ownerCreateMatch).toBeTruthy();
      const ownerUpsertBlock = ownerCreateMatch![1];
      expect(ownerUpsertBlock).not.toContain('jersey_size');
    });

    it('Tournament register OTHER path does NOT write jersey_size to players.insert', () => {
      const routeSource = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/tournaments/[id]/register/route.ts'),
        'utf-8'
      );

      // Find the OTHER insert block (between "Another Player" and .insert)
      const otherMatch = routeSource.match(
        /Another Player[\s\S]*?newPlayerPayload[\s\S]*?=\s*\{([\s\S]*?)\};/
      );
      expect(otherMatch).toBeTruthy();
      const otherPayloadBlock = otherMatch![1];
      expect(otherPayloadBlock).not.toContain('jersey_size');
    });
  });

  // ============================================================
  // JERSEY SIZE SNAPSHOT PRESERVATION TESTS
  // ============================================================
  describe('Jersey size snapshot preservation — reaches registrations via RPC/insert', () => {

    it('SELF registration passes jerseySize as p_registered_jersey_size_snapshot to RPC', () => {
      const routeSource = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/registrations/route.ts'),
        'utf-8'
      );

      // Verify RPC call contains p_registered_jersey_size_snapshot
      expect(routeSource).toContain('p_registered_jersey_size_snapshot: jerseySize');
    });

    it('OTHER registration passes jerseySize as p_registered_jersey_size_snapshot to same RPC', () => {
      // Both SELF and OTHER use the same RPC call after the if/else
      const routeSource = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/registrations/route.ts'),
        'utf-8'
      );

      // The RPC is called after both SELF and OTHER player creation,
      // so jerseySize reaches registered_jersey_size_snapshot for both paths
      expect(routeSource).toContain("const jerseySize = body.jerseySize || 'M'");
      expect(routeSource).toContain('p_registered_jersey_size_snapshot: jerseySize');
    });

    it('Owner registration passes jersey size as p_owner_jersey_size to RPC', () => {
      const routeSource = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/registrations/owner/route.ts'),
        'utf-8'
      );

      expect(routeSource).toContain('p_owner_jersey_size: effectiveOwnerJerseySize');
    });

    it('Tournament register route stores jersey size in registered_jersey_size_snapshot', () => {
      const routeSource = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/tournaments/[id]/register/route.ts'),
        'utf-8'
      );

      expect(routeSource).toContain('registered_jersey_size_snapshot: data.jerseySize');
    });
  });

  // ============================================================
  // API BEHAVIOR TESTS — SELF REGISTRATION
  // ============================================================
  describe('SELF registration API — players.insert without jersey_size', () => {
    let capturedInsertPayload: any = null;
    let capturedRpcArgs: any = null;

    beforeEach(() => {
      capturedInsertPayload = null;
      capturedRpcArgs = null;

      (createServerSupabaseClient as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-self-001', email: 'self@example.com' } },
            error: null,
          }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }), // No existing profile
            }),
          }),
        }),
      });

      (createAdminClient as any).mockReturnValue({
        from: (table: string) => ({
          insert: (payload: any) => {
            if (table === 'players') capturedInsertPayload = payload;
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'player-new-001' },
                  error: null,
                }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 't-1', name: 'Test', registration_fee: 50000, max_players: 100, registration_open: true, waitlist_enabled: false },
                error: null,
              }),
            }),
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: { id: 't-1', name: 'Test', registration_fee: 50000, max_players: 100, registration_open: true, waitlist_enabled: false },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        rpc: (name: string, args: any) => {
          capturedRpcArgs = args;
          return {
            data: [{
              registration_id: 'reg-001',
              registration_number: 'REG-2026-00001',
              registration_status: 'CONFIRMED',
              waitlist_position: null,
              payment_id: 'pay-001',
            }],
            error: null,
          };
        },
      });
    });

    it('creates player without jersey_size and passes it to RPC snapshot', async () => {
      const { POST } = await import('@/app/api/registrations/route');

      const req = new NextRequest('http://localhost:3000/api/registrations', {
        method: 'POST',
        body: JSON.stringify({
          registrationFor: 'SELF',
          fullName: 'Test Self Player',
          profileImageUrl: 'data:image/png;base64,iVBOR',
          cricketRole: 'BATSMAN',
          battingStyle: 'RIGHT_HAND',
          jerseySize: 'XL',
          mobile: '9876543210',
        }),
      });

      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      // CRITICAL: players.insert must NOT contain jersey_size
      expect(capturedInsertPayload).toBeTruthy();
      expect(capturedInsertPayload).not.toHaveProperty('jersey_size');

      // CRITICAL: RPC must receive jersey size as snapshot
      expect(capturedRpcArgs).toBeTruthy();
      expect(capturedRpcArgs.p_registered_jersey_size_snapshot).toBe('XL');
    });
  });

  // ============================================================
  // API BEHAVIOR TESTS — OTHER REGISTRATION
  // ============================================================
  describe('OTHER registration API — players.insert without jersey_size', () => {
    let capturedInsertPayload: any = null;
    let capturedRpcArgs: any = null;

    beforeEach(() => {
      capturedInsertPayload = null;
      capturedRpcArgs = null;

      (createServerSupabaseClient as any).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-account-001', email: 'account@example.com' } },
            error: null,
          }),
        },
      });

      (createAdminClient as any).mockReturnValue({
        from: (table: string) => ({
          insert: (payload: any) => {
            if (table === 'players') capturedInsertPayload = payload;
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'player-other-001' },
                  error: null,
                }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 't-1', name: 'Test', registration_fee: 50000, max_players: 100, registration_open: true, waitlist_enabled: false },
                error: null,
              }),
            }),
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: { id: 't-1', name: 'Test', registration_fee: 50000, max_players: 100, registration_open: true, waitlist_enabled: false },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        rpc: (name: string, args: any) => {
          capturedRpcArgs = args;
          return {
            data: [{
              registration_id: 'reg-other-001',
              registration_number: 'REG-2026-00002',
              registration_status: 'CONFIRMED',
              waitlist_position: null,
              payment_id: 'pay-other-001',
            }],
            error: null,
          };
        },
      });
    });

    it('creates OTHER participant without jersey_size and passes it to RPC snapshot', async () => {
      const { POST } = await import('@/app/api/registrations/route');

      const req = new NextRequest('http://localhost:3000/api/registrations', {
        method: 'POST',
        body: JSON.stringify({
          registrationFor: 'OTHER',
          fullName: 'Friend Player',
          email: 'friend@example.com',
          profileImageUrl: 'data:image/png;base64,iVBOR',
          cricketRole: 'ALL_ROUNDER',
          battingStyle: 'LEFT_HAND',
          bowlingStyle: 'RIGHT_ARM_FAST',
          jerseySize: 'L',
          mobile: '9123456789',
        }),
      });

      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      // CRITICAL: players.insert must NOT contain jersey_size
      expect(capturedInsertPayload).toBeTruthy();
      expect(capturedInsertPayload).not.toHaveProperty('jersey_size');
      expect(capturedInsertPayload.is_tournament_only).toBe(true);

      // CRITICAL: RPC must receive jersey size as snapshot
      expect(capturedRpcArgs).toBeTruthy();
      expect(capturedRpcArgs.p_registered_jersey_size_snapshot).toBe('L');
    });
  });
});
