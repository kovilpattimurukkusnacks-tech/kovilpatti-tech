-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1 — is_vendor_procured on products (SP upgrade, one-shot)
-- 02-Jul-2026
--
-- The column itself is added by phase2_backorder_schema.sql (safe to
-- run either before or after this file — the column just needs to exist
-- when the SPs' bodies reference it).
--
-- This script:
--   1. Drops the pre-flag Create / Update signatures so CREATE OR REPLACE
--      can install the extended ones (extra bool param p_is_vendor_procured).
--   2. Drops the RETURNS-shape of Get / List / List-paged so the new column
--      lands in the projection.
--   3. Rewrites fn_product_create_bulk to read is_vendor_procured from the
--      import JSON (falls back to false when the key is missing — old CSVs
--      keep importing unchanged).
--
-- Backward compat: nothing else depends on the pre-flag signature; the BE
-- was updated in the same commit. Applying this script BEFORE deploying
-- the BE will hard-break /api/products/* until the BE lands; deploy them
-- together (or apply this script AFTER the BE is up if you can afford the
-- brief FE error banner).
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Create / Update — drop the pre-flag shapes so the new bodies below
--    can install with the extended arg list.
DROP FUNCTION IF EXISTS fn_product_create(varchar, varchar, int, varchar, numeric, varchar, numeric, numeric, numeric, boolean, uuid);
DROP FUNCTION IF EXISTS fn_product_update(uuid, varchar, varchar, int, varchar, numeric, varchar, numeric, numeric, numeric, boolean, uuid);

CREATE OR REPLACE FUNCTION fn_product_create(
  p_code               varchar,
  p_name               varchar,
  p_category_id        int,
  p_type               varchar,
  p_weight_value       numeric,
  p_weight_unit        varchar,
  p_mrp                numeric,
  p_purchase_price     numeric,
  p_gst                numeric,
  p_active             boolean,
  p_is_vendor_procured boolean,
  p_user_id            uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO products (code, name, category_id, type,
                        weight_value, weight_unit, mrp, purchase_price,
                        gst, active, is_vendor_procured, created_by, updated_by)
  VALUES (p_code, p_name, p_category_id, p_type,
          p_weight_value, p_weight_unit, p_mrp, p_purchase_price,
          p_gst, p_active, COALESCE(p_is_vendor_procured, false), p_user_id, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_product_update(
  p_id                 uuid,
  p_code               varchar,
  p_name               varchar,
  p_category_id        int,
  p_type               varchar,
  p_weight_value       numeric,
  p_weight_unit        varchar,
  p_mrp                numeric,
  p_purchase_price     numeric,
  p_gst                numeric,
  p_active             boolean,
  p_is_vendor_procured boolean,
  p_user_id            uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  -- p_is_vendor_procured NULL → keep existing (COALESCE fallback).
  UPDATE products
  SET code               = p_code,
      name               = p_name,
      category_id        = p_category_id,
      type               = p_type,
      weight_value       = p_weight_value,
      weight_unit        = p_weight_unit,
      mrp                = p_mrp,
      purchase_price     = p_purchase_price,
      gst                = p_gst,
      active             = p_active,
      is_vendor_procured = COALESCE(p_is_vendor_procured, is_vendor_procured),
      updated_by         = p_user_id,
      updated_at         = now()
  WHERE id = p_id;

  RETURN FOUND;
END;
$$;


-- 2. Get / List / List-paged — RETURNS TABLE gains is_vendor_procured.
--    Drop the pre-flag shapes so CREATE OR REPLACE can land the new one.
DROP FUNCTION IF EXISTS fn_product_get(uuid);
DROP FUNCTION IF EXISTS fn_product_list(varchar, int);
DROP FUNCTION IF EXISTS fn_product_list_paged(varchar, int[], varchar[], int, int);

CREATE OR REPLACE FUNCTION fn_product_get(p_id uuid)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  name               varchar,
  category_id        int,
  category_name      varchar,
  type               varchar,
  weight_value       numeric,
  weight_unit        varchar,
  mrp                numeric,
  purchase_price     numeric,
  gst                numeric,
  active             boolean,
  is_vendor_procured boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active, p.is_vendor_procured
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.id = p_id AND p.is_deleted = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_product_list(
  p_search      varchar DEFAULT NULL,
  p_category_id int     DEFAULT NULL
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  name               varchar,
  category_id        int,
  category_name      varchar,
  type               varchar,
  weight_value       numeric,
  weight_unit        varchar,
  mrp                numeric,
  purchase_price     numeric,
  gst                numeric,
  active             boolean,
  is_vendor_procured boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active, p.is_vendor_procured
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.is_deleted = false
    AND (p_search IS NULL
         OR p.name ILIKE '%' || p_search || '%'
         OR p.code ILIKE '%' || p_search || '%')
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ORDER BY p.code;
$$;

CREATE OR REPLACE FUNCTION fn_product_list_paged(
  p_search       varchar   DEFAULT NULL,
  p_category_ids int[]     DEFAULT NULL,
  p_types        varchar[] DEFAULT NULL,
  p_page         int       DEFAULT 1,
  p_page_size    int       DEFAULT 25
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  name               varchar,
  category_id        int,
  category_name      varchar,
  type               varchar,
  weight_value       numeric,
  weight_unit        varchar,
  mrp                numeric,
  purchase_price     numeric,
  gst                numeric,
  active             boolean,
  is_vendor_procured boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active, p.is_vendor_procured
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.is_deleted = false
    AND (p_search IS NULL
         OR p.name ILIKE '%' || p_search || '%'
         OR p.code ILIKE '%' || p_search || '%')
    AND (p_category_ids IS NULL OR cardinality(p_category_ids) = 0
         OR p.category_id = ANY(p_category_ids))
    AND (p_types IS NULL OR cardinality(p_types) = 0
         OR p.type = ANY(p_types))
  ORDER BY p.code
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;


-- 3. Bulk create — reads is_vendor_procured from the import JSON. Missing
--    key defaults to false so pre-flag CSVs / Excel files keep importing.
--
-- Drop first: even with an unchanged RETURN TABLE shape, Postgres refuses
-- to CREATE OR REPLACE when it treats the columns as OUT parameters (42P13).
-- IF EXISTS keeps this idempotent.
DROP FUNCTION IF EXISTS fn_product_create_bulk(jsonb, uuid);

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
    gst, active, is_vendor_procured, created_by, updated_by
  )
  SELECT
    COALESCE(NULLIF(p->>'code', ''), fn_product_next_code()),
    (p->>'name')::varchar,
    (p->>'category_id')::int,
    (p->>'type')::varchar,
    NULLIF(p->>'weight_value', '')::numeric,
    COALESCE(NULLIF(p->>'weight_unit', ''), 'g'),
    (p->>'mrp')::numeric,
    (p->>'purchase_price')::numeric,
    NULLIF(p->>'gst', '')::numeric,
    COALESCE((p->>'active')::boolean, true),
    COALESCE((p->>'is_vendor_procured')::boolean, false),
    p_user_id,
    p_user_id
  FROM jsonb_array_elements(p_products) AS p
  RETURNING products.id, products.code;
END;
$$;
