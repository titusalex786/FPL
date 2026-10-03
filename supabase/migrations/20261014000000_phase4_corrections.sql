-- Migration: 20261014000000_phase4_corrections.sql
-- Description: Phase 4 - Add fields for correction workflows and detailed player attributes.

-- 1. Add missing fields to players table
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS jersey_name TEXT,
  ADD COLUMN IF NOT EXISTS jersey_number TEXT,
  ADD COLUMN IF NOT EXISTS bowling_style TEXT;

-- 2. Add snapshot fields to registrations table
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS registered_jersey_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS registered_jersey_number_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS registered_bowling_style_snapshot TEXT;
