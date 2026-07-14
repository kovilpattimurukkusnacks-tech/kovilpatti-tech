-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Confirm-receipt with per-item discrepancy (one-shot)
-- 02-Jul-2026
--
-- What
-- ────
--   1. Adds stock_request_items.received_qty (nullable int).
--   2. Adds chk_received_qty_bounds so values ≥ 0.
--   3. Rewrites fn_request_receive to accept an optional items JSON
--      (`[{id, received_qty}, …]`) so the shop can record a partial
--      receipt at confirm time. NULL / empty items → same one-click
--      behaviour as before (received_qty stays NULL on every line).
--   4. Extends fn_request_get's items JSON aggregate to include
--      received_qty so shop/admin detail pages can render the discrepancy.
--
-- Why
-- ───
-- Shop physically counts what landed before confirming. Sometimes 10
-- dispatched → 8 received; the missing 2 need a paper trail without
-- forcing the shop into a Return flow. Damaged units still use Return;
-- shortage (or over-count) rides on this new column.
--
-- Backward compat
-- ───────────────
-- • Column is nullable + default NULL → every existing row backfills safely.
-- • fn_request_receive signature CHANGES (added p_items). BE + FE ship in
--   the same commit; drop the pre-3-arg overload here so PG can install
--   the new one cleanly.
-- • fn_request_get RETURNS shape is unchanged — items JSON is text/jsonb
--   and gains one extra key. Callers ignoring the new key stay working.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Column + guard
ALTER TABLE stock_request_items
  ADD COLUMN IF NOT EXISTS received_qty int;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_received_qty_bounds'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_received_qty_bounds
      CHECK (received_qty IS NULL OR received_qty >= 0);
  END IF;
END $$;


-- 2. fn_request_receive — signature change (added p_items).
DROP FUNCTION IF EXISTS fn_request_receive(uuid, uuid);
DROP FUNCTION IF EXISTS fn_request_receive(uuid, uuid, jsonb);

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
  END IF;

  RETURN v_flipped;
END
$$;


-- 3. fn_request_get — items JSON now carries received_qty.
--    RETURN shape unchanged (items column is jsonb → same type), so
--    CREATE OR REPLACE without DROP is enough here.
--    Re-apply DB/phase2/phase2_procedures.sql after this script if you
--    want the source-of-truth fn_request_get body identical to what
--    the new-installs get. This one-shot only rewrites the SPs this
--    change touches; unrelated SPs stay as-is.

-- The safest way to install the updated fn_request_get is to just
-- re-run the whole phase2_procedures.sql (idempotent — every SP is
-- CREATE OR REPLACE with matching RETURN shapes).
--
-- Manual patch left out on purpose: fn_request_get is a big function,
-- duplicating it here would rot vs. source. Deploy step:
--
--   psql -f DB/phase2/phase2_procedures.sql
--
-- (Or apply just the fn_request_get + fn_request_receive definitions
--  from that file — both are idempotent CREATE OR REPLACE blocks.)

DO $$ BEGIN
  RAISE NOTICE 'phase2_receive_with_discrepancy applied. Re-run DB/phase2/phase2_procedures.sql to refresh fn_request_get with the received_qty projection.';
END $$;
