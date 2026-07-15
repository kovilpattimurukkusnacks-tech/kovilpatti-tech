-- =====================================================================
-- phase1_product_code_editable.sql
-- =====================================================================
-- Addendum: make products.code editable from the admin UI.
-- Client #10 (07-Jun-2026): admin wants to set / change product codes
-- manually instead of relying only on auto-generation (PRD-00001 ...).
--
-- DB column has always been varchar(20) UNIQUE NOT NULL, and the create
-- path already accepts p_code (empty → auto-gen, non-empty → use it).
-- This addendum only widens the *update* SP signature to accept p_code
-- so existing rows can be re-coded.
--
-- Safe to re-run: idempotent on fresh phase1_procedures.sql installs,
-- since phase1_procedures.sql has been updated to the new signature too.
-- =====================================================================

-- Drop both possible old signatures (defensive — depending on which
-- phase1_procedures.sql build the system ran, one or the other exists).
DROP FUNCTION IF EXISTS fn_product_update(uuid, varchar, int, varchar, numeric, varchar, numeric, numeric, boolean, uuid);

-- Recreate with the new signature: p_code as the 2nd parameter.
CREATE OR REPLACE FUNCTION fn_product_update(
  p_id             uuid,
  p_code           varchar,
  p_name           varchar,
  p_category_id    int,
  p_type           varchar,
  p_weight_value   numeric,
  p_weight_unit    varchar,
  p_mrp            numeric,
  p_purchase_price numeric,
  p_gst            numeric,
  p_active         boolean,
  p_user_id        uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products
  SET code           = p_code,
      name           = p_name,
      category_id    = p_category_id,
      type           = p_type,
      weight_value   = p_weight_value,
      weight_unit    = p_weight_unit,
      mrp            = p_mrp,
      purchase_price = p_purchase_price,
      gst            = p_gst,
      active         = p_active,
      updated_by     = p_user_id,
      updated_at     = now()
  WHERE id = p_id;

  RETURN FOUND;
END;
$$;
