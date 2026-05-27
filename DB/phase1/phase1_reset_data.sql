-- ============================================================
-- Kovilpatti Snacks — DATA RESET (Phase 1 + Phase 2)
--
-- Wipes all transactional data so codes restart from 1:
--   * Stock requests-> empty   -> next code = REQ0001   (Phase 2)
--   * Products      -> empty   -> next code = P001
--   * Shops         -> empty   -> next code = SHP001
--   * Inventories   -> empty   -> next code = INV001
--   * Users         -> only admin remains (shop_user + inventory rows removed)
--
-- PRESERVES:
--   * Admin user (so login still works)
--   * Categories (so Products form dropdown still has options)
--   * app_settings (cutoff time + lock toggle — these are config, not data)
--
-- ⚠ WARNING ⚠
--   This is a HARD DELETE. Soft-deleted rows go too. No going back.
--   Run BEFORE handing the system to the client / before go-live testing.
--   On PROD: take a Supabase snapshot first.
--
-- HOW TO RUN
--   Supabase: SQL Editor → paste → click Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase1_reset_data.sql
-- ============================================================


BEGIN;


-- 0. stock requests (Phase 2) — MUST go first.
--    stock_request_items reference products / shops / inventories via
--    ON DELETE RESTRICT, so any surviving request rows would block the
--    DELETEs below. Deleting the header cascade-deletes the items
--    (stock_request_items.request_id is ON DELETE CASCADE).
--
--    Guarded with to_regclass so this script still runs cleanly on a
--    Phase-1-only database (where the stock_requests table doesn't exist).
DO $$
BEGIN
  IF to_regclass('public.stock_requests') IS NOT NULL THEN
    DELETE FROM stock_requests;
  END IF;
END $$;


-- 1. products (no other children block this once stock requests are gone)
DELETE FROM products;


-- 2. users — keep only admin
--    Audit FKs (created_by / updated_by) are ON DELETE SET NULL,
--    so deleted users won't block other rows.
DELETE FROM users WHERE role <> 'admin';


-- 3. shops (now no user.shop_id / stock_request references any shop)
DELETE FROM shops;


-- 4. inventories (now no user / shop / stock_request references any inventory)
DELETE FROM inventories;


-- 5. reset code sequences so the first new row restarts at 1.
--    Deleting rows does NOT rewind a sequence — it must be done explicitly.
--    setval(seq, 1, false) makes the NEXT nextval() return 1.
--
--    Only products (phase1_products_optimizations) and stock requests
--    (Phase 2) use sequences; shops / inventories still derive their next
--    code from MAX(code)+1, so wiping their rows resets them automatically.
--    Guarded so a DB without these sequences yet doesn't error.
DO $$
BEGIN
  IF to_regclass('public.seq_product_code') IS NOT NULL THEN
    PERFORM setval('seq_product_code', 1, false);
  END IF;
  IF to_regclass('public.seq_request_code') IS NOT NULL THEN
    PERFORM setval('seq_request_code', 1, false);
  END IF;
END $$;


COMMIT;


-- ============================================================
-- VERIFY (run these after the BEGIN/COMMIT block above)
-- ============================================================
-- SELECT COUNT(*) FROM products;             -- expect 0
-- SELECT COUNT(*) FROM shops;                -- expect 0
-- SELECT COUNT(*) FROM inventories;          -- expect 0
-- SELECT COUNT(*) FROM users;                -- expect 1 (admin only)
-- SELECT COUNT(*) FROM stock_requests;       -- expect 0
-- SELECT COUNT(*) FROM stock_request_items;  -- expect 0 (cascade)
-- SELECT COUNT(*) FROM categories;           -- preserved
-- SELECT COUNT(*) FROM app_settings;         -- preserved


-- ============================================================
-- AFTER THIS, THE NEXT CREATE CALLS WILL RETURN:
--   First product      →  P001
--   First inventory    →  INV001
--   First shop         →  SHP001
--   First stock request→  REQ0001
-- ============================================================


-- ============================================================
-- OPTIONAL: also reset categories
-- ------------------------------------------------------------
-- If you want to also wipe categories and let admin re-seed them,
-- uncomment and run separately. NOTE: this requires running the
-- category INSERT seed afterwards (see README), otherwise the
-- Products form will fail (no category dropdown options).
--
-- BEGIN;
--   DELETE FROM categories;
--   ALTER SEQUENCE categories_id_seq RESTART WITH 1;
-- COMMIT;
-- ============================================================
