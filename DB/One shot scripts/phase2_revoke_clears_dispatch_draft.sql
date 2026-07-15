-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Revoke clears dispatch draft (one-shot)
-- 02-Jul-2026
--
-- fn_request_revoke now:
--   • Clears draft_name + pinned_at on the header (draft label + pin were
--     Approved-state artefacts; meaningless on a Pending row).
--   • Clears draft_dispatched_qty on every item on the affected request.
--
-- Rationale: the FE auto-fills draft_dispatched_qty = requested_qty on
-- Approve so the godown can one-click dispatch. If the admin later
-- REVOKES the approval, the request goes back to Pending — but the
-- persisted draft qtys stay, which causes the "Draft" chip + pre-filled
-- dispatch inputs to survive. That contradicts the "back to Pending"
-- semantic. This SP fix ensures a revoke fully resets the dispatch
-- state, matching the header's status flip.
--
-- Same signature; `CREATE OR REPLACE` alone is enough (no DROP needed).
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

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
      draft_name       = NULL,
      pinned_at        = NULL,
      updated_by       = p_user_id
  WHERE id = p_id
    AND status IN ('Approved', 'Rejected', 'Cancelled')
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
