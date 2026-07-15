-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Special Request rework (replaces godown-initiated Back-order)
-- 06-Jul-2026
--
-- Client redirect: the godown-initiated "carve items out into a linked
-- Backorder" flow is being replaced with a shop-initiated "Special
-- Request" declaration on the review/submit step. Sticky banner across
-- shop / inv / admin until the shop confirms Received.
--
-- This script performs the destructive schema migration + row conversion
-- that CANNOT be re-run from the phase2 source files idempotently.
-- Everything else (SP DDL) lives in DB/phase2/phase2_procedures.sql and
-- DB/phase2/phase2_init.sql — re-running those installs the new shapes.
--
-- Run order:
--   1. This one-shot script (schema + rows)
--   2. Re-run DB/phase2/phase2_procedures.sql   (SP rewrites)
--   3. Re-run DB/phase1/phase1_procedures.sql   (product SP signature drops
--                                                for is_vendor_procured)
--   4. Re-run DB/phase1/phase1_pagination.sql   (fn_product_list_paged
--                                                RETURNS shape change)
--   5. Re-run DB/phase1/phase1_products_optimizations.sql
--   6. Re-run DB/phase3/phase3_procedures.sql   (accounts SPs — legacy
--                                                Backorder enum reference
--                                                collapsed to Order only;
--                                                fn_accounts_adjustments +
--                                                fn_accounts_in_transit
--                                                also gain Special columns
--                                                as of 06-Jul-2026)
--
-- Idempotent — safe to re-run. Uses IF EXISTS / IF NOT EXISTS + row-level
-- guards so a second execution is a no-op.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ------------------------------------------------------------
-- 1. stock_requests — new columns
-- ------------------------------------------------------------
ALTER TABLE stock_requests
  ADD COLUMN IF NOT EXISTS is_special    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS special_label varchar(120);

-- The label only exists on rows that are actually special. Guards against
-- stray labels being written when the shop toggles Special off.
DO $$ BEGIN
  ALTER TABLE stock_requests
    ADD CONSTRAINT chk_special_label_only_when_special
    CHECK (special_label IS NULL OR is_special = true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 2. Drop the retired back-order-only constraint + index FIRST.
--    chk_parent_only_for_backorders enforces "any row with
--    parent_request_id set must be request_type='Backorder'". The row
--    conversion in step 3 flips those rows to 'Order' while
--    parent_request_id is still populated, so the constraint must go
--    first — otherwise Postgres rejects the UPDATE with 23514.
-- ------------------------------------------------------------
ALTER TABLE stock_requests DROP CONSTRAINT IF EXISTS chk_parent_only_for_backorders;
DROP INDEX  IF EXISTS idx_stock_requests_parent_request;

-- ------------------------------------------------------------
-- 3. Convert existing Backorder rows → Order + is_special=true
--
-- Preserves history. Every migrated row becomes a normal Order that
-- happens to be flagged Special. Label defaults to "Legacy back-order"
-- so anyone reviewing the historical row can see it came from the
-- retired flow.
-- ------------------------------------------------------------
UPDATE stock_requests
SET    request_type  = 'Order',
       is_special    = true,
       special_label = COALESCE(special_label, 'Legacy back-order')
WHERE  request_type::text = 'Backorder';

-- ------------------------------------------------------------
-- 4. Drop the now-orphaned back-order columns. Both were meaningful
--    only under the retired flow (parent_request_id linked children;
--    expected_arrival_at held the vendor ETA).
-- ------------------------------------------------------------
ALTER TABLE stock_requests DROP COLUMN IF EXISTS parent_request_id;
ALTER TABLE stock_requests DROP COLUMN IF EXISTS expected_arrival_at;

-- ------------------------------------------------------------
-- 5. Drop products.is_vendor_procured.
--    The flag pre-checked "likely to need vendor procurement" lines on
--    the godown dispatch dialog — obsolete now that the shop declares
--    specialness up-front. Dependent function overloads are dropped from
--    DB/phase1/phase1_procedures.sql on next re-run.
-- ------------------------------------------------------------
ALTER TABLE products DROP COLUMN IF EXISTS is_vendor_procured;

-- ------------------------------------------------------------
-- 6. Sticky-banner index. Small partial over the un-received Special set
--    that the cross-role banner query walks every page load.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stock_requests_active_specials
  ON stock_requests(status, shop_id)
  WHERE is_special = true AND is_deleted = false AND status IN ('Pending','Approved','Dispatched');

-- ------------------------------------------------------------
-- 7. Retired SPs — drop so the new procedures file's DROP guards land
--    on a clean slate. Also handles fn_product_* signature drift from
--    the removed is_vendor_procured param.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_request_move_to_backorder(uuid, uuid[], uuid, timestamptz);
DROP FUNCTION IF EXISTS fn_request_move_to_backorder(uuid, jsonb, uuid, timestamptz);
DROP FUNCTION IF EXISTS fn_request_list_outstanding_backorders(uuid, uuid[]);

DROP FUNCTION IF EXISTS fn_product_create(varchar, varchar, int, varchar, numeric, varchar, numeric, numeric, numeric, boolean, boolean, uuid);
DROP FUNCTION IF EXISTS fn_product_update(uuid, varchar, varchar, int, varchar, numeric, varchar, numeric, numeric, numeric, boolean, boolean, uuid);
DROP FUNCTION IF EXISTS fn_product_list(varchar, int);
DROP FUNCTION IF EXISTS fn_product_get(uuid);
DROP FUNCTION IF EXISTS fn_product_list_paged(varchar, int[], varchar[], int, int);
DROP FUNCTION IF EXISTS fn_request_create(varchar, uuid, uuid, timestamptz, varchar, jsonb, uuid);

COMMIT;

DO $$ BEGIN
  RAISE NOTICE 'phase2_special_request_rework — schema + rows migrated. Now re-run: phase1_procedures.sql, phase1_pagination.sql, phase1_products_optimizations.sql, phase2_procedures.sql, phase3_procedures.sql (order documented in header).';
END $$;
