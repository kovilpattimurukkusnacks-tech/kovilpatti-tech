-- ============================================================
-- Kovilpatti Snacks — TARGETED RESET (catalogue + stock requests)
--
-- Wipes ONLY:
--   • Stock requests (+ items + qty audits, cascade)
--   • Products
--   • Categories
--
-- PRESERVES:
--   • Admin user + every shop_user / inventory user account
--   • Shops
--   • Inventories
--   • App settings (cutoff time, lock toggle)
--
-- Use this when you want to re-import the catalogue from Excel
-- without losing user / shop / godown setup.
--
-- ⚠ HARD DELETE. No going back. Take a Supabase snapshot first
--    on any environment that isn't local-dev.
--
-- HOW TO RUN
--   Supabase: SQL Editor → paste → click Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase2_reset_catalogue_and_requests.sql
-- ============================================================

BEGIN;

------------------------------------------------------------------
-- 1. Stock requests — MUST go first.
--    stock_request_items.product_id is ON DELETE RESTRICT, so any
--    surviving items would block the products delete below.
--    Deleting the header cascade-deletes items + qty_audits.
--    Guarded so this script also runs on a Phase-1-only DB.
------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.stock_requests') IS NOT NULL THEN
    DELETE FROM stock_requests;
  END IF;
END $$;

------------------------------------------------------------------
-- 2. Products — no other children block this once stock requests
--    are gone. categories.id is referenced by products.category_id
--    (ON DELETE RESTRICT), so products MUST go before categories.
------------------------------------------------------------------
DELETE FROM products;

------------------------------------------------------------------
-- 3. Categories — last in the chain. Self-referential via parent_id
--    (ON DELETE RESTRICT), so we have to delete children BEFORE
--    their parents. Easy with a recursive walk: keep deleting "leaf"
--    rows (no surviving child references them) until none remain.
------------------------------------------------------------------
DO $$
DECLARE
  v_removed int;
BEGIN
  LOOP
    DELETE FROM categories c
    WHERE NOT EXISTS (
      SELECT 1 FROM categories k WHERE k.parent_id = c.id
    );
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    EXIT WHEN v_removed = 0;
  END LOOP;
END $$;

------------------------------------------------------------------
-- 4. Reset code sequences so the next new row restarts at 1.
--    Deleting rows does NOT rewind a sequence — must be explicit.
--    Guarded so a DB without these sequences doesn't error.
------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.seq_product_code') IS NOT NULL THEN
    PERFORM setval('seq_product_code', 1, false);
  END IF;
  IF to_regclass('public.seq_request_code') IS NOT NULL THEN
    PERFORM setval('seq_request_code', 1, false);
  END IF;
  -- categories.id is a serial — restart its underlying sequence.
  IF to_regclass('public.categories_id_seq') IS NOT NULL THEN
    PERFORM setval('categories_id_seq', 1, false);
  END IF;
END $$;

COMMIT;

-- ============================================================
-- VERIFY
-- ============================================================
-- SELECT COUNT(*) FROM stock_requests;             -- expect 0
-- SELECT COUNT(*) FROM stock_request_items;        -- expect 0 (cascade)
-- SELECT COUNT(*) FROM stock_request_qty_audits;   -- expect 0 (cascade)
-- SELECT COUNT(*) FROM products;                   -- expect 0
-- SELECT COUNT(*) FROM categories;                 -- expect 0
-- SELECT COUNT(*) FROM users;                      -- preserved (admin + others)
-- SELECT COUNT(*) FROM shops;                      -- preserved
-- SELECT COUNT(*) FROM inventories;                -- preserved
-- SELECT COUNT(*) FROM app_settings;               -- preserved

-- After this, the next CREATE calls will return:
--   First product       → P001
--   First stock request → REQ0001
--   First category id   → 1
-- ============================================================
