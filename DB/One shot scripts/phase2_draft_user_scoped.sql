-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Shop drafts widened to (shop_id, created_by)
-- 08-Jul-2026
--
-- Client redirect: admin can now raise a stock request on behalf of a
-- specific shop (see admin_new_request_screen.md → shipped 08-Jul-2026).
-- The existing draft table enforced one draft per shop, which meant
-- admin's draft would clobber Shop A user's own work-in-progress the
-- moment admin's auto-save fired. Widening the uniqueness key to include
-- the creator lets each user hold their own draft slot per shop.
--
-- Additive change — no data lost. Existing drafts survive; the new
-- uniqueness rule is strictly wider than the old one.
--
-- Run order:
--   1. This one-shot script (schema)
--   2. Re-run DB/phase2/phase2_procedures.sql — SP signatures updated:
--        • fn_request_save_shop_draft: unchanged args, WHERE clause now
--          matches (shop_id, created_by) for the existing-draft lookup.
--        • fn_request_get_shop_draft:  (uuid) → (uuid, uuid) — accepts
--          the caller's user_id so admin + shop user see their own draft.
--        • fn_request_delete_shop_draft: same — signature change.
--        • fn_request_create: draft consume also scoped by (shop_id,
--          created_by) so submit doesn't wipe the OTHER party's draft.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- Drop the old shop-only uniqueness first so the new wider index can
-- be created cleanly. On a fresh DB the DROP is a no-op.
DROP INDEX IF EXISTS uq_stock_requests_one_draft_per_shop;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_requests_one_draft_per_shop_user
  ON stock_requests(shop_id, created_by)
  WHERE status = 'Draft' AND is_deleted = false;

-- Old draft SP signatures dropped so re-running phase2_procedures.sql
-- can install the new (uuid, uuid) shapes without ambiguous overloads.
DROP FUNCTION IF EXISTS fn_request_get_shop_draft(uuid);
DROP FUNCTION IF EXISTS fn_request_delete_shop_draft(uuid);

COMMIT;

DO $$ BEGIN
  RAISE NOTICE 'phase2_draft_user_scoped — schema widened. Re-run phase2_procedures.sql to install the updated draft SPs.';
END $$;
