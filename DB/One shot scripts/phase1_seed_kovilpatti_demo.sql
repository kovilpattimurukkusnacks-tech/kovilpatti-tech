-- ============================================================
-- Kovilpatti Snacks — DEMO SEED for client #1, #6, #7, #8, #9
-- (28-May-2026)
--
-- Realistic catalogue that exercises every recently-shipped feature:
--   • Nested categories up to 3 levels deep (Snacks > Spicy > Kara Sev)
--   • Products on a ROOT category (Combos > Festive Pack)
--   • Products on a DEEP node (Kara Sev > Plain Kara Sev …)
--   • Multi-weight variants of the same product (Mixture 100g / 250g / 500g)
--   • Two rows with identical (name, category, type, weight) — was blocked
--     before #8, now allowed
--   • pack + jar types; g + kg units
--
-- WHAT THIS WILL DO
--   • Insert 8 categories (4 roots + 4 sub-cats, one 3-level chain)
--   • Insert 18 products via fn_product_create_bulk (codes auto-assigned)
--
-- IDEMPOTENT — safe to re-run. The category insert uses NOT EXISTS guards
-- so re-running won't duplicate. Products are inserted only if their target
-- categories had to be freshly created — re-running with categories already
-- present is a no-op (intentional, so the demo dataset doesn't double up).
--
-- PREREQUISITES
--   • Phase 1 + phase1_subcategories_migration.sql applied (parent_id col).
--   • Phase 1 + phase1_drop_variant_uniqueness.sql applied (variant index gone).
--   • At least one admin user exists (auto-created on BE boot). Used as
--     created_by/updated_by for every row.
--
-- HOW TO RUN
--   Local PG: psql -U postgres -d sks_inventory -f phase1_seed_kovilpatti_demo.sql
--   Supabase: paste in SQL Editor → Run.
--
-- TO ROLL BACK — see the DELETE block at the bottom of this file.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. Self-contained sequence install — runs at top-level so the
--    CREATE/REPLACE doesn't have to fight dollar-quote nesting
--    inside the DO block below.
--
--    Background: this seed inserts N rows in a single
--    fn_product_create_bulk call, which means a single INSERT
--    statement invokes fn_product_next_code() N times. The legacy
--    MAX(code)+1 version of that function (still installed when
--    phase1_products_optimizations.sql was never applied) returns
--    the SAME code on every call within one statement (statement
--    snapshot can't see in-flight rows), so rows 2..N collide on
--    products_code_key. The sequence-backed version below fixes it.
--
--    Both objects use idempotent DDL — safe to re-run.
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_product_code START 1;

CREATE OR REPLACE FUNCTION fn_product_next_code()
RETURNS varchar
LANGUAGE sql AS $$
  SELECT 'P' || lpad(nextval('seq_product_code')::text, 3, '0')
$$;

DO $do$
DECLARE
  v_admin_id uuid;

  -- Category ids — filled below as we INSERT/SELECT each one.
  v_snacks     int; v_spicy      int; v_kara_sev   int; v_sweet  int;
  v_combos     int; v_bakery     int; v_cookies    int; v_cakes  int;

  -- Count of demo products already present. We check by category_id across
  -- the 6 leaf-ish categories we seed into; if there's anything there, we
  -- assume the product seed already ran and skip. (Categories existing on
  -- their own — e.g. created manually — is NOT enough to skip products.)
  v_existing_demo_products int;

  -- Bulk-insert payload for fn_product_create_bulk.
  v_products jsonb;
BEGIN
  ------------------------------------------------------------------
  -- 0. Find an admin user to attribute the seed rows to.
  ------------------------------------------------------------------
  SELECT id INTO v_admin_id
  FROM users
  WHERE role = 'admin' AND is_deleted = false
  ORDER BY created_at
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No admin user found — start the BE once (Seed:AdminPassword) so the admin row is auto-created, then re-run this script.';
  END IF;

  ------------------------------------------------------------------
  -- 1. Categories (root → child → grandchild)
  --
  -- Insert-if-missing pattern: SELECT first; if NULL, INSERT and capture
  -- v_fresh_seed=true on the first new row so we know whether to also
  -- seed products at the end.
  ------------------------------------------------------------------

  -- Root: Snacks
  SELECT id INTO v_snacks FROM categories
   WHERE parent_id IS NULL AND lower(name) = 'snacks' AND is_deleted = false;
  IF v_snacks IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Snacks', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_snacks;
  END IF;

  -- Snacks > Spicy
  SELECT id INTO v_spicy FROM categories
   WHERE parent_id = v_snacks AND lower(name) = 'spicy' AND is_deleted = false;
  IF v_spicy IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Spicy', v_snacks, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_spicy;
  END IF;

  -- Snacks > Spicy > Kara Sev  (3-level chain)
  SELECT id INTO v_kara_sev FROM categories
   WHERE parent_id = v_spicy AND lower(name) = 'kara sev' AND is_deleted = false;
  IF v_kara_sev IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Kara Sev', v_spicy, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_kara_sev;
  END IF;

  -- Snacks > Sweet
  SELECT id INTO v_sweet FROM categories
   WHERE parent_id = v_snacks AND lower(name) = 'sweet' AND is_deleted = false;
  IF v_sweet IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Sweet', v_snacks, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_sweet;
  END IF;

  -- Root: Combos (products will sit directly on this root)
  SELECT id INTO v_combos FROM categories
   WHERE parent_id IS NULL AND lower(name) = 'combos' AND is_deleted = false;
  IF v_combos IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Combos', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_combos;
  END IF;

  -- Root: Bakery
  SELECT id INTO v_bakery FROM categories
   WHERE parent_id IS NULL AND lower(name) = 'bakery' AND is_deleted = false;
  IF v_bakery IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Bakery', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_bakery;
  END IF;

  -- Bakery > Cookies
  SELECT id INTO v_cookies FROM categories
   WHERE parent_id = v_bakery AND lower(name) = 'cookies' AND is_deleted = false;
  IF v_cookies IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Cookies', v_bakery, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_cookies;
  END IF;

  -- Bakery > Cakes
  SELECT id INTO v_cakes FROM categories
   WHERE parent_id = v_bakery AND lower(name) = 'cakes' AND is_deleted = false;
  IF v_cakes IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Cakes', v_bakery, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_cakes;
  END IF;

  ------------------------------------------------------------------
  -- 2. Products — skip when ANY product already lives under the demo
  --    leaf categories. This way:
  --      • First run inserts the whole catalogue.
  --      • Subsequent runs (categories already there, products too) → skip
  --        so duplicate Garlic Kara Sev rows don't pile up to 4× / 6× / …
  --      • Categories created manually beforehand still get the products
  --        seeded (the bug you hit on the first run).
  ------------------------------------------------------------------
  SELECT count(*) INTO v_existing_demo_products
  FROM products
  WHERE is_deleted = false
    AND category_id IN (v_spicy, v_kara_sev, v_sweet, v_combos, v_cookies, v_cakes);

  IF v_existing_demo_products > 0 THEN
    RAISE NOTICE 'Demo products already present (% rows) — skipping product seed.',
                 v_existing_demo_products;
  ELSE
    -- Advance the sequence past any P-coded products that pre-date this
    -- script (manual creates, prior seeds). The sequence + sequence-backed
    -- fn_product_next_code are installed at the top of this file, before
    -- the DO block, so they're definitely in place by now.
    DECLARE
      v_max_code bigint;
    BEGIN
      SELECT MAX(substring(code FROM 2)::bigint) INTO v_max_code
      FROM products
      WHERE code ~ '^P[0-9]+$';

      IF v_max_code IS NOT NULL THEN
        PERFORM setval('seq_product_code', v_max_code, true);
        RAISE NOTICE 'Advanced seq_product_code past % existing P-codes.', v_max_code;
      END IF;
    END;

    -- One jsonb array, one SP call, one transaction. Codes auto-assigned
    -- (P0001, P0002, …) via the sequence-backed fn_product_next_code.
    v_products := jsonb_build_array(

      -- Snacks > Spicy ──────────────────────────────────────────
      jsonb_build_object('name','Mixture','category_id',v_spicy,'type','pack','weight_value',100,'weight_unit','g','mrp', 40,'purchase_price', 28,'active',true),
      jsonb_build_object('name','Mixture','category_id',v_spicy,'type','pack','weight_value',250,'weight_unit','g','mrp', 90,'purchase_price', 65,'active',true),
      jsonb_build_object('name','Mixture','category_id',v_spicy,'type','jar', 'weight_value',500,'weight_unit','g','mrp',180,'purchase_price',135,'active',true),
      jsonb_build_object('name','Murukku','category_id',v_spicy,'type','pack','weight_value',100,'weight_unit','g','mrp', 50,'purchase_price', 35,'active',true),
      jsonb_build_object('name','Murukku','category_id',v_spicy,'type','pack','weight_value',200,'weight_unit','g','mrp', 95,'purchase_price', 68,'active',true),

      -- Snacks > Spicy > Kara Sev (3-level deep) ────────────────
      jsonb_build_object('name','Plain Kara Sev', 'category_id',v_kara_sev,'type','pack','weight_value',100,'weight_unit','g','mrp', 45,'purchase_price', 32,'active',true),
      jsonb_build_object('name','Plain Kara Sev', 'category_id',v_kara_sev,'type','pack','weight_value',200,'weight_unit','g','mrp', 85,'purchase_price', 60,'active',true),
      jsonb_build_object('name','Garlic Kara Sev','category_id',v_kara_sev,'type','pack','weight_value',100,'weight_unit','g','mrp', 50,'purchase_price', 36,'active',true),
      -- ⬇ INTENTIONAL DUPLICATE — same (name, category, type, weight) as the
      --    row above. Pre-#8 this would have hit uq_products_variant_active;
      --    post-#8 both rows insert with distinct codes.
      jsonb_build_object('name','Garlic Kara Sev','category_id',v_kara_sev,'type','pack','weight_value',100,'weight_unit','g','mrp', 55,'purchase_price', 40,'active',true),

      -- Snacks > Sweet ──────────────────────────────────────────
      jsonb_build_object('name','Mysore Pak','category_id',v_sweet,'type','pack','weight_value',250,'weight_unit','g','mrp',220,'purchase_price',160,'active',true),
      jsonb_build_object('name','Mysore Pak','category_id',v_sweet,'type','pack','weight_value',500,'weight_unit','g','mrp',420,'purchase_price',310,'active',true),
      jsonb_build_object('name','Athirasam', 'category_id',v_sweet,'type','pack','weight_value',200,'weight_unit','g','mrp',160,'purchase_price',115,'active',true),

      -- Combos (root — product on a top-level category) ─────────
      jsonb_build_object('name','Festive Pack Small','category_id',v_combos,'type','pack','weight_value',500,'weight_unit','g', 'mrp',450,'purchase_price',320,'active',true),
      jsonb_build_object('name','Festive Pack Large','category_id',v_combos,'type','pack','weight_value',  1,'weight_unit','kg','mrp',850,'purchase_price',600,'active',true),

      -- Bakery > Cookies (jar type) ─────────────────────────────
      jsonb_build_object('name','Butter Cookies', 'category_id',v_cookies,'type','jar','weight_value',250,'weight_unit','g','mrp',120,'purchase_price', 80,'active',true),
      jsonb_build_object('name','Chocolate Chip', 'category_id',v_cookies,'type','jar','weight_value',250,'weight_unit','g','mrp',150,'purchase_price',105,'active',true),

      -- Bakery > Cakes ──────────────────────────────────────────
      jsonb_build_object('name','Plum Cake','category_id',v_cakes,'type','pack','weight_value',500,'weight_unit','g','mrp',280,'purchase_price',195,'active',true)
    );

    PERFORM fn_product_create_bulk(v_products, v_admin_id);
    RAISE NOTICE 'Seed complete — 8 categories + 17 products inserted (+1 intentional duplicate variant for #8 demo).';
  END IF;
END $do$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- SELECT * FROM fn_category_tree();
--   --> 8 rows, indented by depth, root-first:
--       Bakery / Bakery > Cakes / Bakery > Cookies / Combos /
--       Snacks / Snacks > Spicy / Snacks > Spicy > Kara Sev / Snacks > Sweet
--
-- SELECT c.path, p.code, p.name, p.type, p.weight_value, p.weight_unit, p.mrp
-- FROM products p
-- JOIN fn_category_tree() c ON c.id = p.category_id
-- WHERE p.is_deleted = false
-- ORDER BY c.path, p.name, p.weight_value;
--   --> 18 rows. Two with identical (name=Garlic Kara Sev, type=pack,
--       weight=100g) — different codes proves #8 is working.
--
-- ============================================================
-- ROLLBACK (run when you want to wipe the demo dataset)
-- ============================================================
-- BEGIN;
-- -- Products by category. The IN-list pulls only the demo categories.
-- DELETE FROM products
--   WHERE category_id IN (
--     SELECT id FROM categories
--      WHERE name IN ('Spicy','Kara Sev','Sweet','Combos','Cookies','Cakes',
--                     'Snacks','Bakery')
--   );
-- -- Now the categories — children first so the FK guard passes.
-- DELETE FROM categories WHERE name = 'Kara Sev'  AND parent_id IS NOT NULL;
-- DELETE FROM categories WHERE name IN ('Spicy','Sweet')   AND parent_id IS NOT NULL;
-- DELETE FROM categories WHERE name IN ('Cookies','Cakes') AND parent_id IS NOT NULL;
-- DELETE FROM categories WHERE name IN ('Snacks','Combos','Bakery') AND parent_id IS NULL;
-- COMMIT;
-- ============================================================
