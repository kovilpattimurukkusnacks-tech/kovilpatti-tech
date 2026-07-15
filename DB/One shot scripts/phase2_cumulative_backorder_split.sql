-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Cumulative print: split total_qty into order/backorder (one-shot)
-- 06-Jul-2026
--
-- What
-- ────
-- fn_request_pending_cumulative now returns two additional columns —
-- order_qty and backorder_qty — so the cumulative-print report can flag
-- any SKU whose qty carries a back-order contribution (amber "BO" pill on
-- the line). total_qty is unchanged (= order_qty + backorder_qty) so the
-- kitchen still packs one number per SKU.
--
-- Client ask: batch plan mixes normal and back-order requests — kitchen
-- needs to know at a glance which lines are special (Back-order) so they
-- can prioritise or route them separately.
--
-- Signature change on fn_request_pending_cumulative (two extra columns in
-- RETURNS TABLE) — the pre-split shape must be dropped before CREATE OR
-- REPLACE. The source file already has the DROP inline.
--
-- Easiest install: re-run DB/phase2/phase2_procedures.sql — every SP there
-- is idempotent CREATE OR REPLACE, and the drop-then-recreate for this
-- function is already inline.
--
--   psql -f DB/phase2/phase2_procedures.sql
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  RAISE NOTICE 'phase2_cumulative_backorder_split — re-run DB/phase2/phase2_procedures.sql to apply.';
END $$;
