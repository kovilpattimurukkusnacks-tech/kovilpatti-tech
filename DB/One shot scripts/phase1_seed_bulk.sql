-- ============================================================
-- Kovilpatti Snacks — Phase 1 BULK SEED DATA
--
-- Inserts:
--   * 500   inventories (INV0001 .. INV0500)
--   * 1000  shops       (SHP0001 .. SHP1000) — round-robin'd to inventories
--   * 500   shop_user   staff (shopuser001 .. shopuser500) — one per shop 1..500
--   * 500   inventory   staff (invuser001  .. invuser500)  — one per inventory 1..500
--   * 2000  products    (P0001  .. P2000)   — round-robin'd across categories
--
-- ============================================================
-- ASSUMPTIONS
-- ------------------------------------------------------------
--  * Run on a FRESH dev/UAT DB — no existing rows in inventories,
--    shops, products, or non-admin users. Existing data with
--    overlapping `code` or `username` will hit unique-constraint
--    violations.
--  * Categories already seeded (Snacks, Beverages, Food, Biscuits,
--    Dairy — see README → First-time setup → Database).
--  * The seeded admin row already exists (auto-created on first
--    BE boot when Seed:AdminPassword is set).
--
-- ------------------------------------------------------------
-- HOW TO RUN
-- ------------------------------------------------------------
--   Local PG: psql -U postgres -d sks_inventory -f phase1_seed_bulk.sql
--   Supabase: paste this entire file in SQL Editor and click Run.
--
-- ------------------------------------------------------------
-- PASSWORDS
-- ------------------------------------------------------------
--  All seeded users get the same placeholder bcrypt hash. It does
--  NOT correspond to any real password — these accounts cannot log
--  in until you reset their password. Two ways to do that:
--
--   (a) From the running BE, call the password-reset endpoint as
--       Admin for each user:
--         PUT /api/users/{id}/password  body: { "password": "..." }
--
--   (b) Generate a real bcrypt $2a$11 hash externally (node, python,
--       https://bcrypt-generator.com — set cost to 11) and update:
--         UPDATE users SET password_hash = '<your-bcrypt-hash>'
--         WHERE username LIKE 'shopuser%' OR username LIKE 'invuser%';
--
-- ------------------------------------------------------------
-- TO ROLL BACK
-- ------------------------------------------------------------
--  See the DELETE block at the bottom of this file.
-- ============================================================


-- Sanity check — categories must exist before seeding products.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM categories WHERE is_deleted = false) THEN
    RAISE EXCEPTION 'No active categories found. Seed categories first (see README).';
  END IF;
END $$;


BEGIN;


-- ------------------------------------------------------------
-- 1. INVENTORIES (500)
-- ------------------------------------------------------------
INSERT INTO inventories (code, name, address, contact_phone, contact_person_name, active)
SELECT
  'INV' || lpad(g::text, 4, '0'),
  'Inventory ' || g,
  'Godown ' || g || ', Industrial Area, City ' || ((g % 50) + 1),
  '+91 ' || lpad((9000000000::bigint + g)::text, 10, '0'),
  'Manager ' || g,
  CASE WHEN g % 20 = 0 THEN false ELSE true END        -- ~5% inactive
FROM generate_series(1, 500) g;


-- ------------------------------------------------------------
-- 2. SHOPS (1000)
--    Each shop links to one of the 500 inventories (cyclic).
-- ------------------------------------------------------------
INSERT INTO shops (code, name, address, contact_phone_1, contact_phone_2, gstin, inventory_id, active)
SELECT
  'SHP' || lpad(g::text, 4, '0'),
  'Shop ' || g,
  'Shop No ' || g || ', Main Street, Town ' || ((g % 100) + 1),
  '+91 ' || lpad((8000000000::bigint + g)::text, 10, '0'),
  CASE WHEN g % 3 = 0
       THEN '+91 ' || lpad((7000000000::bigint + g)::text, 10, '0')
       END,
  CASE WHEN g % 5 = 0
       THEN upper(substring(md5(g::text || 'gst') from 1 for 15))
       END,
  inv.id,
  CASE WHEN g % 20 = 0 THEN false ELSE true END        -- ~5% inactive
FROM generate_series(1, 1000) g
CROSS JOIN LATERAL (
  SELECT id FROM inventories
  WHERE code = 'INV' || lpad((((g - 1) % 500) + 1)::text, 4, '0')
) inv;


