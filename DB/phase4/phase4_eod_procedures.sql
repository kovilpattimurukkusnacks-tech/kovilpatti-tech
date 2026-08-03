-- ============================================================
-- Phase 4c — EOD close-out (procedures)
-- ============================================================

-- Compute expected cash + tender breakdown for a shop over [p_from, p_to).
-- p_to is exclusive. Values are always non-negative — refunds/cancellations
-- are separate columns, so the FE can spell out the derivation.
--
-- Rules (Phase 4c v1):
--   cash_sales      = Σ bill_payments.amount over Issued bills in window.
--   upi_sales       = same, UPI mode.
--   credit_sales    = same, Credit mode (informational — no cash impact).
--   cash_refunds    = Σ bill_returns.total_amount where refund_mode='Cash'
--                     AND return's created_at in window.
--   upi_refunds     = same, UPI mode.
--   cancel_cash_back = Σ bill_payments.amount (Cash) for bills whose
--                     status='Cancelled' AND cancelled_at in window
--                     (assumes cash was refunded to the customer on cancel).
--   expected_cash   = cash_sales − cash_refunds − cancel_cash_back.
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
      AND b.status = 'Issued'
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
      COUNT(DISTINCT b.id)::bigint AS cancel_count
    FROM bills b
    JOIN bill_payments bp ON bp.bill_id = b.id
    WHERE b.shop_id = p_shop_id
      AND b.is_deleted = false
      AND b.status = 'Cancelled'
      AND b.cancelled_at IS NOT NULL
      AND b.cancelled_at >= p_from AND b.cancelled_at < p_to
  )
  SELECT
    s.cash_sales, s.upi_sales, s.credit_sales,
    r.cash_refunds, r.upi_refunds,
    c.cancel_cash_back,
    (s.cash_sales - r.cash_refunds - c.cancel_cash_back)::numeric(12,2) AS expected_cash,
    s.bill_count, r.return_count, c.cancel_count
  FROM sales s CROSS JOIN refunds r CROSS JOIN cancels c;
$$;

-- Timestamp of the most recent EOD close for a shop (or NULL if none).
-- The FE uses this to default `window_from` on the next close: if the last
-- close was at 8pm and it's now 9pm, the new snapshot covers just that hour.
CREATE OR REPLACE FUNCTION fn_eod_last_close(p_shop_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT MAX(closed_at) FROM cash_sessions
  WHERE shop_id = p_shop_id AND is_deleted = false;
$$;

-- Record an EOD close. Denominations arrive as a jsonb array of
-- {"denomination": int, "count": int}. Expected totals are re-computed
-- server-side (never trusted from the client) so no one can hide a
-- variance by lying about the "expected" number. Returns the new session id.
DROP FUNCTION IF EXISTS fn_eod_close(uuid, uuid, timestamptz, timestamptz, jsonb, varchar);
CREATE OR REPLACE FUNCTION fn_eod_close(
  p_shop_id       uuid,
  p_user_id       uuid,
  p_window_from   timestamptz,
  p_window_to     timestamptz,
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
BEGIN
  IF p_window_from >= p_window_to THEN
    RAISE EXCEPTION 'Close window must span forward in time.';
  END IF;
  IF p_denominations IS NULL OR jsonb_typeof(p_denominations) <> 'array' THEN
    RAISE EXCEPTION 'Denominations must be a jsonb array.';
  END IF;

  -- Re-compute the tender totals server-side.
  SELECT * INTO v_exp FROM fn_eod_expected(p_shop_id, p_window_from, p_window_to);

  -- Sum the physical count.
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
    expected_cash, physical_cash, variance, notes
  ) VALUES (
    p_shop_id, p_window_from, p_window_to, p_user_id,
    v_exp.cash_sales, v_exp.upi_sales, v_exp.credit_sales,
    v_exp.cash_refunds, v_exp.upi_refunds, v_exp.cancel_cash_back,
    v_exp.expected_cash, v_physical, v_physical - v_exp.expected_cash,
    NULLIF(btrim(p_notes), '')
  ) RETURNING id INTO v_session_id;

  -- Insert every denomination row (including zero-count for a complete audit).
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
  expected_cash    numeric,
  physical_cash    numeric,
  variance         numeric,
  notes            varchar
)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.window_from, s.closed_at, u.full_name,
         s.cash_sales, s.upi_sales, s.credit_sales,
         s.cash_refunds, s.upi_refunds, s.cancel_cash_back,
         s.expected_cash, s.physical_cash, s.variance, s.notes
  FROM cash_sessions s
  LEFT JOIN users u ON u.id = s.closed_by
  WHERE s.shop_id = p_shop_id AND s.is_deleted = false
  ORDER BY s.closed_at DESC
  LIMIT p_limit;
$$;
