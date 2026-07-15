-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Inventory can append items to an approved request (one-shot)
-- 01-Jul-2026
--
-- Client req: last-minute customer bumps qty just before dispatch. Rather
-- than revoke → phone shop → shop re-edits → re-approve, let the godown
-- add the extra items directly. Rows added this way are tagged
-- added_by = 'Inventory' so downstream views can badge them "(inv)".
--
-- Changes:
--   1. ALTER stock_request_items ADD COLUMN added_by (default 'Shop',
--      CHECK enum). Backfills every legacy row to 'Shop'.
--   2. fn_request_get — items JSON aggregate now includes added_by so the
--      FE detail pages can read the tag.
--   3. fn_request_inventory_add_items — NEW SP. Appends items with
--      added_by='Inventory' and refreshes header totals.
--   4. fn_request_inventory_remove_item — NEW SP. Removes ONLY inv-added
--      items (shop items protected).
--
-- Safe to re-run. ADD COLUMN uses IF NOT EXISTS; SPs are CREATE OR REPLACE.
-- fn_request_get body reused wholesale because CREATE OR REPLACE FUNCTION
-- requires the full body when we change the SELECT list.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE stock_request_items
  ADD COLUMN IF NOT EXISTS added_by varchar(10) NOT NULL DEFAULT 'Shop';

-- Add the CHECK constraint separately so re-runs don't error on duplicate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_stock_request_items_added_by'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_stock_request_items_added_by
      CHECK (added_by IN ('Shop', 'Inventory'));
  END IF;
END $$;


-- fn_request_get — extend the items JSONB aggregate with added_by. We
-- CREATE OR REPLACE the whole function; body copied from phase2_procedures.sql
-- with only the 'added_by' key added to the jsonb_build_object.
CREATE OR REPLACE FUNCTION fn_request_get(p_id uuid)
RETURNS TABLE (
  id                    uuid,
  code                  varchar,
  shop_id               uuid,
  shop_code             varchar,
  shop_name             varchar,
  shop_contact_phone    varchar,
  inventory_id          uuid,
  inventory_code        varchar,
  inventory_name        varchar,
  submitted_by_name       varchar,
  approved_by_name        varchar,
  dispatched_by_name      varchar,
  received_by_name        varchar,
  accepted_by_name        varchar,
  status                  varchar,
  request_type            varchar,
  total_items             int,
  total_qty               int,
  total_dispatched_qty    int,
  total_amount            numeric,
  total_dispatched_amount numeric,
  notes                   varchar,
  rejection_reason        varchar,
  editable_until          timestamptz,
  submitted_at            timestamptz,
  updated_at              timestamptz,
  approved_at             timestamptz,
  approved_by             uuid,
  dispatched_at           timestamptz,
  dispatched_by           uuid,
  received_at             timestamptz,
  accepted_at             timestamptz,
  accepted_by             uuid,
  cancelled_at            timestamptz,
  cancelled_by            uuid,
  source_request_id       uuid,
  source_request_code     varchar,
  items                   jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.code,
         r.shop_id, s.code, s.name, s.contact_phone_1,
         r.inventory_id, i.code, i.name,
         u.full_name    AS submitted_by_name,
         ua.full_name   AS approved_by_name,
         ud.full_name   AS dispatched_by_name,
         urcv.full_name AS received_by_name,
         uac.full_name  AS accepted_by_name,
         r.status::varchar       AS status,
         r.request_type::varchar AS request_type,
         r.total_items, r.total_qty,
         (SELECT SUM(it.dispatched_qty)::int
          FROM stock_request_items it
          WHERE it.request_id = r.id) AS total_dispatched_qty,
         r.total_amount,
         (SELECT SUM(it.dispatched_qty * it.unit_price)::numeric(12,2)
          FROM stock_request_items it
          WHERE it.request_id = r.id) AS total_dispatched_amount,
         r.notes, r.rejection_reason, r.editable_until,
         r.submitted_at, r.updated_at,
         r.approved_at, r.approved_by,
         r.dispatched_at, r.dispatched_by, r.received_at,
         r.accepted_at, r.accepted_by,
         r.cancelled_at, r.cancelled_by,
         r.source_request_id,
         src.code AS source_request_code,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_object(
               'id',             it.id,
               'product_id',     it.product_id,
               'product_code',   p.code,
               'product_name',   p.name,
               'category_name',  c.name,
               'weight_value',   it.weight_value,
               'weight_unit',    it.weight_unit,
               'requested_qty',  it.requested_qty,
               'dispatched_qty', it.dispatched_qty,
               'draft_dispatched_qty', it.draft_dispatched_qty,
               'unit_price',     it.unit_price,
               'subtotal',       it.subtotal,
               'added_by',       it.added_by
             ) ORDER BY c.name, p.code
           )
           FROM stock_request_items it
           INNER JOIN products   p ON p.id = it.product_id
           INNER JOIN categories c ON c.id = p.category_id
           WHERE it.request_id = r.id
         ), '[]'::jsonb) AS items
  FROM stock_requests r
  INNER JOIN shops       s    ON s.id    = r.shop_id
  INNER JOIN inventories i    ON i.id    = r.inventory_id
  LEFT  JOIN users       u    ON u.id    = r.created_by
  LEFT  JOIN users       ua   ON ua.id   = r.approved_by
  LEFT  JOIN users       ud   ON ud.id   = r.dispatched_by
  LEFT  JOIN users       urcv ON urcv.id = r.received_by
  LEFT  JOIN users       uac  ON uac.id  = r.accepted_by
  LEFT  JOIN stock_requests src ON src.id = r.source_request_id
  WHERE r.id = p_id AND r.is_deleted = false;
