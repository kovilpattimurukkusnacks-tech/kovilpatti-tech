-- ============================================================
-- Phase 4c — Weight-based (loose) sale (upgrade-only)
-- ------------------------------------------------------------
-- 1. Adds products.sold_loose.
-- 2. Restructures bill_items: qty becomes nullable, new
--    loose_weight_g + pack_weight_g_snapshot, line_total moves from a
--    GENERATED column to a regular column filled by fn_bill_create.
-- 3. Replaces fn_bill_create + fn_bill_get_items + fn_billing_products
--    + fn_bill_cancel + fn_bill_returnable_items with loose-aware bodies.
--
-- Depends on Phase 4c bill-level discount (phase4c_bill_discount.sql).
--
-- Author: Ramji J G   —   2026-08-01
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. products.sold_loose
-- ------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_loose boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- 2. bill_items schema changes
-- ------------------------------------------------------------

-- 2a. line_total: drop GENERATED, add regular column and backfill.
DO $$
DECLARE
  v_is_generated text;
BEGIN
  SELECT is_generated INTO v_is_generated
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'bill_items' AND column_name = 'line_total';

  IF v_is_generated = 'ALWAYS' THEN
    -- Recreate as a regular column and refill.
    ALTER TABLE bill_items DROP COLUMN line_total;
    ALTER TABLE bill_items ADD COLUMN line_total numeric(12,2);
    UPDATE bill_items SET line_total = qty * unit_price WHERE line_total IS NULL;
    ALTER TABLE bill_items ALTER COLUMN line_total SET NOT NULL;
  END IF;
END$$;

-- 2b. loose_weight_g + pack_weight_g_snapshot columns.
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS loose_weight_g         numeric(10,3);
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS pack_weight_g_snapshot numeric(10,3);

-- 2c. qty must become nullable so a loose-only line has (NULL, some grams).
ALTER TABLE bill_items ALTER COLUMN qty DROP NOT NULL;

-- 2d. Old chk_bill_items_qty_pos needed qty > 0 always — now needs to
-- allow qty=NULL too. Drop and re-add.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_items_qty_pos') THEN
    ALTER TABLE bill_items DROP CONSTRAINT chk_bill_items_qty_pos;
  END IF;
  ALTER TABLE bill_items ADD CONSTRAINT chk_bill_items_qty_pos
    CHECK (qty IS NULL OR qty > 0);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_items_mode') THEN
    ALTER TABLE bill_items ADD CONSTRAINT chk_bill_items_mode
      CHECK ((qty IS NOT NULL) <> (loose_weight_g IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_items_loose_pos') THEN
    ALTER TABLE bill_items ADD CONSTRAINT chk_bill_items_loose_pos
      CHECK (loose_weight_g IS NULL OR loose_weight_g > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bill_items_loose_pack_snapshot') THEN
    ALTER TABLE bill_items ADD CONSTRAINT chk_bill_items_loose_pack_snapshot
      CHECK ((loose_weight_g IS NULL)
             OR (pack_weight_g_snapshot IS NOT NULL AND pack_weight_g_snapshot > 0));
  END IF;
END$$;

COMMIT;

-- SPs live in phase4/phase4_billing_procedures.sql. Run that file next.
-- ============================================================
