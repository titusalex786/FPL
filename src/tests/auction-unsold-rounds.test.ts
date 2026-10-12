import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261022000000_phase_a5_settlement.sql'),
  'utf8'
);

describe('Phase A5 unsold rounds and auction completion', () => {
  const settlement = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION settle_auction_lot_v1'),
    migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1')
  );

  it('tracks initial and retry rounds instead of resetting a prior lot', () => {
    expect(migration).toMatch(/CREATE TABLE auction_rounds/);
    expect(migration).toMatch(/round_type TEXT NOT NULL CHECK \(round_type IN \('INITIAL', 'UNSOLD_RETRY'\)\)/);
    expect(migration).toMatch(/DROP CONSTRAINT unique_auction_lot_per_player/);
    expect(migration).toMatch(/UNIQUE \(auction_id, round_id, player_id\)/);
    expect(settlement).toMatch(/INSERT INTO auction_rounds/);
    expect(settlement).toMatch(/INSERT INTO auction_lots/);
  });

  it('carries only previously UNSOLD selected active non-Icon players in deterministic order', () => {
    expect(settlement).toMatch(/previous_lot\.status = 'UNSOLD'/);
    expect(settlement).toMatch(/selection\.selection_status = 'SELECTED'/);
    expect(settlement).toMatch(/selection\.candidate_type <> 'ICON'/);
    expect(settlement).toMatch(/registration\.registration_status IN \('CONFIRMED', 'PENDING'\)/);
    expect(settlement).toMatch(/registration\.registration_type <> 'ICON'/);
    expect(settlement).toMatch(/ORDER BY retry\.original_lot_number, retry\.registration_id/);
    expect(settlement).toMatch(/NOT EXISTS \([\s\S]*?FROM auction_purchases purchase/);
  });

  it('does not create a retry round when no eligible unsold players remain', () => {
    expect(settlement).toMatch(/IF v_retry_count > 0 THEN/);
    expect(settlement).toMatch(/SET status = 'CLOSED'/);
    expect(settlement).toMatch(/ALL_ELIGIBLE_ROUNDS_SETTLED/);
    expect(settlement).not.toMatch(/SET status = 'FINALIZED'/);
  });

  it('completes each round only after all its lots are sold or unsold', () => {
    expect(settlement).toMatch(/round_lot\.status IN \('AVAILABLE', 'LIVE'\)/);
    expect(settlement).toMatch(/SET status = 'COMPLETED'/);
    expect(settlement).toMatch(/'UNSOLD_ROUND_CREATED'/);
    expect(settlement).toMatch(/'players_carried_forward', v_retry_count/);
  });

  it('records admin manual end and leaves unsettled eligible players UNSOLD', () => {
    const end = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_v1'));
    expect(end).toMatch(/SET status = 'UNSOLD'/);
    expect(end).toMatch(/'ADMIN_ENDED_AUCTION'/);
    expect(end).toMatch(/'AUCTION_MANUALLY_ENDED'/);
    expect(end).toMatch(/'admin_id', p_actor_id/);
    expect(end).toMatch(/'reason', NULLIF\(BTRIM\(p_reason\), ''\)/);
    expect(end).not.toMatch(/INSERT INTO auction_purchases/);
    expect(end).not.toMatch(/UPDATE auction_team_budgets/);
    expect(end).not.toMatch(/UPDATE registrations/);
  });

  it('rejects manual transitions for malformed, locked, excluded, or Icon lots', () => {
    const end = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_v1'));
    expect(end).toMatch(/selection\.selection_status <> 'SELECTED'/);
    expect(end).toMatch(/selection\.candidate_type = 'ICON'/);
    expect(end).toMatch(/registration\.registration_type = 'ICON'/);
    expect(end).toMatch(/INVALID_AUCTION_LOT/);
  });
});
