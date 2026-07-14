-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Adjustment Qty column on request lists (one-shot)
-- 03-Jul-2026
--
-- Prerequisite: phase2_receive_with_discrepancy.sql (adds received_qty column).
--
-- What
-- ────
-- Extends both fn_request_get + fn_request_list_paged to project
-- total_adjustment_qty — the signed sum of (received_qty − dispatched_qty)
-- across items where the shop reported a receipt value. Semantics:
--   • NULL → no items reported discrepancy (list row default)
--   • 0    → reported but +/− across lines nets to zero
--   • > 0  → over-received
--   • < 0  → short-received
--
-- Powers the "Adjustment Qty" column on shop / inventory / admin request
-- list tables + surfaces the same aggregate on the detail page for
-- consistency.
--
-- Signature change on fn_request_list_paged (extra column in RETURNS
-- TABLE) — drop the pre-adjust shape first before CREATE OR REPLACE.
--
-- Easiest install: re-run DB/phase2/phase2_procedures.sql — the source
-- file already has both projections + DROPs, and every SP there is
-- idempotent CREATE OR REPLACE.
--
--   psql -f DB/phase2/phase2_procedures.sql
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  RAISE NOTICE 'phase2_adjustment_qty_column — re-run DB/phase2/phase2_procedures.sql to apply.';
END $$;
