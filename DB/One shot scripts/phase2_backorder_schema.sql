-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Back-order feature: schema migration (one-shot upgrade)
-- 01-Jul-2026
--
-- Additive-only schema changes. Existing rows unchanged; existing SPs
-- continue to work — Backorder just becomes a new request_type value
-- that no live row uses yet.
--
-- Changes:
--   1. Extend request_type enum with 'Backorder'.
--   2. Add stock_requests.parent_request_id (nullable FK).
--   3. Add stock_requests.expected_arrival_at (nullable timestamp).
--   4. Add products.is_vendor_procured (default false).
--   5. Add chk_parent_only_for_backorders check constraint.
--
-- Safe to re-run: every step guards with IF NOT EXISTS or catches the
-- duplicate exception.
--
-- Runs BEFORE the back-order SPs / BE / FE deploy — the DB can accept
-- the new columns while the existing app carries on unchanged. No
-- downtime required. See DB/planned/backorder_requests.md.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. request_type enum — append 'Backorder'.
-- Postgres 12+ supports ADD VALUE IF NOT EXISTS without a table rewrite.
DO $$ BEGIN
  ALTER TYPE request_type ADD VALUE IF NOT EXISTS 'Backorder';
EXCEPTION
  -- If somehow already present via a manual add, swallow. Safe to re-run.
  WHEN others THEN NULL;
END $$;


-- 2. stock_requests.parent_request_id — nullable FK back to stock_requests.
ALTER TABLE stock_requests
  ADD COLUMN IF NOT EXISTS parent_request_id uuid
    REFERENCES stock_requests(id) ON DELETE SET NULL;


-- 3. stock_requests.expected_arrival_at — nullable ETA on a Backorder.
ALTER TABLE stock_requests
  ADD COLUMN IF NOT EXISTS expected_arrival_at timestamptz;


-- 4. products.is_vendor_procured — default false; backfills every legacy row.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_vendor_procured boolean NOT NULL DEFAULT false;


-- 5. chk_parent_only_for_backorders — mirror the existing
--    chk_source_only_for_returns pattern. Only Backorder rows can carry a
--    parent_request_id. Guard with a DO block so re-runs don't error.
--
-- Cast to ::text on both sides so this doesn't trip Postgres' "unsafe use
-- of new value" (55P04) error when this script runs in a single txn on a
-- DB that didn't already have the 'Backorder' enum value. The comparison
-- semantics are identical to `request_type = 'Backorder'`.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_parent_only_for_backorders'
  ) THEN
    ALTER TABLE stock_requests
      ADD CONSTRAINT chk_parent_only_for_backorders
      CHECK (parent_request_id IS NULL OR request_type::text = 'Backorder');
  END IF;
END $$;


-- 6. Reverse-lookup index on parent_request_id — used by:
--    - fn_request_get to fetch the linked child on parent detail pages
--    - fn_accounts_by_shop to roll child amounts under parent's shop
-- Partial index (only Backorder rows will populate it) keeps the index
-- small. Same pattern as idx_stock_requests_source_request for Returns.
CREATE INDEX IF NOT EXISTS idx_stock_requests_parent_request
  ON stock_requests(parent_request_id)
  WHERE parent_request_id IS NOT NULL;
