-- ============================================================
-- Phase 2 — relax dispatch qty upper bound
--
-- Removes the "dispatched_qty <= requested_qty" cap on both
-- chk_dispatched_qty_bounds and chk_draft_dispatched_qty_bounds.
-- Inventory users can now dispatch more than the requested qty
-- (e.g. forced minimum case-size, last-mile rounding) — only the
-- non-negative lower bound is enforced from now on.
--
-- Run this on environments that already have phase 2 deployed.
-- Fresh phase-2 deploys pick up the relaxed constraint via
-- phase2_init.sql directly.
--
-- Idempotent — DROP IF EXISTS + ADD CONSTRAINT.
-- ============================================================

BEGIN;

ALTER TABLE stock_request_items
  DROP CONSTRAINT IF EXISTS chk_dispatched_qty_bounds;

ALTER TABLE stock_request_items
  ADD CONSTRAINT chk_dispatched_qty_bounds
  CHECK (dispatched_qty IS NULL OR dispatched_qty >= 0);

ALTER TABLE stock_request_items
  DROP CONSTRAINT IF EXISTS chk_draft_dispatched_qty_bounds;

ALTER TABLE stock_request_items
  ADD CONSTRAINT chk_draft_dispatched_qty_bounds
  CHECK (draft_dispatched_qty IS NULL OR draft_dispatched_qty >= 0);

COMMIT;

-- ============================================================
-- VERIFY
--   \d+ stock_request_items
--   → chk_dispatched_qty_bounds should now read:
--       CHECK (dispatched_qty IS NULL OR dispatched_qty >= 0)
--   → chk_draft_dispatched_qty_bounds similarly.
-- ============================================================
