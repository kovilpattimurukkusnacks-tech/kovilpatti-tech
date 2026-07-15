-- =====================================================================
-- phase1_product_code_in_bulk_import.sql
-- =====================================================================
-- Addendum: let fn_product_create_bulk accept an admin-provided code per
-- row, falling back to fn_product_next_code() when blank.
--
-- Client #10 (13-Jun-2026): editable code now also applies to the bulk
-- import path, so the Excel template can include a `code` column. BE-side
-- uniqueness checks (against existing DB + same-file duplicates) happen
-- before this SP is invoked; the UNIQUE constraint on products.code is
-- the last line of defense.
--
-- Idempotent: CREATE OR REPLACE FUNCTION with same signature — running
-- this multiple times is harmless.
--
-- RUN ORDER: after phase1_init.sql + phase1_procedures.sql +
-- phase1_products_optimizations.sql. Safe on a fresh install (the
-- baseline phase1_products_optimizations.sql has the same body merged
-- in already; this script is purely an upgrade convenience for
-- environments stuck on the prior signature).
-- =====================================================================

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
