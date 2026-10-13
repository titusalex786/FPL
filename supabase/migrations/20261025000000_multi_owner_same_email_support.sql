-- Migration: 20261025000000_multi_owner_same_email_support.sql
-- Description: Enable one authenticated account/email to register multiple team owners while keeping standard PLAYER registrations strictly unique per tournament and ensuring isolated team owner, registration, and payment records.

-- 1. Drop the legacy unique constraint that prevented multiple team owners with same email/player
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS unique_player_role_per_tournament;

-- 2. Ensure standard PLAYER registrations remain strictly unique per tournament
CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_player_tournament 
  ON registrations (tournament_id, player_id) 
  WHERE registration_type = 'PLAYER';

-- 3. Ensure each Team Owner has exactly one OWNER registration record
CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_owner_team_owner 
  ON registrations (tournament_id, team_owner_id) 
  WHERE registration_type = 'OWNER' AND team_owner_id IS NOT NULL;

-- 4. Ensure each Team Owner has exactly one ICON registration record
CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_icon_team_owner 
  ON registrations (tournament_id, team_owner_id) 
  WHERE registration_type = 'ICON' AND team_owner_id IS NOT NULL;

-- 5. Ensure team name is unique per tournament (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_owners_tournament_team_name 
  ON team_owners (tournament_id, LOWER(TRIM(team_name)));

-- Refresh Supabase PostgREST schema cache
NOTIFY pgrst, 'reload schema';