-- ------------------------------------------------------------
-- 3a. SHOP STAFF (500) — shopuser001 .. shopuser500
--     Each is bound to shop number = its index (1..500).
-- ------------------------------------------------------------
INSERT INTO users (username, password_hash, full_name, role, shop_id, active)
SELECT
  'shopuser' || lpad(g::text, 3, '0'),
  '$2a$11$placeholderhashresetviaapidonotuseforauthxxxxxxxxxxxxxxxxxx',
  'Shop Staff ' || g,
  'shop_user'::user_role,
  shp.id,
  CASE WHEN g % 25 = 0 THEN false ELSE true END        -- ~4% inactive
FROM generate_series(1, 500) g
CROSS JOIN LATERAL (
  SELECT id FROM shops WHERE code = 'SHP' || lpad(g::text, 4, '0')
) shp;


-- ------------------------------------------------------------
-- 3b. INVENTORY STAFF (500) — invuser001 .. invuser500
--     Each is bound to inventory number = its index (1..500).
-- ------------------------------------------------------------
INSERT INTO users (username, password_hash, full_name, role, inventory_id, active)
SELECT
  'invuser' || lpad(g::text, 3, '0'),
  '$2a$11$placeholderhashresetviaapidonotuseforauthxxxxxxxxxxxxxxxxxx',
  'Inventory Staff ' || g,
  'inventory'::user_role,
  inv.id,
  CASE WHEN g % 25 = 0 THEN false ELSE true END        -- ~4% inactive
FROM generate_series(1, 500) g
CROSS JOIN LATERAL (
  SELECT id FROM inventories WHERE code = 'INV' || lpad(g::text, 4, '0')
) inv;


-- ------------------------------------------------------------
-- 4. PRODUCTS (2000)
--    category_id picked round-robin across whatever active
--    categories already exist (Snacks, Beverages, etc.).
--    weight_value: most rows in grams (10..510 g); every 5th row
--    is in kg (1..5 kg); every 7th row leaves it NULL.
-- ------------------------------------------------------------
INSERT INTO products (code, name, category_id, type, weight_value, weight_unit, mrp, purchase_price, active)
SELECT
  'P' || lpad(g::text, 4, '0'),
  'Product ' || g,
  cat.id,
  CASE (g % 4)
    WHEN 0 THEN 'pack'
    WHEN 1 THEN 'bottle'
    WHEN 2 THEN 'jar'
    ELSE        'box'
  END,
  CASE
    WHEN g % 7 = 0 THEN NULL
    WHEN g % 5 = 0 THEN ((g % 5) + 1)::numeric         -- 1..5 kg
    ELSE             (((g % 50) + 1) * 10)::numeric    -- 10..510 g
  END,
  CASE WHEN g % 5 = 0 THEN 'kg' ELSE 'g' END,
  ROUND((10 + (g % 500))::numeric, 2),                 -- mrp 10..509
  ROUND((5  + (g % 400))::numeric, 2),                 -- purchase 5..404
  CASE WHEN g % 25 = 0 THEN false ELSE true END        -- ~4% inactive
FROM generate_series(1, 2000) g
CROSS JOIN LATERAL (
  SELECT id FROM categories
  WHERE is_deleted = false
  ORDER BY id
  OFFSET ((g - 1) % GREATEST((SELECT COUNT(*) FROM categories WHERE is_deleted = false), 1))
  LIMIT 1
) cat;


COMMIT;


-- ============================================================
-- VERIFY
-- ============================================================
-- SELECT COUNT(*) FROM inventories WHERE code LIKE 'INV0%';     -- 500
-- SELECT COUNT(*) FROM shops       WHERE code LIKE 'SHP0%';     -- 1000
-- SELECT COUNT(*) FROM users       WHERE username LIKE 'shopuser%';  -- 500
-- SELECT COUNT(*) FROM users       WHERE username LIKE 'invuser%';   -- 500
-- SELECT COUNT(*) FROM products    WHERE code LIKE 'P0%';       -- 2000


-- ============================================================
-- ROLLBACK / RESET (run manually if you want to wipe the seed)
-- ============================================================
-- BEGIN;
-- DELETE FROM products    WHERE code     LIKE 'P0%'        AND code     <= 'P2000';
-- DELETE FROM users       WHERE username LIKE 'shopuser%'  OR  username LIKE 'invuser%';
-- DELETE FROM shops       WHERE code     LIKE 'SHP0%'      AND code     <= 'SHP1000';
-- DELETE FROM inventories WHERE code     LIKE 'INV0%'      AND code     <= 'INV0500';
-- COMMIT;
