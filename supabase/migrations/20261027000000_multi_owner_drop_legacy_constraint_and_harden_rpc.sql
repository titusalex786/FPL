-- Migration: 20261027000000_multi_owner_drop_legacy_constraint_and_harden_rpc.sql
-- Description: Drop legacy unique_tournament_owner_player constraint on team_owners to allow
-- one authenticated account/email to register multiple teams in the same tournament under different
-- team names, and update allocate_owner_registration_v4 with precise stacked diagnostics exception handling.

-- 1. Drop the legacy unique constraint preventing a player from owning multiple teams in a tournament
ALTER TABLE team_owners DROP CONSTRAINT IF EXISTS unique_tournament_owner_player;
DROP INDEX IF EXISTS unique_tournament_owner_player;

-- 1b. Ensure players.registration_reference is nullable if present (aligned with modern players schema)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'players' AND column_name = 'registration_reference'
  ) THEN
    ALTER TABLE players ALTER COLUMN registration_reference DROP NOT NULL;
  END IF;
END $$;

-- 1c. Ensure payments.order_id is nullable if present (aligned with modern payments schema)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE payments ALTER COLUMN order_id DROP NOT NULL;
  END IF;
END $$;

-- 2. Preserve and enforce team name uniqueness per tournament (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_owners_tournament_team_name 
  ON team_owners (tournament_id, LOWER(TRIM(team_name)));

-- 3. Preserve atomic 1:1 owner registration per team_owner
CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_owner_team_owner 
  ON registrations (tournament_id, team_owner_id) 
  WHERE registration_type = 'OWNER' AND team_owner_id IS NOT NULL;

-- 4. Preserve atomic 1:1 icon registration per team_owner
CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_icon_team_owner 
  ON registrations (tournament_id, team_owner_id) 
  WHERE registration_type = 'ICON' AND team_owner_id IS NOT NULL;

-- 5. Preserve strict uniqueness for standard PLAYER registrations
CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_player_tournament 
  ON registrations (tournament_id, player_id) 
  WHERE registration_type = 'PLAYER';

-- 6. Update allocate_owner_registration_v4 with stacked diagnostics for precise error reporting
CREATE OR REPLACE FUNCTION public.allocate_owner_registration_v4(
  p_tournament_id UUID,
  p_owner_player_id UUID,
  p_owner_name TEXT,
  p_contact_email TEXT,
  p_contact_phone TEXT,
  p_team_name TEXT,
  p_owner_role TEXT DEFAULT 'BATSMAN',
  p_owner_batting_style TEXT DEFAULT 'RIGHT_HAND',
  p_owner_bowling_style TEXT DEFAULT NULL,
  p_owner_jersey_size TEXT DEFAULT 'M',
  p_owner_image_snapshot TEXT DEFAULT NULL,
  p_team_logo_url TEXT DEFAULT NULL,
  p_screenshot_bucket TEXT DEFAULT 'payment-screenshots',
  p_screenshot_object_path TEXT DEFAULT NULL,
  p_icon_name TEXT DEFAULT NULL,
  p_icon_mobile TEXT DEFAULT NULL,
  p_icon_role TEXT DEFAULT NULL,
  p_icon_batting_style TEXT DEFAULT NULL,
  p_icon_bowling_style TEXT DEFAULT NULL,
  p_icon_existing_player_id UUID DEFAULT NULL,
  p_created_by_auth_id UUID DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'UPI_QR',
  p_icon_image_snapshot TEXT DEFAULT NULL,
  p_owner_jersey_name TEXT DEFAULT NULL,
  p_owner_jersey_number TEXT DEFAULT NULL,
  p_icon_jersey_name TEXT DEFAULT NULL,
  p_icon_jersey_number TEXT DEFAULT NULL,
  p_icon_jersey_size TEXT DEFAULT 'M'
)
RETURNS TABLE (
  owner_id UUID,
  slot_number INTEGER,
  owner_registration_id UUID,
  icon_registration_id UUID,
  payment_id UUID,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_teams INT;
  v_max_players INT;
  v_owner_fee INT;
  v_player_fee INT;
  v_total_fee INT;
  v_current_teams INT;
  v_active_players INT;
  v_slot_num INT;
  v_owner_id UUID;
  v_owner_reg_id UUID;
  v_icon_player_id UUID;
  v_icon_reg_id UUID;
  v_pay_id UUID;
  v_owner_reg_num TEXT;
  v_icon_reg_num TEXT;
  v_initial_pay_status TEXT;
  v_constraint_name TEXT;
BEGIN
  -- 1. Lock tournament row for update
  SELECT
    t.max_teams,
    t.max_players,
    t.owner_registration_fee,
    t.registration_fee
  INTO
    v_max_teams,
    v_max_players,
    v_owner_fee,
    v_player_fee
  FROM tournaments t
  WHERE t.id = p_tournament_id AND t.tournament_type = 'OWNER_BASED'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owner-based tournament not found';
  END IF;

  -- 2. Verify Owner Slot Capacity (1 Owner Slot required)
  SELECT COUNT(*) INTO v_current_teams
  FROM team_owners o
  WHERE o.tournament_id = p_tournament_id;

  IF v_current_teams >= v_max_teams THEN
    RAISE EXCEPTION 'All owner slots for this tournament have been filled';
  END IF;

  -- 3. Verify Player Slot Capacity (2 Player Slots required: Owner Player #1 + Icon Player #2)
  SELECT COUNT(*) INTO v_active_players
  FROM registrations r
  WHERE r.tournament_id = p_tournament_id
    AND r.registration_status IN ('CONFIRMED', 'PENDING');

  IF (v_max_players - v_active_players) < 2 THEN
    RAISE EXCEPTION 'Insufficient player slots remaining for Owner + Icon registration (requires 2 player slots)';
  END IF;

  -- 4. Calculate next slot number
  SELECT COALESCE(MAX(t_owners.slot_number), 0) INTO v_current_teams
  FROM team_owners t_owners
  WHERE t_owners.tournament_id = p_tournament_id;

  v_slot_num := v_current_teams + 1;
  v_total_fee := COALESCE(v_owner_fee, 0) + COALESCE(v_player_fee, 0);

  v_initial_pay_status := CASE
    WHEN p_payment_method = 'ACKNOWLEDGE_BY_ORGANISER' THEN 'AWAITING_ORGANISER_ACKNOWLEDGEMENT'
    ELSE 'PENDING'
  END;

  -- 5. Create Team Owner Record
  INSERT INTO team_owners (
    tournament_id,
    player_id,
    owner_name,
    contact_email,
    contact_phone,
    team_name,
    team_logo_url,
    slot_number,
    status,
    payment_status,
    created_by_auth_id,
    registered_at,
    updated_at
  ) VALUES (
    p_tournament_id,
    p_owner_player_id,
    p_owner_name,
    p_contact_email,
    p_contact_phone,
    p_team_name,
    p_team_logo_url,
    v_slot_num,
    'PENDING',
    v_initial_pay_status,
    p_created_by_auth_id,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_owner_id;

  -- 6. Create Owner Registration Record (Owner as Player #1)
  v_owner_reg_num := 'OWNER-' || UPPER(SUBSTRING(p_tournament_id::text, 1, 4)) || '-' || LPAD(v_slot_num::text, 3, '0');

  INSERT INTO registrations (
    tournament_id,
    player_id,
    registration_number,
    registration_status,
    registration_type,
    team_name,
    team_owner_id,
    created_by_auth_id,
    registered_name_snapshot,
    registered_role_snapshot,
    registered_batting_style_snapshot,
    registered_bowling_style_snapshot,
    registered_jersey_size_snapshot,
    registered_jersey_name_snapshot,
    registered_jersey_number_snapshot,
    registered_image_snapshot,
    registered_at,
    updated_at
  ) VALUES (
    p_tournament_id,
    p_owner_player_id,
    v_owner_reg_num,
    'PENDING'::registration_status,
    'OWNER',
    p_team_name,
    v_owner_id,
    p_created_by_auth_id,
    p_owner_name,
    COALESCE(NULLIF(TRIM(p_owner_role), ''), 'BATSMAN')::cricket_role,
    COALESCE(NULLIF(TRIM(p_owner_batting_style), ''), 'RIGHT_HAND')::batting_style,
    CASE WHEN p_owner_bowling_style IS NOT NULL AND TRIM(p_owner_bowling_style) <> '' THEN TRIM(p_owner_bowling_style) ELSE NULL END,
    COALESCE(NULLIF(TRIM(p_owner_jersey_size), ''), 'M'),
    COALESCE(NULLIF(TRIM(p_owner_jersey_name), ''), p_owner_name),
    NULLIF(TRIM(p_owner_jersey_number), ''),
    COALESCE(p_owner_image_snapshot, ''),
    NOW(),
    NOW()
  )
  RETURNING id INTO v_owner_reg_id;

  -- 7. Create Unclaimed Icon Player Profile (Player #2)
  INSERT INTO players (
    full_name,
    mobile,
    profile_image_url,
    jersey_name,
    jersey_number,
    is_tournament_only,
    player_type,
    created_at,
    updated_at
  ) VALUES (
    COALESCE(p_icon_name, 'Icon Player'),
    COALESCE(p_icon_mobile, p_contact_phone),
    p_icon_image_snapshot,
    COALESCE(NULLIF(TRIM(p_icon_jersey_name), ''), p_icon_name),
    NULLIF(TRIM(p_icon_jersey_number), ''),
    true,
    'ICON',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_icon_player_id;

  -- 8. Create Icon Registration Record (Icon as Player #2)
  v_icon_reg_num := 'ICON-' || UPPER(SUBSTRING(p_tournament_id::text, 1, 4)) || '-' || LPAD(v_slot_num::text, 3, '0');

  INSERT INTO registrations (
    tournament_id,
    player_id,
    registration_number,
    registration_status,
    registration_type,
    team_name,
    team_owner_id,
    created_by_auth_id,
    registered_name_snapshot,
    registered_role_snapshot,
    registered_batting_style_snapshot,
    registered_bowling_style_snapshot,
    registered_jersey_size_snapshot,
    registered_jersey_name_snapshot,
    registered_jersey_number_snapshot,
    registered_image_snapshot,
    registered_at,
    updated_at
  ) VALUES (
    p_tournament_id,
    v_icon_player_id,
    v_icon_reg_num,
    'PENDING'::registration_status,
    'ICON',
    p_team_name,
    v_owner_id,
    p_created_by_auth_id,
    COALESCE(p_icon_name, 'Icon Player'),
    COALESCE(NULLIF(TRIM(p_icon_role), ''), 'BATSMAN')::cricket_role,
    CASE WHEN p_icon_batting_style IS NOT NULL AND TRIM(p_icon_batting_style) <> '' THEN TRIM(p_icon_batting_style)::batting_style ELSE NULL END,
    CASE WHEN p_icon_bowling_style IS NOT NULL AND TRIM(p_icon_bowling_style) <> '' THEN TRIM(p_icon_bowling_style) ELSE NULL END,
    COALESCE(NULLIF(TRIM(p_icon_jersey_size), ''), 'M'),
    COALESCE(NULLIF(TRIM(p_icon_jersey_name), ''), p_icon_name),
    NULLIF(TRIM(p_icon_jersey_number), ''),
    COALESCE(p_icon_image_snapshot, ''),
    NOW(),
    NOW()
  )
  RETURNING id INTO v_icon_reg_id;

  -- 9. Link both Registrations back to Team Owner record
  UPDATE team_owners
  SET owner_registration_id = v_owner_reg_id,
      icon_registration_id = v_icon_reg_id
  WHERE id = v_owner_id;

  -- 10. Create Combined Payment Record
  INSERT INTO payments (
    registration_id,
    team_owner_id,
    amount,
    owner_fee_paise,
    player_fee_paise,
    payment_status,
    payment_method,
    screenshot_bucket,
    screenshot_object_path,
    created_at,
    updated_at
  ) VALUES (
    v_owner_reg_id,
    v_owner_id,
    v_total_fee,
    COALESCE(v_owner_fee, 0),
    COALESCE(v_player_fee, 0),
    v_initial_pay_status::payment_status,
    p_payment_method,
    p_screenshot_bucket,
    p_screenshot_object_path,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_pay_id;

  RETURN QUERY SELECT v_owner_id, v_slot_num, v_owner_reg_id, v_icon_reg_id, v_pay_id, 'PENDING'::text;
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name = 'uq_team_owners_tournament_team_name' THEN
      RAISE EXCEPTION 'This team name is already registered for this tournament. Please choose another team name.';
    ELSIF v_constraint_name = 'uq_registrations_owner_team_owner' THEN
      RAISE EXCEPTION 'You are already registered as a team owner for this tournament.';
    ELSIF v_constraint_name = 'uq_registrations_icon_team_owner' THEN
      RAISE EXCEPTION 'An icon player registration already exists for this team.';
    ELSIF v_constraint_name = 'unique_tournament_owner_slot' THEN
      RAISE EXCEPTION 'Registration slot collision. Please try again.';
    ELSE
      RAISE EXCEPTION 'We could not complete the owner registration. Please try again or contact the organiser.';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
