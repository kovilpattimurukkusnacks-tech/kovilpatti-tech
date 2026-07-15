-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Confirm-receipt audit trail (one-shot)
-- 03-Jul-2026
--
-- Prerequisite: phase2_receive_with_discrepancy.sql (adds received_qty
-- column + earlier fn_request_receive rewrite).
--
-- What
-- ────
-- fn_request_receive now also writes rows to stock_request_qty_audits
-- for every item where the shop-declared received_qty differs from
-- dispatched_qty. Same table that captures admin's post-completion
-- pencil-icon edits — so the accounts screen's Adjustments Log surfaces
-- receipt discrepancies alongside admin corrections in one unified list.
--
-- Audit row shape:
--   • request_item_id / request_id → item + request
--   • old_qty  = dispatched_qty    (what the godown sent)
--   • new_qty  = received_qty      (what the shop counted)
--   • reason   = "Shop confirm-receipt short: dispatched N, received M"
--                (or "over" / bare "Shop confirm-receipt" if equal)
--   • edited_by = shop user id
--   • edited_at = now() (defaults)
--
-- The DB constraint chk_qty_audit_change (old_qty IS DISTINCT FROM new_qty)
-- means matching lines never insert — the SP body's DISTINCT-FROM guard
-- filters those out first anyway.
--
-- No FE / BE changes required. The Adjustments Log SP already selects
-- reason + edited_by_name and renders them verbatim.
--
-- Idempotent: CREATE OR REPLACE. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- Backfill audit rows for receipts that were confirmed BEFORE this SP
-- change (03-Jul-2026). Without this, existing discrepancies stay
-- invisible in the Adjustments Log until the shop confirms a new
-- receipt. Idempotent — the NOT EXISTS guard skips lines that already
-- have a matching audit row so re-running doesn't duplicate.
INSERT INTO stock_request_qty_audits (
  request_item_id, request_id, old_qty, new_qty, reason, edited_by, edited_at
)
SELECT it.id,
       r.id,
       it.dispatched_qty,
       it.received_qty,
       CASE
         WHEN it.received_qty < COALESCE(it.dispatched_qty, 0) THEN
           'Shop confirm-receipt short: dispatched '
           || COALESCE(it.dispatched_qty, 0) || ', received ' || it.received_qty
         WHEN it.received_qty > COALESCE(it.dispatched_qty, 0) THEN
           'Shop confirm-receipt over: dispatched '
           || COALESCE(it.dispatched_qty, 0) || ', received ' || it.received_qty
         ELSE
           'Shop confirm-receipt'
       END,
       COALESCE(r.received_by, r.updated_by, r.created_by),
       COALESCE(r.received_at, now())
FROM   stock_request_items it
JOIN   stock_requests r ON r.id = it.request_id
WHERE  it.received_qty IS NOT NULL
  AND  it.received_qty IS DISTINCT FROM it.dispatched_qty
  AND  r.status = 'Received'
  AND  r.is_deleted = false
  AND  NOT EXISTS (
        SELECT 1 FROM stock_request_qty_audits a
        WHERE a.request_item_id = it.id
          AND a.old_qty IS NOT DISTINCT FROM it.dispatched_qty
          AND a.new_qty IS NOT DISTINCT FROM it.received_qty
          AND a.reason LIKE 'Shop confirm-receipt%'
      );


CREATE OR REPLACE FUNCTION fn_request_receive(
  p_id      uuid,
  p_user_id uuid,
  p_items   jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_flipped boolean;
BEGIN
  UPDATE stock_requests
  SET status      = 'Received',
      received_at = now(),
      received_by = p_user_id,
      updated_by  = p_user_id
  WHERE id = p_id
    AND status = 'Dispatched'
    AND is_deleted = false;
  v_flipped := FOUND;

  IF v_flipped AND p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    UPDATE stock_request_items it
    SET    received_qty = (e.value->>'received_qty')::int
    FROM   jsonb_array_elements(p_items) AS e(value)
    WHERE  it.id = (e.value->>'id')::uuid
      AND  it.request_id = p_id
      AND  (e.value->>'received_qty') IS NOT NULL;

    INSERT INTO stock_request_qty_audits (
      request_item_id, request_id, old_qty, new_qty, reason, edited_by
    )
    SELECT it.id,
           p_id,
           it.dispatched_qty,
           it.received_qty,
           CASE
             WHEN it.received_qty < COALESCE(it.dispatched_qty, 0) THEN
               'Shop confirm-receipt short: dispatched '
               || COALESCE(it.dispatched_qty, 0) || ', received ' || it.received_qty
             WHEN it.received_qty > COALESCE(it.dispatched_qty, 0) THEN
               'Shop confirm-receipt over: dispatched '
               || COALESCE(it.dispatched_qty, 0) || ', received ' || it.received_qty
             ELSE
               'Shop confirm-receipt'
           END,
           p_user_id
    FROM   stock_request_items it
    JOIN   jsonb_array_elements(p_items) AS e(value)
           ON it.id = (e.value->>'id')::uuid
    WHERE  it.request_id = p_id
      AND  (e.value->>'received_qty') IS NOT NULL
      AND  it.received_qty IS DISTINCT FROM it.dispatched_qty;
  END IF;

  RETURN v_flipped;
END
$$;