$$;


-- Inventory appends items to a Pending/Approved request.
CREATE OR REPLACE FUNCTION fn_request_inventory_add_items(
  p_id      uuid,
  p_user_id uuid,
  p_items   jsonb
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_item    jsonb;
  v_pid     uuid;
  v_qty     int;
  v_price   numeric(10,2);
  v_wv      numeric(10,3);
  v_wu      varchar(5);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id
      AND status IN ('Pending', 'Approved')
      AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN true;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'requested_qty')::int;

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'requested_qty must be positive (got %)', v_qty;
    END IF;

    SELECT mrp, weight_value, weight_unit
    INTO v_price, v_wv, v_wu
    FROM products
    WHERE id = v_pid AND is_deleted = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product not found: %', v_pid;
    END IF;

    IF EXISTS (
      SELECT 1 FROM stock_request_items
      WHERE request_id = p_id AND product_id = v_pid
    ) THEN
      RAISE EXCEPTION 'duplicate_product: % is already in this request', v_pid
        USING ERRCODE = 'unique_violation';
    END IF;

    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit, added_by
    ) VALUES (
      p_id, v_pid, v_qty, v_price, v_wv, v_wu, 'Inventory'
    );
  END LOOP;

  UPDATE stock_requests r
  SET total_items = (SELECT COUNT(*)::int FROM stock_request_items WHERE request_id = r.id),
      total_qty   = (SELECT COALESCE(SUM(requested_qty), 0)::int FROM stock_request_items WHERE request_id = r.id),
      total_amount = (SELECT COALESCE(SUM(subtotal), 0)::numeric(12,2) FROM stock_request_items WHERE request_id = r.id),
      updated_by  = p_user_id
  WHERE id = p_id;

  RETURN true;
END
$$;


-- fn_request_update — patched to preserve inv-added items during a shop
-- edit. Only shop-added rows are deleted before re-insert; inv rows
-- stay, and header aggregates fold them back in. Body is copied from
-- phase2_procedures.sql with only the two blocks changed. CREATE OR
-- REPLACE keeps the same signature so callers don't break.
CREATE OR REPLACE FUNCTION fn_request_update(
  p_id      uuid,
  p_notes   varchar,
  p_items   jsonb,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_total_items  int := 0;
  v_total_qty    int := 0;
  v_total_amount numeric(12,2) := 0;
  v_item         jsonb;
  v_qty          int;
  v_price        numeric(10,2);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id AND status IN ('Pending', 'Approved') AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Stock request must include at least one item';
  END IF;

  DELETE FROM stock_request_items
  WHERE request_id = p_id AND added_by = 'Shop';

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty   := (v_item->>'requested_qty')::int;
    v_price := (v_item->>'unit_price')::numeric(10,2);

    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit
    )
    SELECT p_id, p.id, v_qty, v_price, p.weight_value, p.weight_unit
    FROM   products p
    WHERE  p.id = (v_item->>'product_id')::uuid;

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty   + v_qty;
    v_total_amount := v_total_amount + (v_qty * v_price);
  END LOOP;

  -- Fold in preserved inv-added items.
  SELECT
    v_total_items  + COALESCE(COUNT(*), 0)::int,
    v_total_qty    + COALESCE(SUM(requested_qty), 0)::int,
    v_total_amount + COALESCE(SUM(subtotal), 0)::numeric(12,2)
  INTO v_total_items, v_total_qty, v_total_amount
  FROM stock_request_items
  WHERE request_id = p_id AND added_by = 'Inventory';

  UPDATE stock_requests
  SET notes        = p_notes,
      total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount,
      updated_by   = p_user_id
  WHERE id = p_id;

  RETURN true;
END
$$;


-- Inventory removes an inv-added item they appended by mistake.
CREATE OR REPLACE FUNCTION fn_request_inventory_remove_item(
  p_id       uuid,
  p_item_id  uuid,
  p_user_id  uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id
      AND status IN ('Pending', 'Approved')
      AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM stock_request_items
  WHERE id         = p_item_id
    AND request_id = p_id
    AND added_by   = 'Inventory';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE stock_requests r
  SET total_items = (SELECT COUNT(*)::int FROM stock_request_items WHERE request_id = r.id),
      total_qty   = (SELECT COALESCE(SUM(requested_qty), 0)::int FROM stock_request_items WHERE request_id = r.id),
      total_amount = (SELECT COALESCE(SUM(subtotal), 0)::numeric(12,2) FROM stock_request_items WHERE request_id = r.id),
      updated_by  = p_user_id
  WHERE id = p_id;

  RETURN true;
END
$$;
