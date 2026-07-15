-- ============================================================
-- Kovilpatti Snacks — MAX SEED for printout stress test
-- (Client catalogue, 29-May-2026)
--
-- Loads the real shop catalogue (~150 SKUs across 11 categories)
-- and creates 5 large stock requests (150 line items each, one per
-- shop) so the cumulative + per-request billing prints can be
-- evaluated at scale.
--
-- WHAT THIS WILL DO
--   • Insert 11 categories (nested where useful).
--   • Insert ~160 products via fn_product_create_bulk (codes auto).
--   • Pick 5 shops + their godowns from the existing bulk seed.
--   • For each shop: create a Pending stock_request with 150 line
--     items sampled from the catalogue (random qty 1-12, real MRPs).
--
-- IDEMPOTENT — guarded on:
--   • Categories — INSERT-if-NOT-EXISTS per name+parent.
--   • Products   — skipped wholesale if any product already lives
--                  in the seed leaf categories.
--   • Requests   — skipped if any of the 5 target shops already has
--                  a >= 100-item Pending request from this seed.
--
-- PREREQUISITES
--   • Phase 1 schema + phase1_subcategories_migration applied.
--   • phase1_drop_variant_uniqueness applied (this seed inserts a
--     few same-name rows that the old variant index would block).
--   • phase1_seed_bulk.sql already loaded (we pick SHP0001..SHP0005).
--   • Admin user exists (auto-created by BE boot).
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- Self-contained sequence install — same defensive pattern as
-- the small demo seed: makes sure fn_product_next_code is the
-- sequence-backed version so the bulk INSERT N rows below
-- assigns N distinct codes inside a single statement.
-- ────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_product_code START 1;

CREATE OR REPLACE FUNCTION fn_product_next_code()
RETURNS varchar
LANGUAGE sql AS $$
  SELECT 'P' || lpad(nextval('seq_product_code')::text, 3, '0')
$$;

