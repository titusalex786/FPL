-- Migration: 20261016000000_harden_admin_users_and_optimize_players_rls.sql
-- Target: Supabase Postgres DB
-- Purpose:
-- 1. Harden public.admin_users: Enable RLS, revoke anon and authenticated privileges, grant to service_role only.
-- 2. Optimize public.players RLS: Replace per-row auth.uid() with (select auth.uid()) to enable InitPlan caching.
-- Note: public.public_teams_view is intentionally left unchanged as an approved safe public projection.

-- =========================================================================
-- 1. HARDEN public.admin_users
-- =========================================================================
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_users FROM anon, authenticated;

GRANT ALL ON TABLE public.admin_users TO service_role;

-- =========================================================================
-- 2. OPTIMIZE public.players RLS POLICIES (InitPlan Caching)
-- =========================================================================
DROP POLICY IF EXISTS "Players read own profile" ON public.players;
DROP POLICY IF EXISTS "Players insert own profile" ON public.players;
DROP POLICY IF EXISTS "Players update own profile" ON public.players;

CREATE POLICY "Players read own profile" ON public.players
    FOR SELECT USING ((select auth.uid()) = auth_user_id);

CREATE POLICY "Players insert own profile" ON public.players
    FOR INSERT WITH CHECK ((select auth.uid()) = auth_user_id);

CREATE POLICY "Players update own profile" ON public.players
    FOR UPDATE USING ((select auth.uid()) = auth_user_id);
