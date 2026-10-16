import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env.local');
  } catch {}
}

import { createAdminClient } from '@/lib/supabase/admin';

const auctionId = '5f58dd30-3188-478c-9c72-7b613309ab7c';
const tournamentId = 'edfb6464-c326-4ad8-af8f-b0113f9bdcf3';

describe('Auction Pool Identity and Projector Photos — 90 Distinct Entries', () => {
  it('migration schema enforces registration_id identity instead of player_id', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'supabase',
        'migrations',
        '20261030000000_auction_pool_registration_identity.sql'
      ),
      'utf8'
    );

    // Dropped player_id constraints
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS unique_auction_selection_player');
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS unique_auction_lot_per_player');
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS unique_auction_lot_per_round_player');
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS unique_player_purchase_per_auction');

    // Added registration_id constraints
    expect(migration).toContain('unique_auction_selection_registration');
    expect(migration).toContain('unique_auction_lot_per_round_registration');
    expect(migration).toContain('unique_registration_purchase_per_auction');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS registration_id UUID REFERENCES registrations(id)');
  });

  it('verifies exactly 90 lots in the database: 80 PLAYER + 10 OWNER, 0 ICON', async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      console.warn('Skipping live DB check: environment variables missing in test runner');
      return;
    }

    const supabase = createAdminClient();

    const { data: lots, error } = await supabase
      .from('auction_lots')
      .select(`
        id,
        lot_number,
        registration_id,
        player_id,
        registration:registrations (
          id,
          registration_type,
          registered_name_snapshot,
          registered_image_snapshot,
          registered_role_snapshot,
          registered_batting_style_snapshot,
          registered_bowling_style_snapshot
        )
      `)
      .eq('auction_id', auctionId)
      .order('lot_number', { ascending: true });

    expect(error).toBeNull();
    expect(lots).toHaveLength(90);

    const typeCounts: Record<string, number> = {};
    const photoUrls = new Set<string>();
    const names = new Set<string>();
    const registrationIds = new Set<string>();

    for (const lot of lots!) {
      const reg = Array.isArray(lot.registration) ? lot.registration[0] : lot.registration;
      expect(reg).toBeDefined();

      const type = reg!.registration_type;
      typeCounts[type] = (typeCounts[type] || 0) + 1;

      expect(lot.registration_id).toBeTruthy();
      registrationIds.add(lot.registration_id!);

      expect(reg!.registered_name_snapshot).toBeTruthy();
      names.add(reg!.registered_name_snapshot);

      expect(reg!.registered_image_snapshot).toBeTruthy();
      photoUrls.add(reg!.registered_image_snapshot);
    }

    // Exactly 80 PLAYER + 10 OWNER
    expect(typeCounts['PLAYER']).toBe(80);
    expect(typeCounts['OWNER']).toBe(10);
    expect(typeCounts['ICON']).toBeUndefined();

    // Exactly 90 distinct registrations, names, and photos
    expect(registrationIds.size).toBe(90);
    expect(names.size).toBe(90);
    expect(photoUrls.size).toBe(90);
  }, 30000);

  it('verifies owner registrations sharing player_id have separate lots and unique photos', async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      return;
    }

    const supabase = createAdminClient();

    const sharedPlayerId = 'ea97c327-9c66-4c9b-84a3-c3da89243aa4';
    const { data: sharedLots, error } = await supabase
      .from('auction_lots')
      .select(`
        id,
        lot_number,
        registration_id,
        player_id,
        registration:registrations (
          registered_name_snapshot,
          registered_image_snapshot
        )
      `)
      .eq('auction_id', auctionId)
      .eq('player_id', sharedPlayerId);

    expect(error).toBeNull();
    // 5 owner registrations share this player_id
    expect(sharedLots).toHaveLength(5);

    const regIds = sharedLots!.map((l) => l.registration_id);
    expect(new Set(regIds).size).toBe(5);

    const photos = sharedLots!.map((l) => {
      const reg = Array.isArray(l.registration) ? l.registration[0] : l.registration;
      return reg?.registered_image_snapshot;
    });
    expect(new Set(photos).size).toBe(5);
  });

  it('confirms 10 team budgets exist with unspent starting kitty', async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      return;
    }

    const supabase = createAdminClient();

    const { data: budgets, error } = await supabase
      .from('auction_team_budgets')
      .select('team_owner_id, starting_kitty, remaining_kitty, players_bought')
      .eq('auction_id', auctionId);

    expect(error).toBeNull();
    expect(budgets).toHaveLength(10);

    for (const b of budgets!) {
      expect(b.starting_kitty).toBe(180000);
      expect(b.remaining_kitty).toBe(180000);
      expect(b.players_bought).toBe(0);
    }
  });
});
