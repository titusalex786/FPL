-- Migration: 20261026000000_fix_icon_bowling_style_enum_cast.sql
-- Description: Fix allocate_owner_registration_v4 by removing invalid ::batting_style enum cast
-- on p_icon_bowling_style. The registered_bowling_style_snapshot column is TEXT, allowing
-- valid bowling styles (e.g., RIGHT_ARM_FAST) for Icon players (such as All-rounders or Bowlers)
-- without throwing "invalid input value for enum batting_style: RIGHT_ARM_FAST".

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
    p_icon_mobile,
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

  -- 10. Create Combined Payment Record (Explicit enum cast on payment_status)
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
    RAISE EXCEPTION 'A team owner or team name with this detail already exists for this tournament.';
END;
$$;

NOTIFY pgrst, 'reload schema';
