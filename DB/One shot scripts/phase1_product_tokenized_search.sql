-- =====================================================================
-- phase1_product_tokenized_search.sql
-- =====================================================================
-- Addendum: tokenise the product-search predicate.
-- Client (10-Jul-2026): typing "nat.kam" (with a dot) returned "No options"
-- because the naive whole-string ILIKE compared 'nat.kam' against the label
-- 'PROD017 — Nattu Kambu Podi' which has a SPACE between the words, not a
-- dot. Same failure mode for code searches when the user mixes separators
-- ("1kg lkd" against code "1KG-LKD").
--
-- Fix: split p_search on any non-alphanumeric separator (space, dot, comma,
-- dash, slash…) into tokens, and require EVERY token to appear as a case-
-- insensitive substring of the combined "code + ' ' + name". So the same
-- product now matches:
--   nat.kam / nat kam / nat,kam / kambu / 017 kam / nk-25 / lkd — all work.
--
-- Baseline files updated to match:
--   • DB/phase1/phase1_procedures.sql  → fn_product_list
--   • DB/phase1/phase1_pagination.sql  → fn_product_list_paged, fn_product_count
-- Safe to re-run: all three CREATE OR REPLACE, no signature/return-shape change.
-- =====================================================================


-- ------------------------------------------------------------
-- 1. Non-paginated product list (used by dropdowns / dep checks)
-- ------------------------------------------------------------
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
  active             boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.is_deleted = false
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


-- ------------------------------------------------------------
-- 2. Paginated product list (used by the shop / admin product grids)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_product_list_paged(
  p_search       varchar    DEFAULT NULL,
  p_category_ids int[]      DEFAULT NULL,
  p_types        varchar[]  DEFAULT NULL,
  p_page         int        DEFAULT 1,
  p_page_size    int        DEFAULT 25
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
  active             boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.is_deleted = false
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


-- ------------------------------------------------------------
-- 3. Product count — MUST use the identical predicate as _paged,
--    else pagination breaks (page-1 shows N rows, count returns M).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_product_count(
  p_search       varchar    DEFAULT NULL,
  p_category_ids int[]      DEFAULT NULL,
  p_types        varchar[]  DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)
  FROM products p
  WHERE p.is_deleted = false
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


-- =====================================================================
-- QUICK VERIFY (paste each block into SQL editor, adjust values to
-- match a real product in your DB):
--
--   SELECT code, name FROM fn_product_list('nat.kam');       -- should hit
--   SELECT code, name FROM fn_product_list('nat kam');       -- should hit
--   SELECT code, name FROM fn_product_list('kambu');         -- should hit
--   SELECT code, name FROM fn_product_list('017 kam');       -- should hit
--   SELECT code, name FROM fn_product_list(NULL) LIMIT 5;    -- unfiltered
--   SELECT code, name FROM fn_product_list('') LIMIT 5;      -- unfiltered
--   SELECT COUNT(*) FROM fn_product_list_paged('nat kam', NULL, NULL, 1, 25);
--   SELECT fn_product_count('nat kam', NULL, NULL);          -- matches above
-- =====================================================================
