-- ============================================================
-- Phase 4c — EOD close-out (procedures)
-- ============================================================

-- Compute expected cash + tender breakdown for a shop over [p_from, p_to).
-- p_to is exclusive. Values are always non-negative — refunds/cancellations
-- are separate columns, so the FE can spell out the derivation.
--
-- Rules (Phase 4c v1; fixed 25-Sep-2026):
--   cash_sales       = Σ bill_payments.amount over bills CREATED in window,
--                      whatever their status now (Issued or Cancelled). A
--                      bill issued and cancelled inside the same window then
--                      nets to zero (+sale here, −cancel_cash_back below).
--   upi_sales        = same, UPI mode.
--   credit_sales     = same, Credit mode (informational — no cash impact).
--   cash_refunds     = Σ bill_returns.total_amount where refund_mode='Cash'
--                      AND return's created_at in window.
--   upi_refunds      = same, UPI mode. (Credit-mode returns reduce the
--                      customer's balance — no money moves.)
--   cancel_cash_back = Σ Cash tenders of bills CANCELLED in window.
--   cancel_upi_back  = same, UPI (informational — money back via UPI).
--   cash_settlements = udhaar repaid in cash in window (was missing: the
--                      cash sat in the drawer but not in "expected", so the
--                      close showed a surplus anyone could pocket).
--   upi_settlements  = same, UPI (informational).
--   expected_cash    = cash_sales + cash_settlements − cash_refunds
--                      − cancel_cash_back.
DROP FUNCTION IF EXISTS fn_eod_expected(uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION fn_eod_expected(
  p_shop_id uuid,
  p_from    timestamptz,
  p_to      timestamptz
)
RETURNS TABLE (
  cash_sales       numeric,
  upi_sales        numeric,
  credit_sales     numeric,
  cash_refunds     numeric,
  upi_refunds      numeric,
  cancel_cash_back numeric,
  cancel_upi_back  numeric,
  cash_settlements numeric,
  upi_settlements  numeric,
  expected_cash    numeric,
  bill_count       bigint,
  return_count     bigint,
  cancel_count     bigint
)
LANGUAGE sql STABLE AS $$
  WITH
  sales AS (
    SELECT
      COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'Cash'),   0)::numeric(12,2) AS cash_sales,
      COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'UPI'),    0)::numeric(12,2) AS upi_sales,
      COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'Credit'), 0)::numeric(12,2) AS credit_sales,
      COUNT(DISTINCT b.id)::bigint AS bill_count
    FROM bills b
    JOIN bill_payments bp ON bp.bill_id = b.id
    WHERE b.shop_id = p_shop_id
      AND b.is_deleted = false
      AND b.status IN ('Issued', 'Cancelled')
      AND b.created_at >= p_from AND b.created_at < p_to
  ),
  refunds AS (
    SELECT
      COALESCE(SUM(br.total_amount) FILTER (WHERE br.refund_mode = 'Cash'), 0)::numeric(12,2) AS cash_refunds,
      COALESCE(SUM(br.total_amount) FILTER (WHERE br.refund_mode = 'UPI'),  0)::numeric(12,2) AS upi_refunds,
      COUNT(*)::bigint AS return_count
    FROM bill_returns br
    JOIN bills b ON b.id = br.source_bill_id
    WHERE b.shop_id = p_shop_id
      AND br.is_deleted = false
      AND br.created_at >= p_from AND br.created_at < p_to
  ),
  cancels AS (
    SELECT
      COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'Cash'), 0)::numeric(12,2) AS cancel_cash_back,
      COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'UPI'),  0)::numeric(12,2) AS cancel_upi_back,
      COUNT(DISTINCT b.id)::bigint AS cancel_count
    FROM bills b
    JOIN bill_payments bp ON bp.bill_id = b.id
    WHERE b.shop_id = p_shop_id
      AND b.is_deleted = false
      AND b.status = 'Cancelled'
      AND b.cancelled_at IS NOT NULL
      AND b.cancelled_at >= p_from AND b.cancelled_at < p_to
  ),
  settle AS (
    SELECT
      COALESCE(SUM(l.amount) FILTER (WHERE l.mode = 'Cash'), 0)::numeric(12,2) AS cash_settlements,
      COALESCE(SUM(l.amount) FILTER (WHERE l.mode = 'UPI'),  0)::numeric(12,2) AS upi_settlements
    FROM customer_credit_ledger l
    JOIN customers c ON c.id = l.customer_id
    WHERE c.shop_id = p_shop_id
      AND l.entry_type = 'Settlement'
      AND l.created_at >= p_from AND l.created_at < p_to
  )
  SELECT
    s.cash_sales, s.upi_sales, s.credit_sales,
    r.cash_refunds, r.upi_refunds,
    c.cancel_cash_back, c.cancel_upi_back,
    st.cash_settlements, st.upi_settlements,
    (s.cash_sales + st.cash_settlements - r.cash_refunds - c.cancel_cash_back)::numeric(12,2) AS expected_cash,
    s.bill_count, r.return_count, c.cancel_count
  FROM sales s CROSS JOIN refunds r CROSS JOIN cancels c CROSS JOIN settle st;
$$;

