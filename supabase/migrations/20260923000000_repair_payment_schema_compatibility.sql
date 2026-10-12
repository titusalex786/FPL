-- Migration: Repair Payment Schema Compatibility for Fresh Installation
-- Timestamp: 20260923000000
-- Target: Supabase / PostgreSQL DB
-- Description:
--   1. Add 'SUCCESSFUL' to public.payment_status enum
--   2. Add nullable payment_status column (coexists with legacy status, no default, no backfill)
--   3. Add missing payment columns required by v2 schema and later migrations:
--      - payment_method TEXT NOT NULL DEFAULT 'UPI_QR'
--      - transaction_reference TEXT
--      - verification_note TEXT

ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'SUCCESSFUL';

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_status public.payment_status,
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'UPI_QR',
  ADD COLUMN IF NOT EXISTS transaction_reference TEXT,
  ADD COLUMN IF NOT EXISTS verification_note TEXT;
