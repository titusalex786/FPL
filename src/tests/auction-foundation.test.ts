import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase',
  'migrations',
  '20261018000000_phase_a2_auction_foundation.sql'
);
const migration = readFileSync(migrationPath, 'utf8');
const canonicalFoundation = readFileSync(
  resolve(
    process.cwd(),
    'supabase',
    'migrations',
    '20260924000000_phase1_canonical_foundation.sql'
  ),
  'utf8'
);

const getCreatedNames = (pattern: RegExp): string[] =>
  Array.from(migration.matchAll(pattern), (match) => match[1]).sort();

describe('Phase A2 auction database foundation', () => {
  it('creates only the five auction tables and four auction enums', () => {
    expect(getCreatedNames(/CREATE TABLE IF NOT EXISTS (\w+)/g)).toEqual([
      'auction_events',
      'auction_lots',
      'auction_purchases',
      'auction_team_budgets',
      'auctions',
    ]);
    expect(getCreatedNames(/CREATE TYPE (\w+) AS ENUM/g)).toEqual([
      'auction_event_type',
      'auction_lot_status',
      'auction_purchase_status',
      'auction_status',
    ]);
  });

  it('does not recreate existing tournament, registration, payment, player, or audit objects', () => {
    expect(getCreatedNames(/CREATE TABLE IF NOT EXISTS (\w+)/g)).not.toEqual(
      expect.arrayContaining([
        'tournaments',
        'players',
        'registrations',
        'team_owners',
        'payments',
        'audit_logs',
      ])
    );
    expect(migration).not.toMatch(/CREATE TYPE (?:tournament|registration|payment)_/i);
    expect(migration).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION\s+(?:is_admin|is_manager)\b/i);
    expect(migration).not.toMatch(/CREATE\s+(?:OR REPLACE\s+)?TRIGGER\b/i);
  });

  it('uses the existing database-backed admin and manager authorization helpers', () => {
    expect(canonicalFoundation).toMatch(/CREATE OR REPLACE FUNCTION is_admin\(p_uid UUID\)/);
    expect(canonicalFoundation).toMatch(/CREATE OR REPLACE FUNCTION is_manager\(p_uid UUID\)/);
    expect(canonicalFoundation).toMatch(/CREATE TABLE IF NOT EXISTS admin_users/);
    expect(canonicalFoundation).toMatch(/CREATE TABLE IF NOT EXISTS audit_logs/);
    expect(migration).toContain('is_admin(auth.uid())');
    expect(migration).toContain('is_manager(auth.uid())');
    expect(migration).not.toMatch(/@gmail\.com|@outlook\.com|@hotmail\.com/i);
  });

  it('captures the auction configuration defaults and one-auction-per-tournament rule', () => {
    expect(migration).toMatch(/starting_kitty INTEGER NOT NULL DEFAULT 180000/);
    expect(migration).toMatch(/required_players_to_buy INTEGER NOT NULL DEFAULT 9/);
    expect(migration).toMatch(/icon_players_allocated INTEGER NOT NULL DEFAULT 1/);
    expect(migration).toMatch(/base_bid INTEGER NOT NULL DEFAULT 5000/);
    expect(migration).toMatch(/low_increment INTEGER NOT NULL DEFAULT 1000/);
    expect(migration).toMatch(/high_increment INTEGER NOT NULL DEFAULT 2000/);
    expect(migration).toMatch(/minimum_reserve INTEGER NOT NULL DEFAULT 5000/);
    expect(migration).toMatch(/CONSTRAINT unique_auction_per_tournament UNIQUE \(tournament_id\)/);
  });

  it('ties team budgets to the auction configuration and an owner in the same tournament', () => {
    expect(migration).toMatch(/remaining_kitty INTEGER NOT NULL DEFAULT 180000 CHECK \(remaining_kitty >= 0\)/);
    expect(migration).toMatch(/auction_team_budgets_auction_config_fkey[\s\S]*?REFERENCES auctions/);
    expect(migration).toMatch(/auction_team_budgets_team_owner_tournament_fkey[\s\S]*?REFERENCES team_owners \(id, tournament_id\)/);
    expect(migration).toMatch(/CHECK \(remaining_kitty <= starting_kitty\)/);
    expect(migration).toMatch(/players_bought \+ players_remaining = required_players_to_buy/);
    expect(migration).toMatch(/UNIQUE \(auction_id, team_owner_id\)/);
  });

  it('models reusable player lots with valid auction, tournament, and participating-owner references', () => {
    expect(migration).toMatch(/player_id UUID NOT NULL REFERENCES players\(id\) ON DELETE RESTRICT/);
    expect(migration).toMatch(/auction_registrations_identity_key UNIQUE \(id, tournament_id, player_id\)/);
    expect(migration).toMatch(/registration_id UUID NOT NULL/);
    expect(migration).toMatch(/auction_lots_tournament_registration_player_fkey[\s\S]*?REFERENCES registrations \(id, tournament_id, player_id\)/);
    expect(migration).toMatch(/auction_lots_auction_tournament_fkey[\s\S]*?REFERENCES auctions \(id, tournament_id\)/);
    expect(migration).toMatch(/UNIQUE \(auction_id, player_id\)/);
    expect(migration).toMatch(/current_highest_team_owner_id UUID/);
    expect(migration).toMatch(/winning_team_owner_id UUID/);
    expect(migration).toMatch(/auction_lots_current_highest_owner_budget_fkey[\s\S]*?REFERENCES auction_team_budgets \(auction_id, team_owner_id\)/);
    expect(migration).toMatch(/auction_lots_winning_owner_budget_fkey[\s\S]*?REFERENCES auction_team_budgets \(auction_id, team_owner_id\)/);
    expect(migration).toMatch(/'AVAILABLE', 'LIVE', 'SOLD', 'UNSOLD'/);
    expect(migration).not.toContain("'ASSIGNED'");
  });

  it('requires complete sale data only for SOLD lots and enforces the bid-owner pair', () => {
    expect(migration).toMatch(/status = 'SOLD'[\s\S]*?sold_amount IS NOT NULL[\s\S]*?winning_team_owner_id IS NOT NULL[\s\S]*?sold_at IS NOT NULL/);
    expect(migration).toMatch(/current_highest_team_owner_id IS NULL AND current_highest_bid IS NULL/);
    expect(migration).toMatch(/current_highest_team_owner_id IS NOT NULL AND current_highest_bid IS NOT NULL/);
  });

  it('records purchases with a minimum bid and prevents duplicate player purchases', () => {
    expect(migration).toMatch(/winning_bid INTEGER NOT NULL CHECK \(winning_bid >= 5000\)/);
    expect(migration).toMatch(/UNIQUE \(auction_id, player_id\)/);
    expect(migration).toMatch(/auction_purchases_auction_tournament_fkey[\s\S]*?REFERENCES auctions \(id, tournament_id\)/);
    expect(migration).toMatch(/auction_purchases_auction_team_budget_fkey[\s\S]*?REFERENCES auction_team_budgets \(auction_id, team_owner_id\)/);
    expect(migration).toMatch(/player_id UUID NOT NULL REFERENCES players\(id\) ON DELETE RESTRICT/);
  });

  it('stores bid, sale, kitty, state, and administrative audit events', () => {
    for (const eventType of [
      'BID_PLACED',
      'PLAYER_SOLD',
      'PLAYER_UNSOLD',
      'PLAYER_ASSIGNED',
      'KITTY_DEDUCTION',
      'AUCTION_STATE_CHANGE',
      'ADMIN_ACTION',
    ]) {
      expect(migration).toContain(`'${eventType}'`);
    }
    expect(migration).toMatch(/event_payload JSONB NOT NULL/);
    expect(migration).toMatch(/amount INTEGER/);
    expect(migration).toMatch(/previous_value INTEGER/);
    expect(migration).toMatch(/new_value INTEGER/);
    expect(migration).toMatch(/created_by UUID REFERENCES auth\.users\(id\)/);
    expect(migration).toMatch(/auction_events_auction_tournament_fkey[\s\S]*?REFERENCES auctions \(id, tournament_id\)/);
  });

  it('creates the expected query indexes', () => {
    expect(getCreatedNames(/CREATE INDEX IF NOT EXISTS (\w+)/g)).toEqual([
      'idx_auction_events_auction_created_at',
      'idx_auction_events_player',
      'idx_auction_events_team_owner',
      'idx_auction_lots_auction_status',
      'idx_auction_lots_player',
      'idx_auction_lots_tournament',
      'idx_auction_purchases_auction_team',
      'idx_auction_purchases_player',
      'idx_auction_purchases_tournament',
      'idx_auction_team_budgets_owner_tournament',
      'idx_auction_team_budgets_status',
      'idx_auctions_status',
    ]);
  });

  it('enables RLS on every auction table', () => {
    for (const table of [
      'auctions',
      'auction_team_budgets',
      'auction_lots',
      'auction_purchases',
      'auction_events',
    ]) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it('limits private budget and purchase reads to admins, managers, and the linked owner', () => {
    expect(migration).toMatch(/CREATE POLICY "Auction budget read access[^]*?FOR SELECT[\s\S]*?is_admin\(auth\.uid\(\)\)[\s\S]*?is_manager\(auth\.uid\(\)\)[\s\S]*?p\.auth_user_id = auth\.uid\(\)/);
    expect(migration).toMatch(/CREATE POLICY "Auction purchases visibility[^]*?FOR SELECT[\s\S]*?is_admin\(auth\.uid\(\)\)[\s\S]*?is_manager\(auth\.uid\(\)\)[\s\S]*?p\.auth_user_id = auth\.uid\(\)/);
    expect(migration).not.toMatch(/FROM auction_team_budgets budget/i);
  });

  it('denies client writes to all auction, budget, lot, purchase, and event tables', () => {
    const tables = [
      'auctions',
      'auction_team_budgets',
      'auction_lots',
      'auction_purchases',
      'auction_events',
    ];

    for (const table of tables) {
      expect(migration).toMatch(new RegExp(`ON ${table}\\s+FOR INSERT WITH CHECK \\(false\\)`));
      expect(migration).toMatch(new RegExp(`ON ${table}\\s+FOR UPDATE USING \\(false\\) WITH CHECK \\(false\\)`));
      expect(migration).toMatch(new RegExp(`ON ${table}\\s+FOR DELETE USING \\(false\\)`));
    }
  });

  it('contains no RPC or trigger for the atomic sale flow', () => {
    expect(migration).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION\b/i);
    expect(migration).not.toMatch(/CREATE\s+(?:OR REPLACE\s+)?TRIGGER\b/i);
  });
});
