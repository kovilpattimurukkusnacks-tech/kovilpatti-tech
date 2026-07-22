-- ============================================================
-- ONE-SHOT: phase1_product_include_inactive
--
-- Fixes: admin toggles a product to `active=false` but the shop user's
-- picker still lists it (21-Jul-2026, client report). The three product
-- list SPs were filtering only on is_deleted → inactive rows kept
-- surfacing.
--
-- Adds p_include_inactive to fn_product_list, fn_product_list_paged,
-- and fn_product_count. Default false → callers that don't opt in see
-- ONLY active products. Admin's product management page passes true so
-- it can still see and reactivate inactive rows.
--
-- Users only ever see active products on the shop / inventory pickers.
-- The BE controller silently ignores includeInactive=true from
-- non-Admin roles as a defence-in-depth.
--
-- Idempotent — safe to re-run. Old signatures dropped explicitly
-- because signature change → CREATE OR REPLACE alone can't handle it.
--
-- IMPLEMENTATION NOTE — the SP bodies below are copied VERBATIM from
-- the baseline (phase1_pagination.sql for the paged pair,
-- phase1_procedures.sql for the non-paged variant). Same tokenised
-- search predicate across all three; MUST stay in sync.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS fn_product_list_paged(varchar, int[], varchar[], int, int);
DROP FUNCTION IF EXISTS fn_product_count      (varchar, int[], varchar[]);
DROP FUNCTION IF EXISTS fn_product_list       (varchar, int);

CREATE OR REPLACE FUNCTION fn_product_list_paged(
  p_search           varchar    DEFAULT NULL,
  p_category_ids     int[]      DEFAULT NULL,
  p_types            varchar[]  DEFAULT NULL,
  p_page             int        DEFAULT 1,
  p_page_size        int        DEFAULT 25,
  p_include_inactive boolean    DEFAULT false
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  barcode            varchar,
  name               varchar,
  category_id        int,
  category_name      varchar,
  type               varchar,
  weight_value       numeric,
  weight_unit        varchar,
  mrp                numeric,
  purchase_price     numeric,
  gst                numeric,
  active             boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.barcode, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.is_deleted = false
    AND (p_include_inactive = true OR p.active = true)
    AND (p_search IS NULL OR trim(p_search) = ''
         OR NOT EXISTS (
           SELECT 1
           FROM regexp_split_to_table(lower(trim(p_search)), '[^a-z0-9]+') AS tok
           WHERE tok <> ''
             AND strpos(lower(p.code || ' ' || p.name), tok) = 0
         ))
    AND (p_category_ids IS NULL OR cardinality(p_category_ids) = 0
         OR p.category_id = ANY(p_category_ids))
    AND (p_types IS NULL OR cardinality(p_types) = 0
         OR p.type = ANY(p_types))
  ORDER BY p.code
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;


CREATE OR REPLACE FUNCTION fn_product_count(
  p_search           varchar    DEFAULT NULL,
  p_category_ids     int[]      DEFAULT NULL,
  p_types            varchar[]  DEFAULT NULL,
  p_include_inactive boolean    DEFAULT false
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)
  FROM products p
  WHERE p.is_deleted = false
    AND (p_include_inactive = true OR p.active = true)
    AND (p_search IS NULL OR trim(p_search) = ''
         OR NOT EXISTS (
           SELECT 1
           FROM regexp_split_to_table(lower(trim(p_search)), '[^a-z0-9]+') AS tok
           WHERE tok <> ''
             AND strpos(lower(p.code || ' ' || p.name), tok) = 0
         ))
    AND (p_category_ids IS NULL OR cardinality(p_category_ids) = 0
         OR p.category_id = ANY(p_category_ids))
    AND (p_types IS NULL OR cardinality(p_types) = 0
         OR p.type = ANY(p_types));
$$;


CREATE OR REPLACE FUNCTION fn_product_list(
  p_search           varchar DEFAULT NULL,
  p_category_id      int     DEFAULT NULL,
  p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  barcode            varchar,
  name               varchar,
  category_id        int,
  category_name      varchar,
  type               varchar,
  weight_value       numeric,
  weight_unit        varchar,
  mrp                numeric,
  purchase_price     numeric,
  gst                numeric,
  active             boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.barcode, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.is_deleted = false
    AND (p_include_inactive = true OR p.active = true)
    AND (p_search IS NULL OR trim(p_search) = ''
         OR NOT EXISTS (
           SELECT 1
           FROM regexp_split_to_table(lower(trim(p_search)), '[^a-z0-9]+') AS tok
           WHERE tok <> ''
             AND strpos(lower(p.code || ' ' || p.name), tok) = 0
         ))
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ORDER BY p.code;
$$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- 1. Signature check — all three SPs should end in `boolean`:
--    SELECT proname, pg_get_function_identity_arguments(oid)
--    FROM pg_proc
--    WHERE proname IN ('fn_product_list','fn_product_list_paged','fn_product_count');
--
-- 2. Behaviour — inactive rows hidden by default:
--    SELECT COUNT(*) FROM fn_product_list_paged(NULL, NULL, NULL, 1, 10000);
--    -- Should equal number of active + non-deleted products.
--
-- 3. Admin opt-in — inactive rows surface:
--    SELECT COUNT(*) FROM fn_product_list_paged(NULL, NULL, NULL, 1, 10000, true);
--    -- Should equal number of ALL non-deleted products (active + inactive).
-- ============================================================
