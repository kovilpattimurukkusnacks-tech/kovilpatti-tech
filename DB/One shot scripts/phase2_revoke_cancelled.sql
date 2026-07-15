-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Extend revoke to undo Cancel (one-shot upgrade)
-- 01-Jul-2026
--
-- Extends fn_request_revoke to accept `Cancelled` alongside the existing
-- `Approved` and `Rejected` states. Also clears cancelled_at / cancelled_by
-- when reverting a cancelled row back to Pending.
--
-- Client req: shop users sometimes hit Cancel by mistake; admin needs a
-- way to recover without asking the shop to re-submit. Same UX path we
-- built for Undo Rejection — one confirm dialog, back to Pending.
--
-- Safe to re-run. Signature unchanged so no DROP needed.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_request_revoke(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_requests
  SET status           = 'Pending',
      approved_at      = NULL,
      approved_by      = NULL,
      rejection_reason = NULL,
      cancelled_at     = NULL,
      cancelled_by     = NULL,
      updated_by       = p_user_id
  WHERE id = p_id
    AND status IN ('Approved', 'Rejected', 'Cancelled')
    AND is_deleted = false;
  RETURN FOUND;
END
$$;
