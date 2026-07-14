-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Move-to-back-order per-line qty split (one-shot)
-- 02-Jul-2026
--
-- Rewrites fn_request_move_to_backorder to accept a per-item qty so the
-- godown can carve off only PART of a line (e.g. shop wants 7, godown has
-- 4, moves 3 to back-order). Previous signature moved whole rows only.
--
-- Signature change: uuid[] → jsonb.  DROP the old shape first because
-- CREATE OR REPLACE FUNCTION can't alter the argument list.
--
-- Payload: [{ "id": "<uuid>", "qty": <int> }, …]
--   • qty >= parent line's requested_qty → full move (row reparented)
--   • qty <  parent line's requested_qty → split (parent row reduced,
--                                          new row created on child)
--   • qty <= 0 or missing                → RAISE EXCEPTION
--
-- Backward compat: NO existing caller stays working — every code path
-- must pass jsonb now. The BE + FE ship in the same commit as this SQL.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS fn_request_move_to_backorder(uuid, uuid[], uuid, timestamptz);
DROP FUNCTION IF EXISTS fn_request_move_to_backorder(uuid, jsonb, uuid, timestamptz);

CREATE OR REPLACE FUNCTION fn_request_move_to_backorder(
  p_id       uuid,
  p_items    jsonb,
  p_user_id  uuid,
  p_eta      timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_parent          stock_requests%ROWTYPE;
  v_existing_count  int;
  v_new_code        varchar(20);
  v_new_id          uuid;
  v_moved_any       boolean := false;
  v_row             record;
  v_item            record;
BEGIN
  SELECT * INTO v_parent
  FROM   stock_requests
  WHERE  id = p_id AND is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent request % not found', p_id;
  END IF;

  IF v_parent.request_type <> 'Order' THEN
    RAISE EXCEPTION 'Only Orders can be carved into back-orders (got %)', v_parent.request_type;
  END IF;

  IF v_parent.status NOT IN ('Pending', 'Approved') THEN
    RAISE EXCEPTION 'Cannot move items to back-order — parent status is % (must be Pending or Approved)', v_parent.status;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No items provided';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM   jsonb_array_elements(p_items) e
    WHERE  (e->>'id')::uuid NOT IN (
      SELECT id FROM stock_request_items WHERE request_id = p_id
    )
  ) THEN
    RAISE EXCEPTION 'One or more item ids do not belong to parent request %', p_id;
  END IF;

  SELECT COUNT(*)::int INTO v_existing_count
  FROM   stock_requests
  WHERE  parent_request_id = p_id;

  v_new_code := v_parent.code || '-B' || CASE WHEN v_existing_count = 0 THEN '' ELSE (v_existing_count + 1)::text END;

  INSERT INTO stock_requests (
    code, shop_id, inventory_id, status, request_type,
    editable_until, notes,
    parent_request_id, expected_arrival_at,
    created_by, updated_by
  ) VALUES (
    v_new_code,
    v_parent.shop_id, v_parent.inventory_id,
    'Pending', 'Backorder',
    now() + interval '100 years',
    v_parent.notes,
    p_id, p_eta,
    p_user_id, p_user_id
  ) RETURNING id INTO v_new_id;

  FOR v_item IN
    SELECT (e->>'id')::uuid  AS item_id,
           (e->>'qty')::int  AS move_qty
    FROM   jsonb_array_elements(p_items) e
  LOOP
    IF v_item.move_qty IS NULL OR v_item.move_qty <= 0 THEN
      RAISE EXCEPTION 'Move qty must be positive (item %, got %)', v_item.item_id, v_item.move_qty;
    END IF;

    SELECT * INTO v_row
    FROM   stock_request_items
    WHERE  id = v_item.item_id AND request_id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_item.move_qty >= v_row.requested_qty THEN
      UPDATE stock_request_items
      SET    request_id = v_new_id
      WHERE  id = v_row.id;
    ELSE
      -- subtotal is a GENERATED column (requested_qty × unit_price), so
      -- we don't set it — Postgres recomputes on both writes.
      UPDATE stock_request_items
      SET    requested_qty = v_row.requested_qty - v_item.move_qty
      WHERE  id = v_row.id;

      INSERT INTO stock_request_items (
        request_id, product_id, requested_qty, unit_price,
        weight_value, weight_unit, added_by
      ) VALUES (
        v_new_id, v_row.product_id, v_item.move_qty, v_row.unit_price,
        v_row.weight_value, v_row.weight_unit, v_row.added_by
      );
    END IF;

    v_moved_any := true;
  END LOOP;

  IF NOT v_moved_any THEN
    DELETE FROM stock_requests WHERE id = v_new_id;
    RAISE EXCEPTION 'No items moved (possibly a concurrent update reassigned them)';
  END IF;

  UPDATE stock_requests r
  SET    total_items  = (SELECT COUNT(*)::int         FROM stock_request_items WHERE request_id = r.id),
         total_qty    = (SELECT COALESCE(SUM(requested_qty),0)::int FROM stock_request_items WHERE request_id = r.id),
         total_amount = (SELECT COALESCE(SUM(subtotal),0)::numeric(12,2) FROM stock_request_items WHERE request_id = r.id),
         updated_by   = p_user_id
  WHERE  r.id IN (p_id, v_new_id);

  RETURN v_new_id;
END
$$;
