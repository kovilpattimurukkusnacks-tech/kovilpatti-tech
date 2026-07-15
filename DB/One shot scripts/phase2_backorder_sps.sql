-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Back-order feature: new SPs (one-shot upgrade)
-- 01-Jul-2026
--
-- Prerequisite: phase2_backorder_schema.sql must be applied first
-- (adds parent_request_id / expected_arrival_at / is_vendor_procured
-- columns and the 'Backorder' enum value that these SPs reference).
--
-- Add-only. Zero existing SPs touched — this script is safe to run at
-- any time after the schema migration; nothing else in the app calls
-- these two new SPs yet (BE / FE deploys land next).
--
-- Contents:
--   1. fn_request_move_to_backorder(p_id, p_item_ids, p_user_id, p_eta)
--        → carves items off a parent Order into a new Backorder sibling.
--   2. fn_request_list_outstanding_backorders(p_inventory_id, p_shop_ids)
--        → pipeline snapshot of Pending Backorders (banners + drilldown).
--
-- Idempotent: both use CREATE OR REPLACE. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_request_move_to_backorder(
  p_id       uuid,
  p_item_ids uuid[],
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
  v_moved_count     int;
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

  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RAISE EXCEPTION 'No items provided';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_item_ids) t(id)
    WHERE t.id NOT IN (SELECT id FROM stock_request_items WHERE request_id = p_id)
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

  UPDATE stock_request_items
  SET    request_id = v_new_id
  WHERE  id = ANY(p_item_ids)
    AND  request_id = p_id;

  GET DIAGNOSTICS v_moved_count = ROW_COUNT;
  IF v_moved_count = 0 THEN
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


CREATE OR REPLACE FUNCTION fn_request_list_outstanding_backorders(
  p_inventory_id uuid   DEFAULT NULL,
  p_shop_ids     uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  code                  varchar,
  parent_id             uuid,
  parent_code           varchar,
  shop_id               uuid,
  shop_code             varchar,
  shop_name             varchar,
  inventory_id          uuid,
  inventory_name        varchar,
  total_items           int,
  total_qty             int,
  total_amount          numeric,
  submitted_at          timestamptz,
  expected_arrival_at   timestamptz,
  days_since_submitted  int
)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.code,
         r.parent_request_id, pr.code AS parent_code,
         r.shop_id, s.code, s.name,
         r.inventory_id, i.name,
         r.total_items, r.total_qty, r.total_amount,
         r.submitted_at,
         r.expected_arrival_at,
         GREATEST(0, (CURRENT_DATE - r.submitted_at::date))::int AS days_since_submitted
  FROM   stock_requests r
  INNER JOIN shops               s   ON s.id  = r.shop_id
  INNER JOIN inventories         i   ON i.id  = r.inventory_id
  LEFT  JOIN stock_requests      pr  ON pr.id = r.parent_request_id
  WHERE  r.is_deleted   = false
    AND  r.request_type = 'Backorder'
    AND  r.status       = 'Pending'
    AND  (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND  (p_shop_ids     IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id = ANY(p_shop_ids))
  ORDER BY r.submitted_at ASC;
$$;
