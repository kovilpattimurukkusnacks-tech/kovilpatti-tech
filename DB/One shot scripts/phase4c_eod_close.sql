-- ============================================================
-- Phase 4c — EOD close-out (upgrade-only)
-- ------------------------------------------------------------
-- Adds cash_sessions + cash_denominations + 4 SPs. Depends on Phase 4
-- billing (bills, bill_payments, bill_returns).
--
-- Author: Ramji J G   —   2026-08-01
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='bills') THEN
    RAISE EXCEPTION 'phase4c_eod requires bills (Phase 4). Run phase4/phase4_billing_init.sql first.';
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS cash_sessions (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  window_from     timestamptz   NOT NULL,
  closed_at       timestamptz   NOT NULL DEFAULT now(),
  closed_by       uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cash_sales      numeric(12,2) NOT NULL DEFAULT 0,
  upi_sales       numeric(12,2) NOT NULL DEFAULT 0,
  credit_sales    numeric(12,2) NOT NULL DEFAULT 0,
  cash_refunds    numeric(12,2) NOT NULL DEFAULT 0,
  upi_refunds     numeric(12,2) NOT NULL DEFAULT 0,
  cancel_cash_back numeric(12,2) NOT NULL DEFAULT 0,
  expected_cash   numeric(12,2) NOT NULL,
  physical_cash   numeric(12,2) NOT NULL,
  variance        numeric(12,2) NOT NULL,
  notes           varchar(500),
  is_deleted      boolean       NOT NULL DEFAULT false
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_sessions_window') THEN
    ALTER TABLE cash_sessions ADD CONSTRAINT chk_cash_sessions_window
      CHECK (window_from <= closed_at);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_cash_sessions_shop_time
  ON cash_sessions(shop_id, closed_at DESC);

CREATE TABLE IF NOT EXISTS cash_denominations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  denomination int  NOT NULL,
  count        int  NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_cash_denom_session_denom') THEN
    ALTER TABLE cash_denominations ADD CONSTRAINT uq_cash_denom_session_denom
      UNIQUE (session_id, denomination);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_denom_value') THEN
    ALTER TABLE cash_denominations ADD CONSTRAINT chk_cash_denom_value
      CHECK (denomination IN (500,200,100,50,20,10,5,2,1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_denom_count') THEN
    ALTER TABLE cash_denominations ADD CONSTRAINT chk_cash_denom_count
      CHECK (count >= 0);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_cash_denom_session ON cash_denominations(session_id);

COMMIT;

-- SPs live in phase4/phase4_eod_procedures.sql. Run that file next.
-- ============================================================
