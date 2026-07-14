-- ============================================================
-- Kovilpatti Snacks — Categories needed for sample_products_import.csv
--
-- Creates the 8 root categories + 2 Biscuits sub-categories referenced
-- by the 50-row sample CSV. Run this BEFORE importing the file so
-- every row's category column resolves cleanly.
--
-- IDEMPOTENT — each category is created only if missing (matches on
-- name + parent_id), so re-running is a no-op.
--
-- PREREQUISITES
--   • Phase 1 schema + phase1_subcategories_migration applied (so
--     parent_id self-FK exists on categories).
--   • Admin user exists.
-- ============================================================

BEGIN;

DO $do$
DECLARE
  v_admin_id  uuid;
  v_biscuits  int;
BEGIN
  SELECT id INTO v_admin_id
  FROM users
  WHERE role = 'admin' AND is_deleted = false
  ORDER BY created_at
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No admin user found — start the BE once so the admin row is auto-created, then re-run.';
  END IF;

  -- ── Roots ──────────────────────────────────────────────────────
  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  SELECT 'Mixture 1Kg ₹260', NULL, true, v_admin_id, v_admin_id
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = 'mixture 1kg ₹260' AND parent_id IS NULL AND is_deleted = false);

  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  SELECT 'Mixture 1Kg ₹300', NULL, true, v_admin_id, v_admin_id
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = 'mixture 1kg ₹300' AND parent_id IS NULL AND is_deleted = false);

  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  SELECT '250g Items', NULL, true, v_admin_id, v_admin_id
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = '250g items' AND parent_id IS NULL AND is_deleted = false);

  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  SELECT '200g Items', NULL, true, v_admin_id, v_admin_id
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = '200g items' AND parent_id IS NULL AND is_deleted = false);

  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  SELECT 'Container Items', NULL, true, v_admin_id, v_admin_id
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = 'container items' AND parent_id IS NULL AND is_deleted = false);

  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  SELECT 'Sweets & Candy', NULL, true, v_admin_id, v_admin_id
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = 'sweets & candy' AND parent_id IS NULL AND is_deleted = false);

  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  SELECT 'Cake & Rusk', NULL, true, v_admin_id, v_admin_id
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = 'cake & rusk' AND parent_id IS NULL AND is_deleted = false);

  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  SELECT 'Biscuits', NULL, true, v_admin_id, v_admin_id
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = 'biscuits' AND parent_id IS NULL AND is_deleted = false);

  -- ── Biscuits sub-categories ────────────────────────────────────
  SELECT id INTO v_biscuits
  FROM categories
  WHERE lower(name) = 'biscuits' AND parent_id IS NULL AND is_deleted = false;

  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  SELECT 'Big Biscuit', v_biscuits, true, v_admin_id, v_admin_id
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = 'big biscuit' AND parent_id = v_biscuits AND is_deleted = false);

  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  SELECT 'Small Biscuit', v_biscuits, true, v_admin_id, v_admin_id
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE lower(name) = 'small biscuit' AND parent_id = v_biscuits AND is_deleted = false);

  RAISE NOTICE 'Categories ready — 8 roots + 2 sub-categories for the sample import.';
END $do$;

COMMIT;

-- ============================================================
-- VERIFY
-- ============================================================
-- SELECT * FROM fn_category_tree();
--   --> 10 rows in tree order. Biscuits root + (Biscuits > Big Biscuit, > Small Biscuit).
--
-- After this, go to /admin/products → Import Products → upload
-- sample_products_import.csv → all 50 rows should land.
-- ============================================================
