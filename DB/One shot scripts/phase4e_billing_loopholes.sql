-- ============================================================
-- Phase 4e — billing loophole fixes (25-Sep-2026)
-- UPGRADE for an EXISTING database (DEV / UAT / PROD).
-- Fresh deploys don't need this file — the same changes are baked into
-- DB/phase4/*.sql and DB/phase2/phase2_procedures.sql.
-- Needs phase4d_pos_admin_and_fixes.sql applied first.
-- ============================================================
--
-- WHAT CHANGES
--   Schema (this file):
--     • bills.cash_tendered            — cash the customer handed over
--                                        (change-due audit).
--     • held_bill_items                — loose-weight lines can be held
--                                        (qty XOR loose_weight_g).
--     • bill_returns.gross_amount      — MRP value before the bill's
--                                        discount share; total_amount is
--                                        now the discounted refund.
--     • bill_returns.refund_mode       — also allows 'Credit'.
--     • cash_sessions                  — cash_settlements, upi_settlements,
--                                        cancel_upi_back.
--     • app_settings                   — bill_max_discount_percent (20),
--                                        bill_return_window_days (7),
--                                        held_bill_expiry_days (2).
--   Functions (re-run the canonical files listed in STEP 2):
--     • fn_bill_create        — discount cap, shop-scoped customer, exact
--                                loose deduction, cash tendered.
--     • fn_bill_cancel        — own bill + open day only (admin override).
--     • fn_bill_return_create — discount-aware refund, refund mode must be
--                                one paid on the bill, return window,
--                                Credit refunds, Damaged written off.
--     • NEW fn_bill_refund_options, fn_bill_hold_cutoff,
--       fn_customer_set_credit_limit, fn_eod_window_from.
--     • fn_eod_expected / fn_eod_close / fn_eod_list — server-decided
--                                window, udhaar repayments counted.
--     • fn_admin_eod_list     — new columns.
--     • fn_request_accept_return — takes returned goods off shop stock.
--
-- HOW TO RUN (Supabase SQL editor, in this order)
--   STEP 1. This file.
--   STEP 2. Re-run, each in full (all CREATE OR REPLACE / DROP IF EXISTS —
--           safe on a populated DB):
--             DB/phase2/phase2_procedures.sql
--             DB/phase4/phase4_billing_procedures.sql
--             DB/phase4/phase4_eod_procedures.sql
--             DB/phase4/phase4_pos_admin_procedures.sql
--   STEP 3. Deploy the backend, then the front-end (old front-ends keep
--           working against the new backend; the old backend does NOT
--           work against the new functions — deploy both together).
--
-- Idempotent — safe to run more than once.
-- ============================================================

BEGIN;

-- 1. bills.cash_tendered
ALTER TABLE bills ADD COLUMN IF NOT EXISTS cash_tendered numeric(12,2) NULL;
ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bills_cash_tendered_nonneg;
ALTER TABLE bills
  ADD CONSTRAINT chk_bills_cash_tendered_nonneg CHECK (cash_tendered IS NULL OR cash_tendered >= 0);

-- 2. held_bill_items: packet qty XOR loose weight
ALTER TABLE held_bill_items ALTER COLUMN qty DROP NOT NULL;
ALTER TABLE held_bill_items ADD COLUMN IF NOT EXISTS loose_weight_g numeric(10,3) NULL;
ALTER TABLE held_bill_items DROP CONSTRAINT IF EXISTS chk_held_bill_items_qty_pos;
ALTER TABLE held_bill_items DROP CONSTRAINT IF EXISTS chk_held_bill_items_loose_pos;
ALTER TABLE held_bill_items DROP CONSTRAINT IF EXISTS chk_held_bill_items_mode;
ALTER TABLE held_bill_items
  ADD CONSTRAINT chk_held_bill_items_qty_pos   CHECK (qty IS NULL OR qty > 0),
  ADD CONSTRAINT chk_held_bill_items_loose_pos CHECK (loose_weight_g IS NULL OR loose_weight_g > 0),
  ADD CONSTRAINT chk_held_bill_items_mode      CHECK ((qty IS NOT NULL) <> (loose_weight_g IS NOT NULL));

-- 3. bill_returns: gross_amount + Credit refund mode
ALTER TABLE bill_returns ADD COLUMN IF NOT EXISTS gross_amount numeric(12,2) NOT NULL DEFAULT 0;
-- Existing returns were refunded at full MRP, so gross = refunded.
UPDATE bill_returns SET gross_amount = total_amount WHERE gross_amount = 0 AND total_amount > 0;
ALTER TABLE bill_returns DROP CONSTRAINT IF EXISTS chk_bill_returns_refund_mode;
ALTER TABLE bill_returns
  ADD CONSTRAINT chk_bill_returns_refund_mode CHECK (refund_mode IN ('Cash','UPI','Credit'));

-- 4. cash_sessions: settlements + UPI cancel-back
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS cash_settlements numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS upi_settlements  numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS cancel_upi_back  numeric(12,2) NOT NULL DEFAULT 0;

-- 5. Settings (admin-editable in Settings)
INSERT INTO app_settings (key, value, description) VALUES
  ('bill_max_discount_percent', '20',
   'Largest discount a cashier can give on one bill, as % of the bill (0–100). 100 = no limit.'),
  ('bill_return_window_days', '7',
   'Days after a bill during which the shop can take a return. Older bills: admin only.'),
  ('held_bill_expiry_days', '2',
   'Held (parked) bills older than this many days are discarded.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
