-- Migration: 20261016000001_repair_players_jersey_size.sql
-- Description: Forward repair migration to add missing jersey_size enum and column on players table.
-- Idempotent and strictly additive. No existing business rows are modified.

DO $$ BEGIN
    CREATE TYPE public.jersey_size AS ENUM ('S', 'M', 'L', 'XL', 'XXL', '3XL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE public.players
    ADD COLUMN IF NOT EXISTS jersey_size public.jersey_size;
