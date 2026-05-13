-- ============================================================
-- Kovilpatti Snacks — Phase 1 PAGINATION FUNCTIONS
--
-- Adds server-side pagination support for products (Phase 1 pilot).
-- Run AFTER phase1_init.sql and phase1_procedures.sql.
--
-- Pattern per entity:
--   * fn_<entity>_list_paged(...filters..., p_page, p_page_size) — paginated rows
--   * fn_<entity>_count(...filters...)                            — total count
--
-- Existing non-paginated `fn_*_list` functions remain for callers
-- that still need full lists (e.g. dropdowns, dependency checks).
-- ============================================================


-- ------------------------------------------------------------
-- PRODUCTS
-- ------------------------------------------------------------
-- Return type gained a `gst` column → must DROP before redefining.
DROP FUNCTION IF EXISTS fn_product_list_paged(varchar, int, int, int);

CREATE OR REPLACE FUNCTION fn_product_list_paged(
  p_search      varchar DEFAULT NULL,
  p_category_id int     DEFAULT NULL,
  p_page        int     DEFAULT 1,
  p_page_size   int     DEFAULT 25
)
RETURNS TABLE (
  id             uuid,
  code           varchar,
  name           varchar,
  category_id    int,
  category_name  varchar,
  type           varchar,
  weight_value   numeric,
  weight_unit    varchar,
  mrp            numeric,
  purchase_price numeric,
  gst            numeric,
  active         boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.is_deleted = false
    AND (p_search IS NULL
         OR p.name ILIKE '%' || p_search || '%'
         OR p.code ILIKE '%' || p_search || '%')
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ORDER BY p.code
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;


CREATE OR REPLACE FUNCTION fn_product_count(
  p_search      varchar DEFAULT NULL,
  p_category_id int     DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)
  FROM products p
  WHERE p.is_deleted = false
    AND (p_search IS NULL
         OR p.name ILIKE '%' || p_search || '%'
         OR p.code ILIKE '%' || p_search || '%')
    AND (p_category_id IS NULL OR p.category_id = p_category_id);
$$;


-- ------------------------------------------------------------
-- INVENTORIES
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_inventory_list_paged(
  p_page      int DEFAULT 1,
  p_page_size int DEFAULT 25
)
RETURNS TABLE (
  id                  uuid,
  code                varchar,
  name                varchar,
  address             varchar,
  contact_phone       varchar,
  contact_person_name varchar,
  active              boolean
)
LANGUAGE sql STABLE AS $$
  SELECT i.id, i.code, i.name, i.address,
         i.contact_phone, i.contact_person_name, i.active
  FROM inventories i
  WHERE i.is_deleted = false
  ORDER BY i.code
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;


CREATE OR REPLACE FUNCTION fn_inventory_count()
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*) FROM inventories WHERE is_deleted = false;
$$;


-- ------------------------------------------------------------
-- SHOPS
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_shop_list_paged(
  p_page      int DEFAULT 1,
  p_page_size int DEFAULT 25
)
RETURNS TABLE (
  id              uuid,
  code            varchar,
  name            varchar,
  address         varchar,
  contact_phone_1 varchar,
  contact_phone_2 varchar,
  gstin           varchar,
  inventory_id    uuid,
  inventory_name  varchar,
  active          boolean
)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.code, s.name, s.address,
         s.contact_phone_1, s.contact_phone_2, s.gstin,
         s.inventory_id, i.name AS inventory_name, s.active
  FROM shops s
  INNER JOIN inventories i ON i.id = s.inventory_id
  WHERE s.is_deleted = false
  ORDER BY s.code
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;


CREATE OR REPLACE FUNCTION fn_shop_count()
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*) FROM shops WHERE is_deleted = false;
$$;


-- ------------------------------------------------------------
-- USERS (non-admin only — admin row is excluded from staff list)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_user_list_paged(
  p_page      int DEFAULT 1,
  p_page_size int DEFAULT 25
)
RETURNS TABLE (
  id              uuid,
  username        varchar,
  password_hash   varchar,
  full_name       varchar,
  role            user_role,
  shop_id         uuid,
  shop_name       varchar,
  inventory_id    uuid,
  inventory_name  varchar,
  active          boolean
)
LANGUAGE sql STABLE AS $$
  SELECT u.id, u.username, u.password_hash, u.full_name, u.role,
         u.shop_id, s.name AS shop_name,
         u.inventory_id, i.name AS inventory_name,
         u.active
  FROM users u
  LEFT JOIN shops s       ON s.id = u.shop_id
  LEFT JOIN inventories i ON i.id = u.inventory_id
  WHERE u.role <> 'admin' AND u.is_deleted = false
  ORDER BY u.username
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;


CREATE OR REPLACE FUNCTION fn_user_count()
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*) FROM users WHERE role <> 'admin' AND is_deleted = false;
$$;


-- ============================================================
-- HOW TO RUN
-- ------------------------------------------------------------
-- Supabase: SQL Editor → paste this file → Run.
-- Local PG: psql -U postgres -d sks_inventory -f phase1_pagination.sql
--
-- VERIFY
--   SELECT COUNT(*) FROM fn_product_list_paged(NULL, NULL, 1, 10);    -- ≤ 10
--   SELECT fn_product_count(NULL, NULL);                              -- total
--   SELECT COUNT(*) FROM fn_inventory_list_paged(1, 10);              -- ≤ 10
--   SELECT fn_inventory_count();                                      -- total
--   SELECT COUNT(*) FROM fn_shop_list_paged(1, 10);                   -- ≤ 10
--   SELECT fn_shop_count();                                           -- total
--   SELECT COUNT(*) FROM fn_user_list_paged(1, 10);                   -- ≤ 10
--   SELECT fn_user_count();                                           -- total
-- ============================================================
