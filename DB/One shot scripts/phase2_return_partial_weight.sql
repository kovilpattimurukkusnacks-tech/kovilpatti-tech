-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Return by partial weight (damage claim) — one-shot
-- 02-Jul-2026
--
-- What
-- ────
--   1. Adds stock_request_items.return_weight_g (numeric(10,3), nullable).
--   2. Adds chk_return_weight_g_bounds so values > 0 when set.
--   3. Rewrites fn_request_create_return to accept `return_weight_g` inside
--      each item and compute the line credit as
--        (return_weight_g / pack_weight_in_g) × unit_price
--      for partial-weight rows, keeping the units-only math for the rest.
--   4. Extends fn_request_get's items jsonb to project return_weight_g.
--
-- Scope
-- ─────
-- Only weight_unit IN ('g', 'kg') products are eligible for partial-weight
-- claims. SP raises if a payload references any other unit.
--
-- Semantics
-- ─────────
-- B2 — damage claim, no physical goods movement. Shop keeps the pack;
-- return_weight_g represents grams of value they're claiming credit for.
-- Godown reviews on Accept and either accepts (credit posted) or rejects.
-- Partial-weight accept isn't supported in this iteration — Accept is
-- all-or-nothing. Client can iterate.
--
-- Backward compat
-- ───────────────
-- Nullable column + additive JSON key on fn_request_get. Existing Return
-- payloads that don't include return_weight_g keep working unchanged.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Column + bounds guard.
ALTER TABLE stock_request_items
  ADD COLUMN IF NOT EXISTS return_weight_g numeric(10,3);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_return_weight_g_bounds'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_return_weight_g_bounds
      CHECK (return_weight_g IS NULL OR return_weight_g > 0);
  END IF;
END $$;


-- 2. fn_request_create_return — reads return_weight_g per item + computes
--    a prorated line credit.
CREATE OR REPLACE FUNCTION fn_request_create_return(
  p_code               varchar,
  p_shop_id            uuid,
  p_inventory_id       uuid,
  p_source_request_id  uuid,
  p_notes              varchar,
  p_items              jsonb,
  p_user_id            uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id           uuid;
  v_total_items  int := 0;
  v_total_qty    int := 0;
  v_total_amount numeric(12,2) := 0;
  v_item         jsonb;
  v_qty          int;
  v_price        numeric(10,2);
  v_ret_wg       numeric(10,3);
  v_wv           numeric(10,3);
  v_wu           varchar(5);
  v_pack_g       numeric(10,3);
  v_line_credit  numeric(12,2);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Return must include at least one item';
  END IF;

  INSERT INTO stock_requests (
    code, shop_id, inventory_id, status, request_type,
    source_request_id, editable_until, notes,
    created_by, updated_by
  ) VALUES (
    p_code, p_shop_id, p_inventory_id, 'Pending', 'Return',
    p_source_request_id, now() + interval '100 years', p_notes,
    p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty     := (v_item->>'requested_qty')::int;
    v_price   := (v_item->>'unit_price')::numeric(10,2);
    v_ret_wg  := NULLIF(v_item->>'return_weight_g', '')::numeric(10,3);

    SELECT p.weight_value, p.weight_unit
      INTO v_wv, v_wu
    FROM   products p
    WHERE  p.id = (v_item->>'product_id')::uuid;

    IF v_ret_wg IS NOT NULL THEN
      IF v_wu IS NULL OR v_wu NOT IN ('g', 'kg') THEN
        RAISE EXCEPTION 'Partial-weight return only allowed on g/kg SKUs (product % has unit %)',
          (v_item->>'product_id'), COALESCE(v_wu, '<null>');
      END IF;
      v_pack_g := v_wv * CASE v_wu WHEN 'kg' THEN 1000 ELSE 1 END;
      IF v_pack_g <= 0 THEN
        RAISE EXCEPTION 'Product % has invalid pack weight (%)', (v_item->>'product_id'), v_pack_g;
      END IF;
      IF v_ret_wg > v_pack_g * v_qty THEN
        RAISE EXCEPTION 'return_weight_g (%) exceeds available pack weight (% × % = %) for product %',
          v_ret_wg, v_qty, v_pack_g, v_pack_g * v_qty, (v_item->>'product_id');
      END IF;
      v_line_credit := ROUND((v_ret_wg / v_pack_g) * v_price, 2);
    ELSE
      v_line_credit := v_qty * v_price;
    END IF;

    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit, return_weight_g
    )
    SELECT v_id, p.id, v_qty, v_price,
           p.weight_value, p.weight_unit, v_ret_wg
    FROM   products p
    WHERE  p.id = (v_item->>'product_id')::uuid;

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty   + v_qty;
    v_total_amount := v_total_amount + v_line_credit;
  END LOOP;

  UPDATE stock_requests
  SET total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount
  WHERE id = v_id;

  RETURN v_id;
END
$$;


-- 3. fn_request_get — items JSON gains return_weight_g. RETURN shape
--    unchanged (items column is still jsonb). Re-apply the whole
--    phase2_procedures.sql to refresh the fn_request_get body — the
--    source-of-truth definition already carries the projection.

DO $$ BEGIN
  RAISE NOTICE 'phase2_return_partial_weight applied. Re-run DB/phase2/phase2_procedures.sql to refresh fn_request_get with the return_weight_g projection.';
END $$;
