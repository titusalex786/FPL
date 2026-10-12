-- Repair legacy schema gaps before the v4 compatibility migration.
ALTER TYPE public.registration_status ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE public.registration_status ADD VALUE IF NOT EXISTS 'WAITING_LIST';
ALTER TYPE public.registration_status ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS profile_image_url TEXT,
  ADD COLUMN IF NOT EXISTS cricket_role public.cricket_role,
  ADD COLUMN IF NOT EXISTS batting_style public.batting_style,
  ADD COLUMN IF NOT EXISTS jersey_size public.jersey_size;

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS registration_status public.registration_status;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS max_players INTEGER,
  ADD COLUMN IF NOT EXISTS registration_open BOOLEAN;
