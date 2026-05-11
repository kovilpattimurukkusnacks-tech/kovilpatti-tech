-- ============================================================
-- Kovilpatti Snacks — Phase 1 DATA RESET
--
-- Wipes all transactional data so codes restart from 1:
--   * Products      -> empty   -> next code = P001
--   * Shops         -> empty   -> next code = SHP001
--   * Inventories   -> empty   -> next code = INV001
--   * Users         -> only admin remains (shop_user + inventory rows removed)
--
-- PRESERVES:
--   * Admin user (so login still works)
--   * Categories (so Products form dropdown still has options)
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


-- 1. products (no children block this)
DELETE FROM products;


-- 2. users — keep only admin
--    Audit FKs (created_by / updated_by) are ON DELETE SET NULL,
--    so deleted users won't block other rows.
DELETE FROM users WHERE role <> 'admin';


-- 3. shops (now no user.shop_id references any shop)
DELETE FROM shops;


-- 4. inventories (now no user or shop references any inventory)
DELETE FROM inventories;


COMMIT;


-- ============================================================
-- VERIFY (run these after the BEGIN/COMMIT block above)
-- ============================================================
-- SELECT COUNT(*) FROM products;      -- expect 0
-- SELECT COUNT(*) FROM shops;         -- expect 0
-- SELECT COUNT(*) FROM inventories;   -- expect 0
-- SELECT COUNT(*) FROM users;         -- expect 1 (admin only)
-- SELECT COUNT(*) FROM categories;    -- preserved


-- ============================================================
-- AFTER THIS, THE NEXT CREATE CALLS WILL RETURN:
--   First product   →  P001
--   First inventory →  INV001
--   First shop      →  SHP001
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
