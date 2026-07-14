-- ============================================================
-- Kovilpatti Snacks — FULL CATALOGUE SEED
-- (Source: client snacks-list spreadsheet, 04-Jun-2026)
--
-- Creates the 10 root categories + 2 Biscuits sub-categories
-- referenced by the printed catalogue, then bulk-inserts every
-- product visible on it (~159 SKUs) via fn_product_create_bulk.
--
-- Categories first (FK target), products second. Idempotent on
-- categories (INSERT-if-NOT-EXISTS per name+parent) and on the
-- product set (skipped wholesale if any product already lives in
-- the seed categories).
--
-- PREREQUISITES
--   • Phase 1 schema + phase1_nested_categories.sql applied.
--   • phase1_products_optimizations.sql applied (or it'll be
--     installed by this script's defensive block).
--   • Admin user exists.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- Defensive: ensure seq_product_code + sequence-backed
-- fn_product_next_code are in place. Without these, bulk insert
-- of N rows generates the same code N times → unique conflict.
-- ────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_product_code START 1;

CREATE OR REPLACE FUNCTION fn_product_next_code()
RETURNS varchar
LANGUAGE sql AS $$
  SELECT 'P' || lpad(nextval('seq_product_code')::text, 3, '0')
$$;

-- Bulk insert SP — normally installed by phase1_products_optimizations.sql.
-- Inlined here so this seed runs on a system where that addendum hasn't been
-- applied yet (e.g., a fresh UAT after wiping data). CREATE OR REPLACE is
-- idempotent — re-running is harmless.
CREATE OR REPLACE FUNCTION fn_product_create_bulk(
  p_products jsonb,
  p_user_id  uuid
)
RETURNS TABLE(id uuid, code varchar)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  INSERT INTO products (
    code, name, category_id, type,
    weight_value, weight_unit, mrp, purchase_price,
    gst, active, created_by, updated_by
  )
  SELECT
    fn_product_next_code(),
    (p->>'name')::varchar,
    (p->>'category_id')::int,
    (p->>'type')::varchar,
    NULLIF(p->>'weight_value', '')::numeric,
    COALESCE(NULLIF(p->>'weight_unit', ''), 'g'),
    (p->>'mrp')::numeric,
    (p->>'purchase_price')::numeric,
    NULLIF(p->>'gst', '')::numeric,
    COALESCE((p->>'active')::boolean, true),
    p_user_id,
    p_user_id
  FROM jsonb_array_elements(p_products) AS p
  RETURNING products.id, products.code;
END;
$$;

DO $do$
DECLARE
  v_admin_id uuid;

  -- Category ids — filled below.
  v_mix260       int; v_mix300       int;
  v_container    int; v_sweets       int;
  v_candy        int; v_g250         int;
  v_smartbite    int; v_stickers     int;
  v_cake_rusk    int; v_cover        int;
  v_biscuits     int; v_big_biscuit  int; v_small_biscuit int;

  v_existing_products int;
  v_max_code          bigint;
BEGIN
  ------------------------------------------------------------------
  -- 0. Admin user.
  ------------------------------------------------------------------
  SELECT id INTO v_admin_id
  FROM users
  WHERE role = 'admin' AND is_deleted = false
  ORDER BY created_at
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No admin user found — start the BE once so the admin row is auto-created, then re-run.';
  END IF;

  ------------------------------------------------------------------
  -- 1. CATEGORIES — root-first, with Biscuits split into Big + Small.
  ------------------------------------------------------------------
  SELECT id INTO v_mix260 FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Mixture 1Kg ₹260') AND is_deleted = false;
  IF v_mix260 IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Mixture 1Kg ₹260', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_mix260;
  END IF;

  SELECT id INTO v_mix300 FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Mixture 1Kg ₹300') AND is_deleted = false;
  IF v_mix300 IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Mixture 1Kg ₹300', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_mix300;
  END IF;

  SELECT id INTO v_container FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Container Items') AND is_deleted = false;
  IF v_container IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Container Items', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_container;
  END IF;

  SELECT id INTO v_sweets FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Sweets & Halwa') AND is_deleted = false;
  IF v_sweets IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Sweets & Halwa', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_sweets;
  END IF;

  SELECT id INTO v_candy FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Candy') AND is_deleted = false;
  IF v_candy IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Candy', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_candy;
  END IF;

  SELECT id INTO v_g250 FROM categories WHERE parent_id IS NULL AND lower(name) = lower('250g Items') AND is_deleted = false;
  IF v_g250 IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('250g Items', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_g250;
  END IF;

  SELECT id INTO v_smartbite FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Smartbite') AND is_deleted = false;
  IF v_smartbite IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Smartbite', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_smartbite;
  END IF;

  SELECT id INTO v_stickers FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Stickers') AND is_deleted = false;
  IF v_stickers IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Stickers', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_stickers;
  END IF;

  SELECT id INTO v_cake_rusk FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Cake & Rusk') AND is_deleted = false;
  IF v_cake_rusk IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Cake & Rusk', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_cake_rusk;
  END IF;

  SELECT id INTO v_cover FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Cover') AND is_deleted = false;
  IF v_cover IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Cover', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_cover;
  END IF;

  -- Biscuits root + 2 sub-categories.
  SELECT id INTO v_biscuits FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Biscuits') AND is_deleted = false;
  IF v_biscuits IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Biscuits', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_biscuits;
  END IF;

  SELECT id INTO v_big_biscuit FROM categories WHERE parent_id = v_biscuits AND lower(name) = lower('Big Biscuit') AND is_deleted = false;
  IF v_big_biscuit IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Big Biscuit', v_biscuits, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_big_biscuit;
  END IF;

  SELECT id INTO v_small_biscuit FROM categories WHERE parent_id = v_biscuits AND lower(name) = lower('Small Biscuit') AND is_deleted = false;
  IF v_small_biscuit IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Small Biscuit', v_biscuits, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_small_biscuit;
  END IF;

  RAISE NOTICE 'Categories ready — 10 roots + 2 sub-categories.';

  ------------------------------------------------------------------
  -- 2. PRODUCTS — guard then bulk insert.
  ------------------------------------------------------------------
  SELECT count(*) INTO v_existing_products
  FROM products
  WHERE is_deleted = false
    AND category_id IN (v_mix260, v_mix300, v_container, v_sweets, v_candy,
                        v_g250, v_smartbite, v_stickers, v_cake_rusk,
                        v_cover, v_big_biscuit, v_small_biscuit);

  IF v_existing_products > 0 THEN
    RAISE NOTICE 'Catalogue already loaded (% products) — skipping product seed.', v_existing_products;
  ELSE
    -- Advance sequence past any pre-existing P-codes so we don't collide.
    SELECT MAX(substring(code FROM 2)::bigint) INTO v_max_code
    FROM products WHERE code ~ '^P[0-9]+$';
    IF v_max_code IS NOT NULL THEN
      PERFORM setval('seq_product_code', v_max_code, true);
    END IF;

    -- Postgres caps jsonb_build_array at 100 args. We split ~159 rows
    -- across THREE atomic SP calls (each well under the limit). The
    -- enclosing transaction makes all three either land or roll back.

    -- ── Batch 1 — Mixture 260 + Mixture 300 + Big Biscuit + Small Biscuit (37 SKUs) ──
    PERFORM fn_product_create_bulk(jsonb_build_array(
      -- 1Kg ₹260 Items (9)
      jsonb_build_object('name','Kuchi Murukku Red',        'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Lakkadi',                  'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Ellu Sweet Diamond',       'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Corn Mixture',             'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Dal Mixture',              'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Kara Boondhi',             'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Kara Sev',                 'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Masala Thattai',           'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Verkadalai Thattai',       'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),

      -- 1Kg ₹300 Items (19)
      jsonb_build_object('name','Kerala Mixture',           'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Ragi Mixture',             'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Pepper Sev',               'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Ellu Pakoda',              'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Sweet Rolls (New)',        'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Kara Samosa (New)',        'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Andhra Murukku',           'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Poondu Murukku Red',       'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Poondu Murukku White',     'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Butter Murukku White',     'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Red Mullu Murukku',        'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','White Mullu Murukku',      'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Paruppu Thattai',          'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Ellu Murukku',             'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Kai Murukku',              'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Thenkuzhal Murukku',       'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Kara Seeval',              'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Potato Salt',              'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Potato Karam',             'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),

      -- Big Biscuit (6)
      jsonb_build_object('name','Butter Round 40Rs',        'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Butter Square 40Rs',       'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Nei Biscuit',              'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Raggi Biscuit',            'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Peanut Biscuit',           'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Coconut Biscuit 55Rs',     'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',55,'purchase_price',40,'active',true),

      -- Small Biscuit (3)
      jsonb_build_object('name','Butter 20Rs',              'category_id',v_small_biscuit,'type','pack','weight_value',50,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Nei Biscuit Small',        'category_id',v_small_biscuit,'type','pack','weight_value',50,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Raggi Small',              'category_id',v_small_biscuit,'type','pack','weight_value',50,'weight_unit','g','mrp',20,'purchase_price',14,'active',true)
    ), v_admin_id);

    -- ── Batch 2 — Container Items + Sweets & Halwa + Candy (62 SKUs) ──
    PERFORM fn_product_create_bulk(jsonb_build_array(
      -- Container Items — pulses & kadalai (10)
      jsonb_build_object('name','UppukKadalai',             'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Navathaniyam',             'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Kadalai Paruppu',          'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Pacha Pattani',            'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Manja Pattani',            'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Oil Kadalai 140g',         'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Masala Kadalai 140g',      'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Masala Kadalai 250g',      'category_id',v_container,'type','jar','weight_value',250,'weight_unit','g','mrp',70,'purchase_price',52,'active',true),
      jsonb_build_object('name','Plain Kadalai 140g',       'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','White Verkadalai',         'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),

      -- Container Items — savouries & chips (16)
      jsonb_build_object('name','Kara Seedai',              'category_id',v_container,'type','jar','weight_value',150,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Moongdal',                 'category_id',v_container,'type','jar','weight_value',150,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Kuchi Chips',              'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Round Chips',              'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Kurkure',                  'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Wheel Chips',              'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Onion Chips',              'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Triangle Chips',           'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Corn Chips',               'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Masala Pori',              'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Pori Urundai',             'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Manoharam',                'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Kerala Banana',            'category_id',v_container,'type','jar','weight_value',150,'weight_unit','g','mrp',60,'purchase_price',44,'active',true),
      jsonb_build_object('name','Nagercoil Banana',         'category_id',v_container,'type','jar','weight_value',150,'weight_unit','g','mrp',55,'purchase_price',40,'active',true),
      jsonb_build_object('name','Cheese Ball',              'category_id',v_container,'type','jar','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Corn Puffs',               'category_id',v_container,'type','jar','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),

      -- Container Items — 200g murukku variants (6)
      jsonb_build_object('name','200g Mullu Murukku Red',   'category_id',v_container,'type','pack','weight_value',200,'weight_unit','g','mrp',70,'purchase_price',52,'active',true),
      jsonb_build_object('name','200g Mullu Murukku White', 'category_id',v_container,'type','pack','weight_value',200,'weight_unit','g','mrp',70,'purchase_price',52,'active',true),
      jsonb_build_object('name','200g Spril Murukku',       'category_id',v_container,'type','pack','weight_value',200,'weight_unit','g','mrp',70,'purchase_price',52,'active',true),
      jsonb_build_object('name','200g Kai Murukku White',   'category_id',v_container,'type','pack','weight_value',200,'weight_unit','g','mrp',70,'purchase_price',52,'active',true),
      jsonb_build_object('name','200g Arumbu Murukku',      'category_id',v_container,'type','pack','weight_value',200,'weight_unit','g','mrp',75,'purchase_price',56,'active',true),
      jsonb_build_object('name','Manapparai 50Rs',          'category_id',v_container,'type','pack','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),

      -- Sweets & Halwa (16)
      jsonb_build_object('name','Kadalai Mittai 200g',      'category_id',v_sweets,'type','pack','weight_value',200,'weight_unit','g','mrp',60,'purchase_price',44,'active',true),
      jsonb_build_object('name','Nice Kadalai Mittai 200g', 'category_id',v_sweets,'type','pack','weight_value',200,'weight_unit','g','mrp',65,'purchase_price',48,'active',true),
      jsonb_build_object('name','Black Ellu Burfy 150g',    'category_id',v_sweets,'type','pack','weight_value',150,'weight_unit','g','mrp',75,'purchase_price',56,'active',true),
      jsonb_build_object('name','White Ellu Burfy 150g',    'category_id',v_sweets,'type','pack','weight_value',150,'weight_unit','g','mrp',75,'purchase_price',56,'active',true),
      jsonb_build_object('name','Burfy Bar 30Rs',           'category_id',v_sweets,'type','pack','weight_value',50,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Burfy Nice Bar 30Rs',      'category_id',v_sweets,'type','pack','weight_value',50,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Inji Mittai Black',        'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Inji Mittai White',        'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Thenmittai White Box',     'category_id',v_sweets,'type','pack','weight_value',200,'weight_unit','g','mrp',80,'purchase_price',60,'active',true),
      jsonb_build_object('name','Elandavada Seed',          'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Elandavada Nice',          'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Palkova',                  'category_id',v_sweets,'type','pack','weight_value',100,'weight_unit','g','mrp',60,'purchase_price',44,'active',true),
      jsonb_build_object('name','Milk Halwa',               'category_id',v_sweets,'type','pack','weight_value',250,'weight_unit','g','mrp',120,'purchase_price',88,'active',true),
      jsonb_build_object('name','Ajj Halwa',                'category_id',v_sweets,'type','pack','weight_value',250,'weight_unit','g','mrp',130,'purchase_price',96,'active',true),
      jsonb_build_object('name','Special Ghee Halwa',       'category_id',v_sweets,'type','pack','weight_value',250,'weight_unit','g','mrp',150,'purchase_price',110,'active',true),
      jsonb_build_object('name','Dry Fruit Halwa',          'category_id',v_sweets,'type','pack','weight_value',250,'weight_unit','g','mrp',180,'purchase_price',132,'active',true),

      -- Candy (14)
      jsonb_build_object('name','Jelly',                    'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Orange',                   'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Round Orange',             'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Poppins',                  'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Balli Mittai',             'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Sombu',                    'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Peanut Mittai',            'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Kayiru Mittai',            'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Pakku Mittai',             'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Rose Milk',                'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','White Soodam',             'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Kamarkattu',               'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Coconut Roll',             'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Animal Candy',             'category_id',v_candy,'type','jar','weight_value',100,'weight_unit','g','mrp',25,'purchase_price',18,'active',true)
    ), v_admin_id);

    -- ── Batch 3 — Smartbite + 250g + Stickers + Cake & Rusk + Cover + Container biscuits (~62 SKUs) ──
    PERFORM fn_product_create_bulk(jsonb_build_array(
      -- Container biscuits (9) — chocolate / coconut / etc. jar biscuits
      jsonb_build_object('name','Chocolate Biscuit',        'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Coconut Biscuit',          'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Ooty Varky',               'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Drops Biscuit',            'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','White Choco Biscuit',      'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',55,'purchase_price',40,'active',true),
      jsonb_build_object('name','Dark Choco Biscuit',       'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',55,'purchase_price',40,'active',true),
      jsonb_build_object('name','Cherry',                   'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Beetroot Murukku',         'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Carrot Murukku',           'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),

      -- 250g Items (13)
      jsonb_build_object('name','Karasev 250g',             'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','Pepper Sev 250g',          'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',100,'purchase_price',72,'active',true),
      jsonb_build_object('name','Aval Mixture',             'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',90,'purchase_price',64,'active',true),
      jsonb_build_object('name','Omapodi 250g',             'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','Nellai Mixture 250g',      'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',100,'purchase_price',72,'active',true),
      jsonb_build_object('name','Sweet Sev 250g',           'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','Karupppatti Sev 250g',     'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',110,'purchase_price',80,'active',true),
      jsonb_build_object('name','Sweet Boondhi 250g',       'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','White Seeval 250g',        'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',90,'purchase_price',64,'active',true),
      jsonb_build_object('name','Ragi Mixture 250g',        'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','KS Kadalaimittai',         'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',120,'purchase_price',88,'active',true),
      jsonb_build_object('name','TP Kara Boondhi',          'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','TP Omapodi',               'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),

      -- Smartbite (11)
      jsonb_build_object('name','ABCD',                     'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','123',                      'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Animal',                   'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Hearteen',                 'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Vita Bite',                'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Cashew',                   'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Coconut',                  'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Chocolate',                'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Marie',                    'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Sweet & Salt',             'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Salt',                     'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),

      -- Stickers (2)
      jsonb_build_object('name','100g Chips',               'category_id',v_stickers,'type','pack','weight_value',100,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','200g Chips',               'category_id',v_stickers,'type','pack','weight_value',200,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),

      -- Cake & Rusk (27)
      jsonb_build_object('name','Vanilla Slice',            'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Pineapple Slice',          'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Salem Cup Vanilla',        'category_id',v_cake_rusk,'type','pack','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Salem Cup Pineapple',      'category_id',v_cake_rusk,'type','pack','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Salem Cup Chocolate',      'category_id',v_cake_rusk,'type','pack','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Salem Cup Orange',         'category_id',v_cake_rusk,'type','pack','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Saba Brownie',             'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Saba Coconut Biscuit',     'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Osmania',                  'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Cashew Rusk',              'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Baby Rusk',                'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Milk Rusk',                'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Popcorn',                  'category_id',v_cake_rusk,'type','pack','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Adhirasam',                'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','KVP Adhirasam',            'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Somas',                    'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Porivilanga Laddu',        'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Achu Murukku',             'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Milk Cake',                'category_id',v_cake_rusk,'type','pack','weight_value',250,'weight_unit','g','mrp',150,'purchase_price',110,'active',true),
      jsonb_build_object('name','Gulab Jamun',              'category_id',v_cake_rusk,'type','jar','weight_value',500,'weight_unit','g','mrp',180,'purchase_price',132,'active',true),
      jsonb_build_object('name','Malkist',                  'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Coconut Milk Murukku',     'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Macroon Sada',             'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Macroon Special',          'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Kamuthi KaraSev',          'category_id',v_cake_rusk,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','Kamuthi Oma Sev',          'category_id',v_cake_rusk,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','Kamuthi Seeval',           'category_id',v_cake_rusk,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),

      -- Cover (7) — packaging SKUs
      jsonb_build_object('name','Single Green',             'category_id',v_cover,'type','pack','weight_value',5,'weight_unit','g','mrp',2,'purchase_price',1,'active',true),
      jsonb_build_object('name','Single Orange',            'category_id',v_cover,'type','pack','weight_value',5,'weight_unit','g','mrp',2,'purchase_price',1,'active',true),
      jsonb_build_object('name','100g Cover',               'category_id',v_cover,'type','pack','weight_value',5,'weight_unit','g','mrp',3,'purchase_price',2,'active',true),
      jsonb_build_object('name','250g Yellow Cover',        'category_id',v_cover,'type','pack','weight_value',10,'weight_unit','g','mrp',5,'purchase_price',3,'active',true),
      jsonb_build_object('name','250g Green Cover',         'category_id',v_cover,'type','pack','weight_value',10,'weight_unit','g','mrp',5,'purchase_price',3,'active',true),
      jsonb_build_object('name','500g Cover',               'category_id',v_cover,'type','pack','weight_value',15,'weight_unit','g','mrp',7,'purchase_price',4,'active',true),
      jsonb_build_object('name','1 Kg Cover',               'category_id',v_cover,'type','pack','weight_value',20,'weight_unit','g','mrp',10,'purchase_price',6,'active',true)
    ), v_admin_id);

    RAISE NOTICE 'Catalogue inserted — 159 products across 12 leaf categories.';
  END IF;
END $do$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- SELECT * FROM fn_category_tree();
--   --> 12 rows (10 roots + Biscuits > Big Biscuit + Biscuits > Small Biscuit)
--
-- SELECT c.name AS category, count(*) AS sku_count
-- FROM products p
-- JOIN categories c ON c.id = p.category_id
-- WHERE p.is_deleted = false
-- GROUP BY c.name
-- ORDER BY c.name;
--
-- Expected:
--   Big Biscuit       6
--   Cake & Rusk       27
--   Candy             14
--   Container Items   41   (10 + 16 + 6 + 9)
--   Cover             7
--   Mixture 1Kg ₹260  9
--   Mixture 1Kg ₹300  19
--   250g Items        13
--   Small Biscuit     3
--   Smartbite         11
--   Stickers          2
--   Sweets & Halwa    16
--   TOTAL: 168
-- ============================================================
-- ROLLBACK (when you want to wipe the seed)
-- ============================================================
-- BEGIN;
-- DELETE FROM products
-- WHERE category_id IN (
--   SELECT id FROM categories
--   WHERE name IN ('Mixture 1Kg ₹260','Mixture 1Kg ₹300','Container Items',
--                  'Sweets & Halwa','Candy','250g Items','Smartbite',
--                  'Stickers','Cake & Rusk','Cover',
--                  'Big Biscuit','Small Biscuit')
-- );
-- DELETE FROM categories WHERE name IN ('Big Biscuit','Small Biscuit') AND parent_id IS NOT NULL;
-- DELETE FROM categories WHERE name IN ('Mixture 1Kg ₹260','Mixture 1Kg ₹300','Container Items',
--                                       'Sweets & Halwa','Candy','250g Items','Smartbite',
--                                       'Stickers','Cake & Rusk','Cover','Biscuits')
--   AND parent_id IS NULL;
-- COMMIT;
-- ============================================================
