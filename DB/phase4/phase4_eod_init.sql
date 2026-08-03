-- ============================================================
-- Phase 4c — End-of-day close-out (denomination count + variance)
-- ============================================================
-- Model: no session-open concept. Cashier clicks "Close day" → snapshot
-- of the tender window (from = last close's closed_at OR today 00:00 IST,
-- to = now). One row per snapshot in `cash_sessions`; per-denomination
-- physical counts live in `cash_denominations` for the audit trail.
--
-- Depends on phase4/phase4_billing_init.sql (bills + bill_payments + bill_returns).

-- ------------------------------------------------------------
-- 1. cash_sessions — one snapshot per EOD close
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_sessions (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  -- IST datetime range these totals cover. window_from = previous session's
  -- closed_at OR the day-start (whichever is later). window_to = closed_at.
  window_from     timestamptz   NOT NULL,
  closed_at       timestamptz   NOT NULL DEFAULT now(),
  closed_by       uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Tender-side totals (Σ over the window, respecting cancellations + refunds).
  cash_sales      numeric(12,2) NOT NULL DEFAULT 0,
  upi_sales       numeric(12,2) NOT NULL DEFAULT 0,
  credit_sales   numeric(12,2) NOT NULL DEFAULT 0,
  cash_refunds    numeric(12,2) NOT NULL DEFAULT 0,
  upi_refunds     numeric(12,2) NOT NULL DEFAULT 0,
  cancel_cash_back numeric(12,2) NOT NULL DEFAULT 0,

  -- Expected cash in till = cash_sales − cash_refunds − cancel_cash_back.
  expected_cash   numeric(12,2) NOT NULL,
  -- Sum of denomination × count from cash_denominations. Cashier's count.
  physical_cash   numeric(12,2) NOT NULL,
  -- physical − expected. Positive = surplus, negative = shortage.
  variance        numeric(12,2) NOT NULL,

  notes           varchar(500),
  is_deleted      boolean       NOT NULL DEFAULT false,

  CONSTRAINT chk_cash_sessions_window
    CHECK (window_from <= closed_at)
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_shop_time
  ON cash_sessions(shop_id, closed_at DESC);

-- ------------------------------------------------------------
-- 2. cash_denominations — per-note physical count for a session
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_denominations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  -- ₹ face value: 500/200/100/50/20/10/5/2/1. int-typed to keep the CHECK
  -- simple; if RBI ever adds a new note we widen this list.
  denomination int  NOT NULL,
  count        int  NOT NULL,
  CONSTRAINT uq_cash_denom_session_denom UNIQUE (session_id, denomination),
  CONSTRAINT chk_cash_denom_value CHECK (denomination IN (500,200,100,50,20,10,5,2,1)),
  CONSTRAINT chk_cash_denom_count CHECK (count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_cash_denom_session ON cash_denominations(session_id);
