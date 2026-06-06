-- ============================================================
-- Kovilpatti Snacks — Phase 3 SCHEMA (DDL)
--
-- Phase 3 = Accounts integration. v1 ships read-only reporting SPs only
-- (see phase3_procedures.sql) and introduces NO new tables. This file is
-- the placeholder shell so the canonical phase{N}_init / phase{N}_procedures
-- naming convention from CLAUDE.md is honoured and so future Phase 3 work
-- (period locks, posting tables, external-ledger queues) has an obvious
-- home.
--
-- Re-runnable: this script is intentionally a no-op transaction. Running it
-- against any database has zero effect.
--
-- TIMEZONE POLICY: same as Phase 2 — all timestamps in UTC; reporting SPs
-- convert at the boundary via AT TIME ZONE 'Asia/Kolkata'.
-- ============================================================
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase3/phase3_init.sql
-- ============================================================

BEGIN;

-- No tables in v1. Reporting reads exclusively from Phase 1 / Phase 2 tables.

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- This file ran successfully if the transaction committed (no errors).
-- ============================================================
