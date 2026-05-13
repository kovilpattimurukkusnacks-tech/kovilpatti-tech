-- ============================================================
-- Phase 1 follow-up: add `gst` column to products.
-- Idempotent — safe to re-run.
--
-- The column is plumbed end-to-end (table, SPs, DTOs, API) but
-- HIDDEN in the FE (no form field, no table column, no Excel
-- import column). Client will expose it in a later phase.
--
-- Run order: AFTER phase1_init.sql, BEFORE rerunning
-- phase1_procedures.sql (the SPs now reference this column).
-- ============================================================

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS gst numeric(5,2);

-- Range guard — same shape as the inline CHECK in phase1_init.sql so a
-- fresh DB and a migrated DB end up with identical constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_gst_range'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT chk_products_gst_range
      CHECK (gst IS NULL OR (gst >= 0 AND gst <= 100));
  END IF;
END $$;

COMMIT;
