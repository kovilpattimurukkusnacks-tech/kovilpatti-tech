-- ============================================================
-- phase2_onhold_status_migration_01_enum.sql   (STEP 1 of 2)
--
-- Adds the 'On-Hold' value to the request_status enum.
--
-- ⚠️ RUN THIS FILE FIRST, ON ITS OWN, AND LET IT COMMIT before running
--    step 2. PostgreSQL forbids USING a newly added enum value in the same
--    transaction that adds it ("unsafe use of new value"). The Supabase SQL
--    Editor runs a pasted script as a single transaction, so step 2 (which
--    references 'On-Hold' in an index predicate and a SQL function) MUST run
--    in a separate execution after this one has committed.
--
-- Idempotent: safe to re-run (ADD VALUE IF NOT EXISTS).
-- ============================================================

ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'On-Hold';
