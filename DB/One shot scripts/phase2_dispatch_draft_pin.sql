-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Dispatch Draft Pin (one-shot upgrade)
-- 30-Jun-2026
--
-- Adds a "pin" flag to godown dispatch drafts so the dispatcher can mark
-- a few drafts as "work on these next" and have them sort to the top of
-- the resume strip regardless of recency.
--
-- Safe to re-run: ALTER TABLE uses IF NOT EXISTS, all SP rewrites use
-- CREATE OR REPLACE. The fn_request_list_inventory_dispatch_drafts SP
-- needs a DROP first because its RETURNS TABLE signature changes.
--
-- Changes in this script (matches the in-place edits to phase2_init.sql +
-- phase2_procedures.sql so a fresh-DB build from those files reaches the
-- same state):
--   1. ALTER stock_requests ADD COLUMN pinned_at timestamptz
--   2. fn_request_list_inventory_dispatch_drafts — return pinned_at in
--      the projection + sort pinned drafts first (signature change → DROP + CREATE)
--   3. fn_request_pin_dispatch_draft — NEW SP (set / clear the pin flag)
--   4. fn_request_clear_dispatch_draft — NULL pinned_at on discard
--   5. fn_request_dispatch — NULL pinned_at on finalise
--
-- See DB/planned/draft_naming.md for the related draft-naming feature.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE stock_requests
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;


-- 2) Drop the old list SP signature (RETURNS TABLE shape changed).
DROP FUNCTION IF EXISTS fn_request_list_inventory_dispatch_drafts(uuid);

CREATE OR REPLACE FUNCTION fn_request_list_inventory_dispatch_drafts(
  p_inventory_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  code                  varchar,
  shop_id               uuid,
  shop_code             varchar,
  shop_name             varchar,
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
  draft_name              varchar,
  pinned_at               timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.code,
         r.shop_id, s.code, s.name,
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
         r.draft_name,
         r.pinned_at
  FROM stock_requests r
  INNER JOIN shops       s    ON s.id    = r.shop_id
  INNER JOIN inventories i    ON i.id    = r.inventory_id
  LEFT  JOIN users       u    ON u.id    = r.created_by
  LEFT  JOIN users       ua   ON ua.id   = r.approved_by
  LEFT  JOIN users       ud   ON ud.id   = r.dispatched_by
  LEFT  JOIN users       urcv ON urcv.id = r.received_by
  LEFT  JOIN users       uac  ON uac.id  = r.accepted_by
  LEFT  JOIN stock_requests src ON src.id = r.source_request_id
  WHERE r.is_deleted = false
    AND r.status IN ('Pending', 'Approved')
    AND EXISTS (
      SELECT 1 FROM stock_request_items it
      WHERE it.request_id = r.id AND it.draft_dispatched_qty IS NOT NULL
    )
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
  ORDER BY r.pinned_at DESC NULLS LAST, r.updated_at DESC;
$$;


-- 3) New SP — set / clear the pin flag.
CREATE OR REPLACE FUNCTION fn_request_pin_dispatch_draft(
  p_id      uuid,
  p_user_id uuid,
  p_pinned  boolean
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id AND status IN ('Pending', 'Approved') AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  UPDATE stock_requests
  SET pinned_at  = CASE WHEN p_pinned THEN now() ELSE NULL END,
      updated_by = p_user_id
  WHERE id = p_id;

  RETURN true;
END
$$;


-- 4) Discard: also drop the pin flag (paired lifecycle — see SP comment).
CREATE OR REPLACE FUNCTION fn_request_clear_dispatch_draft(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id AND status IN ('Pending', 'Approved') AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  UPDATE stock_request_items
  SET draft_dispatched_qty = NULL
  WHERE request_id = p_id;

  UPDATE stock_requests
  SET draft_name = NULL,
      pinned_at  = NULL,
      updated_by = p_user_id
  WHERE id = p_id;

  RETURN true;
END
$$;


-- 5) Finalising dispatch also clears the pin flag.
CREATE OR REPLACE FUNCTION fn_request_dispatch(
  p_id                uuid,
  p_user_id           uuid,
  p_dispatched_items  jsonb
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_item jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id AND status IN ('Pending', 'Approved') AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  IF p_dispatched_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_dispatched_items) LOOP
      UPDATE stock_request_items
      SET dispatched_qty = (v_item->>'dispatched_qty')::int
      WHERE id = (v_item->>'id')::uuid
        AND request_id = p_id;
    END LOOP;
  END IF;

  UPDATE stock_request_items
  SET draft_dispatched_qty = NULL
  WHERE request_id = p_id;

  UPDATE stock_requests
  SET status        = 'Dispatched',
      draft_name    = NULL,
      pinned_at     = NULL,
      dispatched_at = now(),
      dispatched_by = p_user_id,
      updated_by    = p_user_id
  WHERE id = p_id;

  RETURN true;
END
$$;
