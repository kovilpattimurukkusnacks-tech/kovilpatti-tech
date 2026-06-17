-- ============================================================
-- Kovilpatti Snacks — Phase 1 ADDENDUM: Products optimizations
--
-- Products are Phase 1 master data; this is a follow-up migration (like
-- phase1_pagination.sql) layered on top of phase1_procedures.sql.
--
-- RUN ORDER: after phase1_init.sql + phase1_procedures.sql.
--   (This file REPLACES fn_product_next_code, so it must run after the
--    original definition in phase1_procedures.sql — otherwise a later
--    re-run of phase1_procedures.sql would clobber the sequence version.)
--
-- Adds:
--   • Sequence-backed fn_product_next_code (replaces MAX+1 pattern that was
--     unsafe for bulk insert from fn_product_create_bulk).
--   • Unique partial index on the product "variant key" tuple — replaces
--     the load-all-products check in BE (ProductService).
--   • fn_product_variant_exists — single-index lookup the BE can call
--     instead of iterating the whole catalog.
--   • fn_product_create_bulk — atomic bulk insert for the CSV/Excel import
--     flow. Generates codes server-side so 100 imported rows become 1 SP
--     call instead of 200.
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase1/phase1_products_optimizations.sql
--
-- Idempotent — uses CREATE OR REPLACE / IF NOT EXISTS. Safe to re-run.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. Sequence-backed fn_product_next_code
--
-- Replaces the old MAX(code)+1 pattern. MAX+1 was unsafe for bulk inserts
-- (fn_product_create_bulk calls fn_product_next_code N times inside one
-- INSERT statement, and MAX never changes mid-statement → every row
-- computed the same code → UNIQUE constraint violation on row #2+).
--
-- Sequences are atomic and return a fresh value on every nextval() call,
-- so bulk inserts get distinct codes naturally.
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_product_code START 1;

-- Seed the sequence past any existing P-codes so this script can run on an
-- environment with data without colliding.
--   • Empty table  → setval(seq, 1, false) → next nextval() returns 1.
--   • Has data     → setval(seq, max, true) → next nextval() returns max+1.
-- (Can't use COALESCE(..., 0) + true here: setval to 0 is out of bounds —
--  the sequence minimum is 1.)
DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT MAX(substring(code FROM 2)::bigint) INTO v_max
  FROM products
  WHERE code ~ '^P[0-9]+$';

  IF v_max IS NULL THEN
    PERFORM setval('seq_product_code', 1, false);
  ELSE
    PERFORM setval('seq_product_code', v_max, true);
  END IF;
END $$;

-- Replace fn_product_next_code with a sequence-backed version. Same return
-- shape (P + 3-digit-zero-padded number) so callers don't change.
CREATE OR REPLACE FUNCTION fn_product_next_code()
RETURNS varchar
LANGUAGE sql AS $$
  SELECT 'P' || lpad(nextval('seq_product_code')::text, 3, '0')
$$;

-- ------------------------------------------------------------
-- 1. Unique partial index on the variant tuple
--
-- Treats two products as "the same SKU" if their normalized
-- (name, category, type, weight_value, weight_unit) all match.
--
-- NULL weight_value is its own bucket (different from "0" or "10g"),
-- so we coalesce to -1 (a value valid weight_value can never be — chk
-- says >0) for indexing purposes.
--
-- Excludes soft-deleted rows so a deleted product doesn't block a fresh
-- insert with the same variant.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_variant_active
ON products (
  LOWER(TRIM(name)),
  category_id,
  LOWER(TRIM(type)),
  COALESCE(weight_value, -1),
  LOWER(TRIM(COALESCE(weight_unit, 'g')))
)
WHERE is_deleted = false;

-- ------------------------------------------------------------
-- 2. fn_product_variant_exists — does any active product match this tuple?
--
-- p_exclude_id lets the caller skip a specific row (used when validating
-- an Update — the row being updated must not match itself).
--
-- String params declared as `text` so Dapper's default text-typed
-- parameters match without an implicit-cast hop. (Postgres won't always
-- auto-cast text→varchar during overload resolution.)
--
-- Defensive drop: an earlier draft of this script used `varchar` for the
-- string params. CREATE OR REPLACE only replaces a function with the
-- exact same signature, so the varchar version would survive alongside
-- the text version → ambiguous overload at call time. The IF EXISTS makes
-- this a no-op on fresh deploys.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_product_variant_exists(varchar, int, varchar, numeric, varchar, uuid);

CREATE OR REPLACE FUNCTION fn_product_variant_exists(
  p_name         text,
  p_category_id  int,
  p_type         text,
  p_weight_value numeric,
  p_weight_unit  text,
  p_exclude_id   uuid
)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM products
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(p_name))
      AND category_id = p_category_id
      AND LOWER(TRIM(type)) = LOWER(TRIM(p_type))
      AND COALESCE(weight_value, -1) = COALESCE(p_weight_value, -1)
      AND LOWER(TRIM(COALESCE(weight_unit, 'g'))) = LOWER(TRIM(COALESCE(p_weight_unit, 'g')))
      AND (p_exclude_id IS NULL OR id <> p_exclude_id)
      AND is_deleted = false
  );
$$;

-- ------------------------------------------------------------
-- 3. fn_product_create_bulk — atomic bulk insert for imports
--
-- p_products is a jsonb array of objects with keys:
--   code (optional), name, category_id, type, weight_value, weight_unit,
--   mrp, purchase_price, gst, active
--
-- Code resolution (13-Jun-2026, client #10):
--   • Non-blank `code` in the payload → admin's value is used.
--   • Blank / missing `code`           → fn_product_next_code() generates
--                                        a fresh sequence-backed P### code.
-- BE-side uniqueness checks happen before this SP runs; the column's UNIQUE
-- constraint is the last line of defense (e.g., concurrent writers).
--
-- Returns (id, code) per inserted row so the BE can correlate.
--
-- Atomicity: the whole INSERT runs inside whatever transaction calls this
-- SP. If any row violates a constraint (e.g., code uniqueness), the entire
-- batch rolls back.
-- ------------------------------------------------------------
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
    p_user_id,
    p_user_id
  FROM jsonb_array_elements(p_products) AS p
  RETURNING products.id, products.code;
END;
$$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- \df fn_product_next_code fn_product_variant_exists fn_product_create_bulk
-- \d uq_products_variant_active
-- ============================================================
