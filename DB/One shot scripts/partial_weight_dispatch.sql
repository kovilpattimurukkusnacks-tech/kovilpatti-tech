-- ============================================================
-- 25-Jul-2026 — Partial-weight dispatch capability (Order side)
-- ============================================================
-- Adds fields + helpers so the godown can dispatch a partial-weight pack
-- (e.g. 3 kg from a 5 kg SKU) instead of an integer packet count. Every
-- rollup — request detail, list, Accounts KPIs — recomputes via the new
-- effective-pack-qty helpers.
--
-- DEPLOY ORDER (UAT / PROD):
--   1. Run THIS one-shot   → ALTER TABLE + 3 helper SQL functions
--   2. Run phase2_procedures.sql  → dispatch/receive/get/list SPs use the helpers
--   3. Run phase3_procedures.sql  → Accounts SPs (summary/trend/by-shop/…) use them
--   4. Run phase4_shop_inventory_procedures.sql → opening-balance bootstrap uses them
--
-- Files 2-4 are all CREATE OR REPLACE so they're safe to re-run any
-- number of times. Only THIS one-shot mutates data schema.
--
-- Idempotent: every ALTER is guarded with a NOT EXISTS check so re-running
-- on a DB that already picked up the migration is a no-op.
-- ============================================================

BEGIN;

-- ── 1. New columns on stock_request_items ────────────────────
--
-- Order-side partial-weight dispatch (dispatched_weight_g) + shop's
-- receive-time correction of same (received_weight_g) + WIP draft
-- companion (draft_dispatched_weight_g). All nullable — NULL keeps
-- rows in packet-count mode (existing behaviour, no data migration
-- needed).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_request_items' AND column_name = 'dispatched_weight_g'
  ) THEN
    ALTER TABLE stock_request_items ADD COLUMN dispatched_weight_g numeric(10,3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_request_items' AND column_name = 'received_weight_g'
  ) THEN
    ALTER TABLE stock_request_items ADD COLUMN received_weight_g numeric(10,3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_request_items' AND column_name = 'draft_dispatched_weight_g'
  ) THEN
    ALTER TABLE stock_request_items ADD COLUMN draft_dispatched_weight_g numeric(10,3);
  END IF;
END $$;


-- ── 2. Bounds + XOR check constraints ────────────────────────
--
-- Positive-only when set (0-weight dispatch is meaningless — use
-- dispatched_qty=0 for "explicitly nothing shipped"). Mutual-exclusion
-- with the packet-count counterpart per leg (dispatch / receive / draft).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_dispatched_weight_g_bounds'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_dispatched_weight_g_bounds
        CHECK (dispatched_weight_g IS NULL OR dispatched_weight_g > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_received_weight_g_bounds'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_received_weight_g_bounds
        CHECK (received_weight_g IS NULL OR received_weight_g > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_draft_dispatched_weight_g_bounds'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_draft_dispatched_weight_g_bounds
        CHECK (draft_dispatched_weight_g IS NULL OR draft_dispatched_weight_g > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_dispatched_qty_xor_weight'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_dispatched_qty_xor_weight
        CHECK (dispatched_qty IS NULL OR dispatched_weight_g IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_received_qty_xor_weight'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_received_qty_xor_weight
        CHECK (received_qty IS NULL OR received_weight_g IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_draft_dispatched_qty_xor_weight'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_draft_dispatched_qty_xor_weight
        CHECK (draft_dispatched_qty IS NULL OR draft_dispatched_weight_g IS NULL);
  END IF;
END $$;


-- ── 3. Effective-pack-qty helpers ────────────────────────────
--
-- Converts (qty, weight_g) → effective packet-equivalent count. Used
-- across every rollup so partial-weight rows contribute proportionally.
-- Priority per leg: weight_g populated → weight_g / pack_g ; qty
-- populated → qty::numeric ; neither → NULL.

CREATE OR REPLACE FUNCTION fn_effective_pack_qty(
  p_qty          int,
  p_weight_g     numeric,
  p_weight_value numeric,
  p_weight_unit  varchar
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_weight_g IS NOT NULL AND p_weight_value IS NOT NULL AND p_weight_value > 0 THEN
      p_weight_g / (p_weight_value * CASE p_weight_unit WHEN 'kg' THEN 1000 ELSE 1 END)
    WHEN p_qty IS NOT NULL THEN
      p_qty::numeric
    ELSE
      NULL
  END;
$$;

-- Order-side effective qty — received leg wins over dispatched, falls
-- back to requested.
CREATE OR REPLACE FUNCTION fn_order_effective_qty(
  p_received_qty        int,
  p_received_weight_g   numeric,
  p_dispatched_qty      int,
  p_dispatched_weight_g numeric,
  p_requested_qty       int,
  p_weight_value        numeric,
  p_weight_unit         varchar
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    fn_effective_pack_qty(p_received_qty,   p_received_weight_g,   p_weight_value, p_weight_unit),
    fn_effective_pack_qty(p_dispatched_qty, p_dispatched_weight_g, p_weight_value, p_weight_unit),
    p_requested_qty::numeric
  );
$$;

-- Return-side effective qty — return_weight_g partial (if present) beats
-- dispatched_qty (accepted-qty on Returns), falls back to requested.
-- Also fixes an existing gap: partial-weight Returns (02-Jul-2026 feature)
-- were never rolled into Accounts.
CREATE OR REPLACE FUNCTION fn_return_effective_qty(
  p_dispatched_qty  int,
  p_return_weight_g numeric,
  p_requested_qty   int,
  p_weight_value    numeric,
  p_weight_unit     varchar
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    fn_effective_pack_qty(p_dispatched_qty, p_return_weight_g, p_weight_value, p_weight_unit),
    p_requested_qty::numeric
  );
$$;

COMMIT;

-- ── 4. Follow-up ──────────────────────────────────────────────
-- Now run these files in order:
--   \i phase2/phase2_procedures.sql
--   \i phase3/phase3_procedures.sql
--   \i phase4/phase4_shop_inventory_procedures.sql
-- All three use CREATE OR REPLACE — safe on any existing install.
