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
--   • fn_product_create_bulk — atomic bulk insert for the CSV/Excel import
--     flow. Generates codes server-side so 100 imported rows become 1 SP
--     call instead of 200. Honours an explicit per-row `code` when present.
--
-- Drops (client #8, 28-May-2026 — variant uniqueness relaxed):
--   • uq_products_variant_active index — two products may now share the
--     exact (name, category, type, weight, weight_unit) tuple. Keeping this
--     unique index would make the script fail on any DB with duplicate
--     variants (e.g. catalogue seed v3).
--   • fn_product_variant_exists — the BE no longer pre-checks variants.
--   These DROPs are defensive: no-ops on a fresh deploy, cleanup on an
--   older dev DB that still has them.
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
-- 1. Drop relaxed-variant artifacts (client #8, 28-May-2026)
--
-- Variant uniqueness was relaxed: two products may share the exact
-- (name, category, type, weight_value, weight_unit) tuple, differing only
-- on their auto-assigned P-code. The old unique index would now reject
-- such rows (and abort this whole script, since it runs in one txn), so we
-- drop it and the helper SP that backed the pre-insert check.
--
-- Both drops are idempotent: no-ops on a fresh deploy that never had them,
-- cleanup on an older dev DB that does.
-- ------------------------------------------------------------
DROP INDEX IF EXISTS uq_products_variant_active;
DROP FUNCTION IF EXISTS fn_product_variant_exists(text, int, text, numeric, text, uuid);
DROP FUNCTION IF EXISTS fn_product_variant_exists(varchar, int, varchar, numeric, varchar, uuid);

-- ------------------------------------------------------------
-- 2. fn_product_create_bulk — atomic bulk insert for imports
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
-- 06-Jul-2026: `code` RETURNS type aligned to `text` — the products.code
-- column was widened from varchar(20) → text on 07-Jun-2026 (client #10:
-- long descriptive codes) but this SP's RETURNS TABLE still said varchar.
-- Latent until today's re-run flagged it with PG 42804 (RETURNING type vs
-- RETURNS type mismatch). Signature change → DROP first.
DROP FUNCTION IF EXISTS fn_product_create_bulk(jsonb, uuid);

CREATE OR REPLACE FUNCTION fn_product_create_bulk(
  p_products jsonb,
  p_user_id  uuid
)
RETURNS TABLE(id uuid, code text)
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
-- \df fn_product_next_code fn_product_create_bulk
-- (uq_products_variant_active + fn_product_variant_exists intentionally gone)
-- ============================================================
