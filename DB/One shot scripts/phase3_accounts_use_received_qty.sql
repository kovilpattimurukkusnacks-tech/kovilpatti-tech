-- ─────────────────────────────────────────────────────────────────────────
-- Phase 3 — Accounts tally on received_qty (one-shot)
-- 03-Jul-2026
--
-- Prerequisite: phase2_receive_with_discrepancy.sql (adds received_qty
-- column). Without that column, these SPs error on undefined reference.
--
-- What
-- ────
-- Every Order-side money aggregate in the accounts SPs now reads
--   COALESCE(it.received_qty, it.dispatched_qty, it.requested_qty)
-- instead of the previous
--   COALESCE(it.dispatched_qty, it.requested_qty).
--
-- Effect: when a shop declares a receipt discrepancy at confirm-receipt
-- (e.g. dispatched 10, received 8), the accounts ledger books 8 × MRP
-- for that line — not 10. No admin qty-edit round-trip needed.
--
-- Return path (`request_type = 'Return'`) is UNCHANGED — received_qty
-- doesn't apply to Returns (dispatched_qty there is overloaded as the
-- godown's accepted qty per the Phase 2 convention).
--
-- Idempotent: all CREATE OR REPLACE; RETURNS shapes unchanged. Re-run safe.
--
-- Simplest way to install: re-apply DB/phase3/phase3_procedures.sql —
-- the source-of-truth definitions already reflect this change and every
-- SP in that file is idempotent CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  RAISE NOTICE 'phase3_accounts_use_received_qty — re-run DB/phase3/phase3_procedures.sql to install.';
END $$;