DO $do$
DECLARE
  v_admin_id uuid;

  -- Category ids.
  v_mix260      int; v_mix300      int;
  v_g200        int; v_g250        int;
  v_container   int; v_sweets      int;
  v_biscuits    int; v_big_biscuit int; v_small_biscuit int;
  v_cake_rusk   int; v_smartbite   int;
  v_stickers    int; v_cover       int;

  -- Shop / godown picks.
  v_shop_ids        uuid[];
  v_inventory_ids   uuid[];
  v_shop_id         uuid;
  v_inventory_id    uuid;
  v_shop_count      int;

  -- Counters.
  v_existing_products int;
  v_existing_requests int;

  -- Loop variables.
  i int;
  v_request_id uuid;
  v_code       varchar;
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
  -- 1. Categories — root-first, with Biscuits split into Big + Small.
  ------------------------------------------------------------------
  -- Inline helper not available in plain SQL; we just SELECT-or-INSERT each.

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

  SELECT id INTO v_g200 FROM categories WHERE parent_id IS NULL AND lower(name) = lower('200g Items') AND is_deleted = false;
  IF v_g200 IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('200g Items', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_g200;
  END IF;

  SELECT id INTO v_g250 FROM categories WHERE parent_id IS NULL AND lower(name) = lower('250g Items') AND is_deleted = false;
  IF v_g250 IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('250g Items', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_g250;
  END IF;

  SELECT id INTO v_container FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Container Items') AND is_deleted = false;
  IF v_container IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Container Items', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_container;
  END IF;

  SELECT id INTO v_sweets FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Sweets & Candy') AND is_deleted = false;
  IF v_sweets IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Sweets & Candy', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_sweets;
  END IF;

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

  SELECT id INTO v_cake_rusk FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Cake & Rusk') AND is_deleted = false;
  IF v_cake_rusk IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Cake & Rusk', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_cake_rusk;
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

  SELECT id INTO v_cover FROM categories WHERE parent_id IS NULL AND lower(name) = lower('Cover') AND is_deleted = false;
  IF v_cover IS NULL THEN
    INSERT INTO categories (name, parent_id, active, created_by, updated_by)
    VALUES ('Cover', NULL, true, v_admin_id, v_admin_id)
    RETURNING id INTO v_cover;
  END IF;

  ------------------------------------------------------------------
  -- 2. Products — bulk insert 160 SKUs in one SP call. Guard with a
  --    quick existence check so a re-run is a no-op.
  ------------------------------------------------------------------
  SELECT count(*) INTO v_existing_products
  FROM products
  WHERE is_deleted = false
    AND category_id IN (v_mix260, v_mix300, v_g200, v_g250, v_container,
                        v_sweets, v_big_biscuit, v_small_biscuit,
                        v_cake_rusk, v_smartbite, v_stickers, v_cover);

  IF v_existing_products > 0 THEN
    RAISE NOTICE 'Catalogue already loaded (% products) — skipping product seed.', v_existing_products;
  ELSE
    -- Advance sequence past any existing P-coded products.
    DECLARE
      v_max_code bigint;
    BEGIN
      SELECT MAX(substring(code FROM 2)::bigint) INTO v_max_code
      FROM products
      WHERE code ~ '^P[0-9]+$';

      IF v_max_code IS NOT NULL THEN
        PERFORM setval('seq_product_code', v_max_code, true);
      END IF;
    END;

    -- Build the products payload across THREE calls — Postgres caps any
    -- function (including jsonb_build_array) at 100 args, and we have ~158
    -- SKUs to insert. Each chunk stays comfortably under the limit; the
    -- three calls together still run inside this transaction so partial
    -- failure rolls everything back.
    --
    -- Weight values mirror the screenshot's price-tier hint (1Kg / 250g /
    -- 200g) where given; container / sweets / biscuit / cake items default
    -- to 100g unless the product name itself encodes a different weight.

    -- ─── Batch 1 ─── Mixtures (260+300) · 250g · 200g · Container (74 SKUs)
    PERFORM fn_product_create_bulk(jsonb_build_array(
      -- ── Mixture 1Kg ₹260 (9 SKUs) ──
      jsonb_build_object('name','Kuchi Murukku Red',       'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Lakkadi',                 'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Ellu Sweet Diamond',      'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Corn Mixture',            'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Dal Mixture',             'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Kara Boondhi',            'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Kara Sev',                'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Masala Thattai',          'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),
      jsonb_build_object('name','Verkadalai Thattai',      'category_id',v_mix260,'type','pack','weight_value',1,'weight_unit','kg','mrp',260,'purchase_price',195,'active',true),

      -- ── Mixture 1Kg ₹300 (19 SKUs) ──
      jsonb_build_object('name','Kerala Mixture',          'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Ragi Mixture',            'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Pepper Sev',              'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Ellu Pakoda',             'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Sweet Rolls',             'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Kara Samosa',             'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Andhra Murukku',          'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Poondu Murukku Red',      'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Poondu Murukku White',    'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Butter Murukku White',    'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Red Mullu Murukku',       'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','White Mullu Murukku',     'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Paruppu Thattai',         'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Ellu Murukku',            'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Kai Murukku',             'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Thenkuzhal Murukku',      'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Kara Seeval',             'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Potato Salt',             'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),
      jsonb_build_object('name','Potato Karam',            'category_id',v_mix300,'type','pack','weight_value',1,'weight_unit','kg','mrp',300,'purchase_price',225,'active',true),

      -- ── 250g Items (12 SKUs) ──
      jsonb_build_object('name','Karasev',                 'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','Pepper Sev',              'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',100,'purchase_price',72,'active',true),
      jsonb_build_object('name','Aval Mixture',            'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',90,'purchase_price',64,'active',true),
      jsonb_build_object('name','Omapodi',                 'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','Nellai Mixture',          'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',100,'purchase_price',72,'active',true),
      jsonb_build_object('name','Sweet Sev',               'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','Karuppatti Sev',          'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',110,'purchase_price',80,'active',true),
      jsonb_build_object('name','Sweet Boondhi',           'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','White Seeval',            'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',90,'purchase_price',64,'active',true),
      jsonb_build_object('name','Ragi Mixture',            'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','KS Kadalaimittai',        'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',120,'purchase_price',88,'active',true),
      jsonb_build_object('name','TP Kara Boondhi',         'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),
      jsonb_build_object('name','TP Omapodi',              'category_id',v_g250,'type','pack','weight_value',250,'weight_unit','g','mrp',95,'purchase_price',68,'active',true),

      -- ── 200g Items (5 SKUs) ──
      jsonb_build_object('name','Mullu Murukku Red',       'category_id',v_g200,'type','pack','weight_value',200,'weight_unit','g','mrp',70,'purchase_price',52,'active',true),
      jsonb_build_object('name','Mullu Murukku White',     'category_id',v_g200,'type','pack','weight_value',200,'weight_unit','g','mrp',70,'purchase_price',52,'active',true),
      jsonb_build_object('name','Spril Murukku',           'category_id',v_g200,'type','pack','weight_value',200,'weight_unit','g','mrp',70,'purchase_price',52,'active',true),
      jsonb_build_object('name','Kai Murukku White',       'category_id',v_g200,'type','pack','weight_value',200,'weight_unit','g','mrp',70,'purchase_price',52,'active',true),
      jsonb_build_object('name','Arumbu Murukku',          'category_id',v_g200,'type','pack','weight_value',200,'weight_unit','g','mrp',75,'purchase_price',56,'active',true),

      -- ── Container Items (28 SKUs — packaged dry goods + chips) ──
      jsonb_build_object('name','Uppukadalai',             'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Navathaniyam',            'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Kadalai Paruppu',         'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Pacha Pattani',           'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Manja Pattani',           'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Oil Kadalai',             'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Masala Kadalai',          'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Masala Kadalai Large',    'category_id',v_container,'type','jar','weight_value',250,'weight_unit','g','mrp',70,'purchase_price',52,'active',true),
      jsonb_build_object('name','Plain Kadalai',           'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','White Verkadalai',        'category_id',v_container,'type','jar','weight_value',140,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Kara Seedai',             'category_id',v_container,'type','jar','weight_value',150,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Moongdal',                'category_id',v_container,'type','jar','weight_value',150,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Kuchi Chips',             'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Round Chips',             'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Kurkure',                 'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Wheel Chips',             'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Onion Chips',             'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Triangle Chips',          'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Corn Chips',              'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Masala Pori',             'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Pori Urundai',            'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Manoharam',               'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Kerala Banana Chips',     'category_id',v_container,'type','jar','weight_value',150,'weight_unit','g','mrp',60,'purchase_price',44,'active',true),
      jsonb_build_object('name','Nagercoil Banana Chips',  'category_id',v_container,'type','jar','weight_value',150,'weight_unit','g','mrp',55,'purchase_price',40,'active',true),
      jsonb_build_object('name','Cheese Ball',             'category_id',v_container,'type','jar','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Corn Puffs',              'category_id',v_container,'type','jar','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Beetroot Murukku',        'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Carrot Murukku',          'category_id',v_container,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true)
    ), v_admin_id);

    -- ─── Batch 2 ─── Sweets & Candy (30 SKUs)
    PERFORM fn_product_create_bulk(jsonb_build_array(
      -- ── Sweets & Candy (15 SKUs) ──
      jsonb_build_object('name','Kadalai Mittai',          'category_id',v_sweets,'type','pack','weight_value',200,'weight_unit','g','mrp',60,'purchase_price',44,'active',true),
      jsonb_build_object('name','Nice Kadalai Mittai',     'category_id',v_sweets,'type','pack','weight_value',200,'weight_unit','g','mrp',65,'purchase_price',48,'active',true),
      jsonb_build_object('name','Black Ellu Burfy',        'category_id',v_sweets,'type','pack','weight_value',150,'weight_unit','g','mrp',75,'purchase_price',56,'active',true),
      jsonb_build_object('name','White Ellu Burfy',        'category_id',v_sweets,'type','pack','weight_value',150,'weight_unit','g','mrp',75,'purchase_price',56,'active',true),
      jsonb_build_object('name','Burfy Bar',               'category_id',v_sweets,'type','pack','weight_value',50,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Burfy Nice Bar',          'category_id',v_sweets,'type','pack','weight_value',50,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Inji Mittai Black',       'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Inji Mittai White',       'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Thenmittai',              'category_id',v_sweets,'type','pack','weight_value',200,'weight_unit','g','mrp',80,'purchase_price',60,'active',true),
      jsonb_build_object('name','Elandavada Seed',         'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Elandavada Nice',         'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Palkova',                 'category_id',v_sweets,'type','pack','weight_value',100,'weight_unit','g','mrp',60,'purchase_price',44,'active',true),
      jsonb_build_object('name','Milk Halwa',              'category_id',v_sweets,'type','pack','weight_value',250,'weight_unit','g','mrp',120,'purchase_price',88,'active',true),
      jsonb_build_object('name','Ajj Halwa',               'category_id',v_sweets,'type','pack','weight_value',250,'weight_unit','g','mrp',130,'purchase_price',96,'active',true),
      jsonb_build_object('name','Special Ghee Halwa',      'category_id',v_sweets,'type','pack','weight_value',250,'weight_unit','g','mrp',150,'purchase_price',110,'active',true),
      jsonb_build_object('name','Dry Fruit Halwa',         'category_id',v_sweets,'type','pack','weight_value',250,'weight_unit','g','mrp',180,'purchase_price',132,'active',true),

      -- ── Sweets & Candy (loose candy) ──
      jsonb_build_object('name','Jelly',                   'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Orange Candy',            'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Round Orange',            'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Poppins',                 'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Balli Mittai',            'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Sombu Mittai',            'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Peanut Mittai',           'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Kayiru Mittai',           'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Pakku Mittai',            'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Rose Milk Candy',         'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','White Soodam',            'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Kamarkattu',              'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Coconut Roll',            'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Animal Candy',            'category_id',v_sweets,'type','jar','weight_value',100,'weight_unit','g','mrp',25,'purchase_price',18,'active',true)
    ), v_admin_id);

    -- ─── Batch 3 ─── Biscuits · Smartbite · Stickers · Cake & Rusk · Cover (~54 SKUs)
    PERFORM fn_product_create_bulk(jsonb_build_array(
      -- ── Big Biscuit (6 SKUs) ──
      jsonb_build_object('name','Butter Round',            'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Butter Square',           'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Nei Biscuit',             'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Raggi Biscuit',           'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Peanut Biscuit',          'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Coconut Biscuit',         'category_id',v_big_biscuit,'type','pack','weight_value',100,'weight_unit','g','mrp',55,'purchase_price',40,'active',true),

      -- ── Small Biscuit (4 SKUs) ──
      jsonb_build_object('name','Manapparai Biscuit',      'category_id',v_small_biscuit,'type','pack','weight_value',50,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Butter Mini',             'category_id',v_small_biscuit,'type','pack','weight_value',50,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Nei Mini',                'category_id',v_small_biscuit,'type','pack','weight_value',50,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Raggi Mini',              'category_id',v_small_biscuit,'type','pack','weight_value',50,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),

      -- ── Container Biscuits (under Biscuits root, generic) ──
      jsonb_build_object('name','Chocolate Biscuit',       'category_id',v_big_biscuit,'type','jar','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Coconut Biscuit Container','category_id',v_big_biscuit,'type','jar','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Ooty Varky',              'category_id',v_big_biscuit,'type','jar','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Drops Biscuit',           'category_id',v_big_biscuit,'type','jar','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','White Choco Biscuit',     'category_id',v_big_biscuit,'type','jar','weight_value',100,'weight_unit','g','mrp',55,'purchase_price',40,'active',true),
      jsonb_build_object('name','Dark Choco Biscuit',      'category_id',v_big_biscuit,'type','jar','weight_value',100,'weight_unit','g','mrp',55,'purchase_price',40,'active',true),
      jsonb_build_object('name','Cherry Biscuit',          'category_id',v_big_biscuit,'type','jar','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),

      -- ── Smartbite (11 SKUs) ──
      jsonb_build_object('name','ABCD Biscuit',            'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','123 Biscuit',             'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Animal Biscuit',          'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Hearteen',                'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Vita Bite',               'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Cashew Bite',             'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Coconut Bite',            'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Chocolate Bite',          'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','Marie Bite',              'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Sweet & Salt',            'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),
      jsonb_build_object('name','Salt Bite',               'category_id',v_smartbite,'type','pack','weight_value',60,'weight_unit','g','mrp',15,'purchase_price',11,'active',true),

      -- ── Stickers (2 SKUs) ──
      jsonb_build_object('name','100g Chips Sticker',      'category_id',v_stickers,'type','pack','weight_value',100,'weight_unit','g','mrp',20,'purchase_price',14,'active',true),
      jsonb_build_object('name','200g Chips Sticker',      'category_id',v_stickers,'type','pack','weight_value',200,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),

      -- ── Cake & Rusk (22 SKUs) ──
      jsonb_build_object('name','Vanilla Slice',           'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Pineapple Slice',         'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',30,'purchase_price',22,'active',true),
      jsonb_build_object('name','Salem Cup Vanilla',       'category_id',v_cake_rusk,'type','pack','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Salem Cup Pineapple',     'category_id',v_cake_rusk,'type','pack','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Salem Cup Chocolate',     'category_id',v_cake_rusk,'type','pack','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Salem Cup Orange',        'category_id',v_cake_rusk,'type','pack','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Saba Brownie',            'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Saba Coconut Biscuit',    'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Osmania Biscuit',         'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Cashew Rusk',             'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Baby Rusk',               'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Milk Rusk',               'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Popcorn',                 'category_id',v_cake_rusk,'type','pack','weight_value',80,'weight_unit','g','mrp',25,'purchase_price',18,'active',true),
      jsonb_build_object('name','Adhirasam',               'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','KVP Adhirasam',           'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',50,'purchase_price',36,'active',true),
      jsonb_build_object('name','Somas',                   'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Porivilanga Laddu',       'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Achu Murukku',            'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),
      jsonb_build_object('name','Milk Cake',               'category_id',v_cake_rusk,'type','pack','weight_value',250,'weight_unit','g','mrp',150,'purchase_price',110,'active',true),
      jsonb_build_object('name','Gulab Jamun',             'category_id',v_cake_rusk,'type','jar','weight_value',500,'weight_unit','g','mrp',180,'purchase_price',132,'active',true),
      jsonb_build_object('name','Malkist',                 'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',35,'purchase_price',26,'active',true),
      jsonb_build_object('name','Coconut Milk Murukku',    'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Macroon Sada',            'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',40,'purchase_price',30,'active',true),
      jsonb_build_object('name','Macroon Special',         'category_id',v_cake_rusk,'type','pack','weight_value',100,'weight_unit','g','mrp',45,'purchase_price',32,'active',true),

      -- ── Cover (7 SKUs — packaging) ──
      jsonb_build_object('name','Single Cover Green',      'category_id',v_cover,'type','pack','weight_value',5,'weight_unit','g','mrp',2,'purchase_price',1,'active',true),
      jsonb_build_object('name','Single Cover Orange',     'category_id',v_cover,'type','pack','weight_value',5,'weight_unit','g','mrp',2,'purchase_price',1,'active',true),
      jsonb_build_object('name','100g Cover',              'category_id',v_cover,'type','pack','weight_value',5,'weight_unit','g','mrp',3,'purchase_price',2,'active',true),
      jsonb_build_object('name','250g Cover Yellow',       'category_id',v_cover,'type','pack','weight_value',10,'weight_unit','g','mrp',5,'purchase_price',3,'active',true),
      jsonb_build_object('name','250g Cover Green',        'category_id',v_cover,'type','pack','weight_value',10,'weight_unit','g','mrp',5,'purchase_price',3,'active',true),
      jsonb_build_object('name','500g Cover',              'category_id',v_cover,'type','pack','weight_value',15,'weight_unit','g','mrp',7,'purchase_price',4,'active',true),
      jsonb_build_object('name','1 Kg Cover',              'category_id',v_cover,'type','pack','weight_value',20,'weight_unit','g','mrp',10,'purchase_price',6,'active',true)
    ), v_admin_id);

    RAISE NOTICE 'Catalogue inserted — ~158 products across 12 leaf categories.';
  END IF;

  ------------------------------------------------------------------
  -- 3. Pick the first 5 shops with their inventories.
  ------------------------------------------------------------------
  SELECT array_agg(id    ORDER BY code),
         array_agg(inventory_id ORDER BY code)
    INTO v_shop_ids, v_inventory_ids
  FROM ( SELECT id, inventory_id, code
         FROM shops
         WHERE is_deleted = false
         ORDER BY code
         LIMIT 5 ) s;

  v_shop_count := coalesce(array_length(v_shop_ids, 1), 0);
  IF v_shop_count < 5 THEN
    RAISE EXCEPTION 'Need at least 5 shops to seed requests (found %). Run phase1_seed_bulk.sql first.', v_shop_count;
  END IF;

  ------------------------------------------------------------------
  -- 4. Existing-requests guard — if any of the 5 shops already has
  --    a >=100-item Pending request, assume the seed has run.
  ------------------------------------------------------------------
  SELECT count(*) INTO v_existing_requests
  FROM stock_requests r
  WHERE r.shop_id = ANY(v_shop_ids)
    AND r.status = 'Pending'
    AND r.total_items >= 100
    AND r.is_deleted = false;

  IF v_existing_requests > 0 THEN
    RAISE NOTICE 'Stress-test requests already exist (% rows) — skipping request seed.', v_existing_requests;
  ELSE
    ------------------------------------------------------------------
    -- 5. For each shop, build 150-item jsonb payload and call
    --    fn_request_create. Items sampled at random from the
    --    products catalogue; qty randomised 1-12; unit_price is
    --    the product's current MRP.
    ------------------------------------------------------------------
    FOR i IN 1..v_shop_count LOOP
      v_shop_id      := v_shop_ids[i];
      v_inventory_id := v_inventory_ids[i];
      v_code         := fn_request_next_code();

      -- Build the items jsonb in a single SELECT.
      WITH sample AS (
        SELECT
          p.id  AS product_id,
          1 + floor(random() * 12)::int AS requested_qty,
          p.mrp AS unit_price
        FROM products p
        WHERE p.is_deleted = false
          AND p.active = true
        ORDER BY random()
        LIMIT 150
      )
      SELECT fn_request_create(
        v_code,
        v_shop_id,
        v_inventory_id,
        now() + interval '100 years',  -- lock window doesn't matter for the seed
        format('Stress-test seed request #%s — 150 items', i),
        (SELECT jsonb_agg(jsonb_build_object(
          'product_id',    product_id,
          'requested_qty', requested_qty,
          'unit_price',    unit_price
        )) FROM sample),
        v_admin_id
      )
      INTO v_request_id;

      RAISE NOTICE 'Created request % (id=%) for shop % with 150 items.', v_code, v_request_id, v_shop_id;
    END LOOP;

    RAISE NOTICE 'Seed complete — 5 requests, ~750 line items total.';
  END IF;
END $do$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- SELECT count(*) FROM products WHERE is_deleted = false;
--   --> includes pre-existing seeds + the ~158 new ones.
--
-- SELECT r.code, s.code AS shop, r.total_items, r.total_qty, r.total_amount
-- FROM stock_requests r
-- JOIN shops s ON s.id = r.shop_id
-- WHERE r.total_items >= 100 AND r.is_deleted = false
-- ORDER BY r.code;
--   --> 5 rows, each total_items = 150.
--
-- SELECT * FROM fn_request_get('<any-request-id>');
--   --> 150 items in the JSON.
--
-- Open /print/cumulative as admin → batch plan should aggregate
-- across all 5 requests. Open /print/request/{id} → 150-line
-- billing print.
--
-- ============================================================
-- ROLLBACK (when you want to wipe the stress-test data)
-- ============================================================
-- BEGIN;
-- -- Requests first (cascade deletes items).
-- DELETE FROM stock_requests
-- WHERE total_items = 150
--   AND notes LIKE 'Stress-test seed request%';
--
-- -- Products by category — IDs come from the new categories.
-- DELETE FROM products
-- WHERE category_id IN (
--   SELECT id FROM categories
--   WHERE name IN ('Mixture 1Kg ₹260','Mixture 1Kg ₹300','200g Items','250g Items',
--                  'Container Items','Sweets & Candy','Big Biscuit','Small Biscuit',
--                  'Biscuits','Cake & Rusk','Smartbite','Stickers','Cover')
-- );
--
-- -- Categories — children first.
-- DELETE FROM categories WHERE name IN ('Big Biscuit','Small Biscuit') AND parent_id IS NOT NULL;
-- DELETE FROM categories WHERE name IN ('Mixture 1Kg ₹260','Mixture 1Kg ₹300','200g Items','250g Items',
--                                       'Container Items','Sweets & Candy','Biscuits',
--                                       'Cake & Rusk','Smartbite','Stickers','Cover')
--   AND parent_id IS NULL;
-- COMMIT;
-- ============================================================
