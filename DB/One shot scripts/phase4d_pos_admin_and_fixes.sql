-- ============================================================
-- Phase 4d — POS admin screens + billing money fixes (25-Sep-2026)
-- UPGRADE for an EXISTING database (DEV / UAT / PROD).
-- Fresh deploys don't need this file — the same changes are baked into
-- DB/phase4/*.sql.
-- ============================================================
--
-- WHAT CHANGES
--   Schema (this file):
--     • customer_credit_ledger.entry_type now also allows 'Reversal'
--       (written when a credit bill is cancelled).
--     • New indexes for admin all-shop date-range reads.
--   Functions (re-run the canonical files listed in STEP 2):
--     • fn_bill_create        — single-tender bills take the server total
--                                (fixes loose-weight "Payments must equal the
--                                bill total" rejections).
--     • fn_bill_cancel        — blocked once a return exists; reverses the
--                                credit portion of credit bills.
--     • fn_bill_return_create — rejects loose-weight lines.
--     • fn_eod_expected       — cancelled bills created in the window now
--                                count as sales too (issue+cancel nets to 0).
--     • NEW fn_admin_* readers + fn_shop_inventory_import_opening.
--
-- HOW TO RUN (Supabase SQL editor, in this order)
--   STEP 1. This file.
--   STEP 2. Re-run, each in full (all CREATE OR REPLACE / DROP IF EXISTS —
--           safe on a populated DB):
--             DB/phase4/phase4_billing_procedures.sql
--             DB/phase4/phase4_eod_procedures.sql
--             DB/phase4/phase4_pos_admin_procedures.sql   (new)
--   STEP 3. Deploy the backend, then the front-end.
--
-- Idempotent — safe to run more than once.
-- ============================================================

BEGIN;

-- 1. Allow the 'Reversal' ledger entry type.
ALTER TABLE customer_credit_ledger DROP CONSTRAINT IF EXISTS chk_ccl_entry_type;
ALTER TABLE customer_credit_ledger
  ADD CONSTRAINT chk_ccl_entry_type CHECK (entry_type IN ('Credit','Settlement','Reversal'));

-- 2. Indexes for admin reads (all shops, filtered by date only).
CREATE INDEX IF NOT EXISTS idx_bills_created_at        ON bills(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_customer          ON bills(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bill_returns_created_at ON bill_returns(created_at DESC);

COMMIT;


-- ============================================================
-- VERIFY (after STEP 2)
-- ------------------------------------------------------------
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM   pg_constraint WHERE conname = 'chk_ccl_entry_type';
--     → CHECK (... 'Credit', 'Settlement', 'Reversal' ...)
--
--   SELECT proname FROM pg_proc
--   WHERE  proname LIKE 'fn_admin_%' OR proname = 'fn_shop_inventory_import_opening'
--   ORDER  BY 1;
--     → 13 rows
--
--   SELECT * FROM fn_admin_sales_summary(NULL, current_date - 7, current_date);
-- ============================================================