-- Timestamp of the most recent EOD close for a shop (or NULL if none).
CREATE OR REPLACE FUNCTION fn_eod_last_close(p_shop_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT MAX(closed_at) FROM cash_sessions
  WHERE shop_id = p_shop_id AND is_deleted = false;
$$;

-- 25-Sep-2026: where the NEXT close window starts — decided by the server,
-- never the cashier. Back-to-back from the previous close, so no sale /
-- return / repayment can fall into a gap or be counted twice. A shop's very
-- first close starts at today's IST midnight (earlier, never-closed days
-- would otherwise all pile into the first count).
CREATE OR REPLACE FUNCTION fn_eod_window_from(p_shop_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    fn_eod_last_close(p_shop_id),
    date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata');
$$;

-- Record an EOD close. 25-Sep-2026: the window is decided HERE —
-- [fn_eod_window_from, clock_timestamp()) — so a cashier can't skip sales with a late
-- "from", overlap two closes or double-count. A per-shop advisory lock
-- serialises concurrent closes. Denominations arrive as a jsonb array of
-- {"denomination": int, "count": int}. Returns the new session id.
DROP FUNCTION IF EXISTS fn_eod_close(uuid, uuid, timestamptz, timestamptz, jsonb, varchar);
DROP FUNCTION IF EXISTS fn_eod_close(uuid, uuid, jsonb, varchar);
CREATE OR REPLACE FUNCTION fn_eod_close(
  p_shop_id       uuid,
  p_user_id       uuid,
  p_denominations jsonb,
  p_notes         varchar DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_session_id     uuid;
  v_exp            record;
  v_denom          record;
  v_physical       numeric(12,2) := 0;
  v_from           timestamptz;
  v_to             timestamptz := clock_timestamp();
BEGIN
  IF p_denominations IS NULL OR jsonb_typeof(p_denominations) <> 'array' THEN
    RAISE EXCEPTION 'Denominations must be a jsonb array.';
  END IF;

  -- One close at a time per shop.
  PERFORM pg_advisory_xact_lock(hashtext('eod:' || p_shop_id::text));

  v_from := fn_eod_window_from(p_shop_id);
  IF v_from >= v_to THEN
    RAISE EXCEPTION 'The day was just closed — nothing new to close yet.';
  END IF;

  SELECT * INTO v_exp FROM fn_eod_expected(p_shop_id, v_from, v_to);

  FOR v_denom IN SELECT (x->>'denomination')::int AS denom, (x->>'count')::int AS cnt
                 FROM jsonb_array_elements(p_denominations) x LOOP
    IF v_denom.denom NOT IN (500,200,100,50,20,10,5,2,1) THEN
      RAISE EXCEPTION 'Invalid denomination: %', v_denom.denom;
    END IF;
    IF v_denom.cnt < 0 THEN
      RAISE EXCEPTION 'Denomination count cannot be negative.';
    END IF;
    v_physical := v_physical + (v_denom.denom * v_denom.cnt);
  END LOOP;

  INSERT INTO cash_sessions (
    shop_id, window_from, closed_at, closed_by,
    cash_sales, upi_sales, credit_sales,
    cash_refunds, upi_refunds, cancel_cash_back,
    cancel_upi_back, cash_settlements, upi_settlements,
    expected_cash, physical_cash, variance, notes
  ) VALUES (
    p_shop_id, v_from, v_to, p_user_id,
    v_exp.cash_sales, v_exp.upi_sales, v_exp.credit_sales,
    v_exp.cash_refunds, v_exp.upi_refunds, v_exp.cancel_cash_back,
    v_exp.cancel_upi_back, v_exp.cash_settlements, v_exp.upi_settlements,
    v_exp.expected_cash, v_physical, v_physical - v_exp.expected_cash,
    NULLIF(btrim(p_notes), '')
  ) RETURNING id INTO v_session_id;

  FOR v_denom IN SELECT (x->>'denomination')::int AS denom, (x->>'count')::int AS cnt
                 FROM jsonb_array_elements(p_denominations) x LOOP
    INSERT INTO cash_denominations (session_id, denomination, count)
    VALUES (v_session_id, v_denom.denom, v_denom.cnt)
    ON CONFLICT (session_id, denomination) DO UPDATE SET count = EXCLUDED.count;
  END LOOP;

  RETURN v_session_id;
END;
$$;

-- Recent EOD closures — for a "Previous close-outs" list on the FE.
DROP FUNCTION IF EXISTS fn_eod_list(uuid, int);
CREATE OR REPLACE FUNCTION fn_eod_list(
  p_shop_id uuid,
  p_limit   int DEFAULT 10
)
RETURNS TABLE (
  id               uuid,
  window_from      timestamptz,
  closed_at        timestamptz,
  closed_by_name   varchar,
  cash_sales       numeric,
  upi_sales        numeric,
  credit_sales     numeric,
  cash_refunds     numeric,
  upi_refunds      numeric,
  cancel_cash_back numeric,
  cancel_upi_back  numeric,
  cash_settlements numeric,
  upi_settlements  numeric,
  expected_cash    numeric,
  physical_cash    numeric,
  variance         numeric,
  notes            varchar
)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.window_from, s.closed_at, u.full_name,
         s.cash_sales, s.upi_sales, s.credit_sales,
         s.cash_refunds, s.upi_refunds, s.cancel_cash_back,
         s.cancel_upi_back, s.cash_settlements, s.upi_settlements,
         s.expected_cash, s.physical_cash, s.variance, s.notes
  FROM cash_sessions s
  LEFT JOIN users u ON u.id = s.closed_by
  WHERE s.shop_id = p_shop_id AND s.is_deleted = false
  ORDER BY s.closed_at DESC
  LIMIT p_limit;
$$;
