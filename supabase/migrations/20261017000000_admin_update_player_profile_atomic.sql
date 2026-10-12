-- Supabase Forward Migration: 20261017000000_admin_update_player_profile_atomic.sql
-- Application: Cricket Player Registration & Payment Web Application
-- Phase 4A: Atomic Admin Edit Reusable Player Profile & Audit Log RPC
--
-- Purpose:
-- Enforces true database transaction ACID atomicity for master player profile updates
-- and corresponding audit log insertion. Both operations succeed together or fail together.

CREATE OR REPLACE FUNCTION admin_update_player_profile_v1(
  p_player_id UUID,
  p_admin_user_id UUID,
  p_admin_email TEXT,
  p_reason TEXT,
  p_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_changed_fields TEXT[] := ARRAY[]::TEXT[];
  v_old_values JSONB := '{}'::JSONB;
  v_new_values JSONB := '{}'::JSONB;
  v_new_full_name TEXT;
  v_new_mobile TEXT;
  v_new_profile_image_url TEXT;
  v_new_cricket_role cricket_role;
  v_new_batting_style batting_style;
  v_new_bowling_style TEXT;
  v_new_jersey_name TEXT;
  v_new_jersey_number TEXT;
  v_new_jersey_size jersey_size;
  v_updated RECORD;
BEGIN
  -- 1. Validate mandatory edit reason
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'A mandatory edit reason of at least 5 characters is required.'
      USING ERRCODE = '22023';
  END IF;

  -- 2. Lock and fetch existing player profile
  SELECT * INTO v_existing
  FROM players
  WHERE id = p_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Player profile not found',
      'code', 404
    );
  END IF;

  -- 3. Determine candidate values and detect diffs for each allowed field
  -- full_name
  IF p_updates ? 'full_name' THEN
    v_new_full_name := trim(p_updates->>'full_name');
    IF v_new_full_name IS NULL OR length(v_new_full_name) < 2 THEN
      RAISE EXCEPTION 'Full name must be at least 2 characters' USING ERRCODE = '22023';
    END IF;
    IF v_existing.full_name IS DISTINCT FROM v_new_full_name THEN
      v_changed_fields := array_append(v_changed_fields, 'full_name');
      v_old_values := jsonb_set(v_old_values, '{full_name}', to_jsonb(v_existing.full_name));
      v_new_values := jsonb_set(v_new_values, '{full_name}', to_jsonb(v_new_full_name));
    END IF;
  ELSE
    v_new_full_name := v_existing.full_name;
  END IF;

  -- mobile
  IF p_updates ? 'mobile' THEN
    v_new_mobile := NULLIF(trim(p_updates->>'mobile'), '');
    IF v_existing.mobile IS DISTINCT FROM v_new_mobile THEN
      v_changed_fields := array_append(v_changed_fields, 'mobile');
      v_old_values := jsonb_set(v_old_values, '{mobile}', to_jsonb(v_existing.mobile));
      v_new_values := jsonb_set(v_new_values, '{mobile}', to_jsonb(v_new_mobile));
    END IF;
  ELSE
    v_new_mobile := v_existing.mobile;
  END IF;

  -- profile_image_url
  IF p_updates ? 'profile_image_url' THEN
    v_new_profile_image_url := NULLIF(trim(p_updates->>'profile_image_url'), '');
    IF v_existing.profile_image_url IS DISTINCT FROM v_new_profile_image_url THEN
      v_changed_fields := array_append(v_changed_fields, 'profile_image_url');
      v_old_values := jsonb_set(v_old_values, '{profile_image_url}', to_jsonb(v_existing.profile_image_url));
      v_new_values := jsonb_set(v_new_values, '{profile_image_url}', to_jsonb(v_new_profile_image_url));
    END IF;
  ELSE
    v_new_profile_image_url := v_existing.profile_image_url;
  END IF;

  -- cricket_role
  IF p_updates ? 'cricket_role' THEN
    BEGIN
      v_new_cricket_role := (p_updates->>'cricket_role')::cricket_role;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid cricket role: %', p_updates->>'cricket_role' USING ERRCODE = '22023';
    END;
    IF v_existing.cricket_role IS DISTINCT FROM v_new_cricket_role THEN
      v_changed_fields := array_append(v_changed_fields, 'cricket_role');
      v_old_values := jsonb_set(v_old_values, '{cricket_role}', to_jsonb(v_existing.cricket_role::TEXT));
      v_new_values := jsonb_set(v_new_values, '{cricket_role}', to_jsonb(v_new_cricket_role::TEXT));
    END IF;
  ELSE
    v_new_cricket_role := v_existing.cricket_role;
  END IF;

  -- batting_style
  IF p_updates ? 'batting_style' THEN
    IF p_updates->>'batting_style' IS NOT NULL AND p_updates->>'batting_style' != '' THEN
      BEGIN
        v_new_batting_style := (p_updates->>'batting_style')::batting_style;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid batting style: %', p_updates->>'batting_style' USING ERRCODE = '22023';
      END;
    ELSE
      v_new_batting_style := NULL;
    END IF;
    IF v_existing.batting_style IS DISTINCT FROM v_new_batting_style THEN
      v_changed_fields := array_append(v_changed_fields, 'batting_style');
      v_old_values := jsonb_set(v_old_values, '{batting_style}', to_jsonb(v_existing.batting_style::TEXT));
      v_new_values := jsonb_set(v_new_values, '{batting_style}', to_jsonb(v_new_batting_style::TEXT));
    END IF;
  ELSE
    v_new_batting_style := v_existing.batting_style;
  END IF;

  -- bowling_style
  IF p_updates ? 'bowling_style' THEN
    v_new_bowling_style := NULLIF(trim(p_updates->>'bowling_style'), '');
    IF v_existing.bowling_style IS DISTINCT FROM v_new_bowling_style THEN
      v_changed_fields := array_append(v_changed_fields, 'bowling_style');
      v_old_values := jsonb_set(v_old_values, '{bowling_style}', to_jsonb(v_existing.bowling_style));
      v_new_values := jsonb_set(v_new_values, '{bowling_style}', to_jsonb(v_new_bowling_style));
    END IF;
  ELSE
    v_new_bowling_style := v_existing.bowling_style;
  END IF;

  -- jersey_name
  IF p_updates ? 'jersey_name' THEN
    v_new_jersey_name := NULLIF(trim(p_updates->>'jersey_name'), '');
    IF v_existing.jersey_name IS DISTINCT FROM v_new_jersey_name THEN
      v_changed_fields := array_append(v_changed_fields, 'jersey_name');
      v_old_values := jsonb_set(v_old_values, '{jersey_name}', to_jsonb(v_existing.jersey_name));
      v_new_values := jsonb_set(v_new_values, '{jersey_name}', to_jsonb(v_new_jersey_name));
    END IF;
  ELSE
    v_new_jersey_name := v_existing.jersey_name;
  END IF;

  -- jersey_number
  IF p_updates ? 'jersey_number' THEN
    v_new_jersey_number := NULLIF(trim(p_updates->>'jersey_number'), '');
    IF v_existing.jersey_number IS DISTINCT FROM v_new_jersey_number THEN
      v_changed_fields := array_append(v_changed_fields, 'jersey_number');
      v_old_values := jsonb_set(v_old_values, '{jersey_number}', to_jsonb(v_existing.jersey_number));
      v_new_values := jsonb_set(v_new_values, '{jersey_number}', to_jsonb(v_new_jersey_number));
    END IF;
  ELSE
    v_new_jersey_number := v_existing.jersey_number;
  END IF;

  -- jersey_size
  IF p_updates ? 'jersey_size' THEN
    IF p_updates->>'jersey_size' IS NOT NULL AND p_updates->>'jersey_size' != '' THEN
      BEGIN
        v_new_jersey_size := (p_updates->>'jersey_size')::jersey_size;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid jersey size: %', p_updates->>'jersey_size' USING ERRCODE = '22023';
      END;
    ELSE
      v_new_jersey_size := NULL;
    END IF;
    IF v_existing.jersey_size IS DISTINCT FROM v_new_jersey_size THEN
      v_changed_fields := array_append(v_changed_fields, 'jersey_size');
      v_old_values := jsonb_set(v_old_values, '{jersey_size}', to_jsonb(v_existing.jersey_size::TEXT));
      v_new_values := jsonb_set(v_new_values, '{jersey_size}', to_jsonb(v_new_jersey_size::TEXT));
    END IF;
  ELSE
    v_new_jersey_size := v_existing.jersey_size;
  END IF;

  -- 4. If no changes detected: No-Op
  IF array_length(v_changed_fields, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'noOp', true,
      'message', 'No profile changes detected.',
      'changedFields', '[]'::jsonb,
      'player', jsonb_build_object(
        'id', v_existing.id,
        'full_name', v_existing.full_name,
        'email', v_existing.email,
        'mobile', v_existing.mobile,
        'profile_image_url', v_existing.profile_image_url,
        'cricket_role', v_existing.cricket_role,
        'batting_style', v_existing.batting_style,
        'bowling_style', v_existing.bowling_style,
        'jersey_name', v_existing.jersey_name,
        'jersey_number', v_existing.jersey_number,
        'jersey_size', v_existing.jersey_size,
        'created_at', v_existing.created_at,
        'updated_at', v_existing.updated_at
      )
    );
  END IF;

  -- 5. ATOMIC UPDATE: Update players table
  UPDATE players
  SET
    full_name = v_new_full_name,
    mobile = v_new_mobile,
    profile_image_url = v_new_profile_image_url,
    cricket_role = v_new_cricket_role,
    batting_style = v_new_batting_style,
    bowling_style = v_new_bowling_style,
    jersey_name = v_new_jersey_name,
    jersey_number = v_new_jersey_number,
    jersey_size = v_new_jersey_size,
    updated_at = NOW()
  WHERE id = p_player_id
  RETURNING * INTO v_updated;

  -- 6. ATOMIC INSERT: Insert audit log in same PostgreSQL transaction
  INSERT INTO audit_logs (
    admin_user_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  ) VALUES (
    p_admin_user_id,
    'ADMIN_UPDATE_PLAYER_PROFILE',
    'PLAYER',
    p_player_id::TEXT,
    v_old_values,
    jsonb_build_object(
      'changed_fields', to_jsonb(v_changed_fields),
      'reason', trim(p_reason),
      'admin_email', p_admin_email
    ) || v_new_values
  );

  -- 7. Return safe player DTO
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Player profile updated successfully',
    'changedFields', to_jsonb(v_changed_fields),
    'player', jsonb_build_object(
      'id', v_updated.id,
      'full_name', v_updated.full_name,
      'email', v_updated.email,
      'mobile', v_updated.mobile,
      'profile_image_url', v_updated.profile_image_url,
      'cricket_role', v_updated.cricket_role,
      'batting_style', v_updated.batting_style,
      'bowling_style', v_updated.bowling_style,
      'jersey_name', v_updated.jersey_name,
      'jersey_number', v_updated.jersey_number,
      'jersey_size', v_updated.jersey_size,
      'created_at', v_updated.created_at,
      'updated_at', v_updated.updated_at
    )
  );
END;
$$;

-- Security hardening: Restrict execution to service_role only
REVOKE EXECUTE ON FUNCTION admin_update_player_profile_v1(UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_update_player_profile_v1(UUID, UUID, TEXT, TEXT, JSONB) TO service_role;
