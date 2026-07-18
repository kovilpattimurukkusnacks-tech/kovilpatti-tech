-- ============================================================
-- phase2_onhold_status_migration_02_schema_procs.sql   (STEP 2 of 2)
--
-- Schema + stored functions for the 'On-Hold' lifecycle state.
--
-- ⚠️ RUN STEP 1 (phase2_onhold_status_migration_01_enum.sql) FIRST and let it
--    commit. This file references the 'On-Hold' enum value (index predicate +
--    fn_request_list_active_specials), which errors if run in the same
--    transaction that added the value.
--
-- Purpose: when an Order contains a special item that will arrive late, the
-- inventory user parks the WHOLE request as 'On-Hold' instead of approving it
-- now. When the stock arrives, inventory approves it directly (On-Hold ->
-- Approved). Held requests can also be un-held (-> Pending), rejected, or
-- cancelled. They are excluded from the cumulative kitchen print (which is
-- Approved-only) but DO appear in the "Special Requests open" banner with an
-- On-Hold status.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Audit columns for the hold action (mirrors approved_at/by, etc.).
ALTER TABLE stock_requests
  ADD COLUMN IF NOT EXISTS on_hold_at timestamptz,
  ADD COLUMN IF NOT EXISTS on_hold_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- 2. Pending | Approved -> On-Hold (inventory user). Orders only.
CREATE OR REPLACE FUNCTION fn_request_hold(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_requests
  SET status     = 'On-Hold',
      on_hold_at = now(),
      on_hold_by = p_user_id,
      updated_by = p_user_id
  WHERE id = p_id
    AND status IN ('Pending', 'Approved')
    AND request_type = 'Order'
    AND is_deleted = false;
  RETURN FOUND;
END
$$;

-- 3. Approve, widened to also accept On-Hold as a from-state. Clears the hold
--    audit fields so an approved request no longer looks held.
CREATE OR REPLACE FUNCTION fn_request_approve(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_requests
  SET status      = 'Approved',
      approved_at = now(),
      approved_by = p_user_id,
      on_hold_at  = NULL,
      on_hold_by  = NULL,
      updated_by  = p_user_id
  WHERE id = p_id
    AND status IN ('Pending', 'On-Hold')
    AND is_deleted = false;
  RETURN FOUND;
END
$$;

-- 4. Reverse transitions OUT of On-Hold (besides Approve): un-hold back to
--    Pending, reject, or cancel a held request. Each SP below is the existing
--    transition with 'On-Hold' added to its from-state guard and the hold
--    audit fields cleared.

-- On-Hold (+ Approved | Rejected | Cancelled) → Pending. Clears hold fields.
CREATE OR REPLACE FUNCTION fn_request_revoke(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_did_revoke boolean;
BEGIN
  UPDATE stock_requests
  SET status           = 'Pending',
      approved_at      = NULL,
      approved_by      = NULL,
      rejection_reason = NULL,
      cancelled_at     = NULL,
      cancelled_by     = NULL,
      on_hold_at       = NULL,
      on_hold_by       = NULL,
      draft_name       = NULL,
      pinned_at        = NULL,
      updated_by       = p_user_id
  WHERE id = p_id
    AND status IN ('Approved', 'Rejected', 'Cancelled', 'On-Hold')
    AND is_deleted = false;
  v_did_revoke := FOUND;

  IF v_did_revoke THEN
    UPDATE stock_request_items
    SET    draft_dispatched_qty = NULL
    WHERE  request_id = p_id
      AND  draft_dispatched_qty IS NOT NULL;
  END IF;

  RETURN v_did_revoke;
END
$$;

-- Pending | On-Hold → Rejected. Reason required.
CREATE OR REPLACE FUNCTION fn_request_reject(
  p_id      uuid,
  p_user_id uuid,
  p_reason  varchar
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  UPDATE stock_requests
  SET status           = 'Rejected',
      rejection_reason = p_reason,
      on_hold_at       = NULL,
      on_hold_by       = NULL,
      updated_by       = p_user_id
  WHERE id = p_id
    AND status IN ('Pending', 'On-Hold')
    AND is_deleted = false;
  RETURN FOUND;
END
$$;

-- Pending | Approved | On-Hold → Cancelled.
CREATE OR REPLACE FUNCTION fn_request_cancel(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_requests
  SET status        = 'Cancelled',
      cancelled_at  = now(),
      cancelled_by  = p_user_id,
      on_hold_at    = NULL,
      on_hold_by    = NULL,
      updated_by    = p_user_id
  WHERE id = p_id
    AND status IN ('Pending', 'Approved', 'On-Hold')
    AND is_deleted = false;
  RETURN FOUND;
END
$$;

-- 5. Active-specials banner feed: include On-Hold so a held special still
--    shows in the "Special Requests open" banner (with its On-Hold status),
--    since it's the one most needing follow-up. The partial index predicate
--    changes, so it must be dropped and recreated (CREATE IF NOT EXISTS
--    won't alter an existing index's WHERE clause).
DROP INDEX IF EXISTS idx_stock_requests_active_specials;
CREATE INDEX IF NOT EXISTS idx_stock_requests_active_specials
  ON stock_requests(status, shop_id)
  WHERE is_special = true AND is_deleted = false
    AND status IN ('Pending','Approved','Dispatched','On-Hold');

CREATE OR REPLACE FUNCTION fn_request_list_active_specials(
  p_shop_id      uuid  DEFAULT NULL,
  p_inventory_id uuid  DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  code                  varchar,
  special_label         varchar,
  shop_id               uuid,
  shop_code             varchar,
  shop_name             varchar,
  inventory_id          uuid,
  inventory_name        varchar,
  status                varchar,
  total_items           int,
  total_qty             int,
  total_amount          numeric,
  submitted_at          timestamptz,
  days_since_submitted  int
)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.code, r.special_label,
         r.shop_id, s.code, s.name,
         r.inventory_id, i.name,
         r.status::varchar,
         r.total_items, r.total_qty, r.total_amount,
         r.submitted_at,
         GREATEST(0, (CURRENT_DATE - r.submitted_at::date))::int AS days_since_submitted
  FROM   stock_requests r
  INNER JOIN shops       s ON s.id = r.shop_id
  INNER JOIN inventories i ON i.id = r.inventory_id
  WHERE  r.is_deleted = false
    AND  r.is_special = true
    AND  r.status IN ('Pending', 'Approved', 'Dispatched', 'On-Hold')
    AND  (p_shop_id      IS NULL OR r.shop_id      = p_shop_id)
    AND  (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
  ORDER BY r.submitted_at ASC;
$$;
