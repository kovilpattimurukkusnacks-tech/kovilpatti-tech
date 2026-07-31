-- ============================================================
-- Kovilpatti Snacks — Phase 4b · SPLIT PAYMENT · MIGRATION
--
-- Feature #5 from DB/planned/phase4_billing_full_scope.md. A bill can
-- now be settled with multiple tenders (e.g. ₹200 Cash + ₹300 UPI).
--
--   • new table bill_payments (bill_id, mode, amount) — one row per tender
--   • existing bills back-filled with a single payment row from their
--     current payment_mode + total_amount
--   • bills.payment_mode kept as a DENORMALISED summary label: the single
--     tender's mode, or 'Split' when a bill has more than one tender.
--     (Credit is added later by the credit-sales feature.)
--   • fn_bill_create now takes p_payments jsonb instead of a single mode;
--     it validates that the tenders sum to the computed bill total.
--
-- Idempotent one-shot. Baked into DB/phase4/phase4_billing_init.sql +
-- phase4_billing_procedures.sql for fresh deploys.
--
-- Run AFTER phase4_billing_init.sql + phase4_billing_procedures.sql.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. bill_payments — one row per tender on a bill.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_payments (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id     uuid          NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  mode        varchar(10)   NOT NULL,
  amount      numeric(12,2) NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_bill_payments_mode       CHECK (mode IN ('Cash','UPI')),
  CONSTRAINT chk_bill_payments_amount_pos CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);

-- ------------------------------------------------------------
-- 2. Back-fill: every existing bill gets a single tender row equal to
--    its total_amount, in its recorded payment_mode. Skip bills that
--    already have payment rows (re-run safe). total_amount = 0 bills
--    (edge) get no row — nothing was tendered.
-- ------------------------------------------------------------
INSERT INTO bill_payments (bill_id, mode, amount, created_at)
SELECT b.id, b.payment_mode, b.total_amount, b.created_at
FROM   bills b
WHERE  b.total_amount > 0
  AND  b.payment_mode IN ('Cash','UPI')
  AND  NOT EXISTS (SELECT 1 FROM bill_payments bp WHERE bp.bill_id = b.id);

-- ------------------------------------------------------------
-- 3. Widen the header payment_mode CHECK to allow the 'Split' summary.
-- ------------------------------------------------------------
ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bills_payment_mode;
ALTER TABLE bills ADD  CONSTRAINT chk_bills_payment_mode
  CHECK (payment_mode IN ('Cash','UPI','Split'));

COMMIT;


-- ============================================================
-- PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- 4. fn_bill_create — now takes p_payments (jsonb array of
--    {"mode": "Cash"|"UPI", "amount": numeric}). The tenders must sum
--    to the computed bill total. Header payment_mode is the single
--    tender's mode, or 'Split' for more than one.
--
--    Drop the v1 single-mode signature so the old overload can't linger.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_create(uuid, uuid, varchar, jsonb, varchar);

CREATE OR REPLACE FUNCTION fn_bill_create(
  p_shop_id       uuid,
  p_user_id       uuid,
  p_payments      jsonb,
  p_items         jsonb,
  p_notes         varchar DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  code         varchar,
  total_items  int,
  total_qty    int,
  total_amount numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_bill_id       uuid;
  v_code          varchar(20);
  v_line          record;
  v_pay           record;
  v_product       record;
  v_total_items   int := 0;
  v_total_qty     int := 0;
  v_total_amount  numeric(12,2) := 0;
  v_pay_count     int;
  v_pay_sum       numeric(12,2) := 0;
  v_summary_mode  varchar(10);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item.';
  END IF;

  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'Bill must have at least one payment.';
  END IF;

  v_pay_count := jsonb_array_length(p_payments);

  -- Validate each tender up front.
  FOR v_pay IN
    SELECT (x->>'mode')::varchar   AS mode,
           (x->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_payments) x
  LOOP
    IF v_pay.mode NOT IN ('Cash','UPI') THEN
      RAISE EXCEPTION 'Invalid payment mode "%": must be Cash or UPI.', v_pay.mode;
    END IF;
    IF v_pay.amount IS NULL OR v_pay.amount <= 0 THEN
      RAISE EXCEPTION 'Each payment amount must be greater than zero.';
    END IF;
    v_pay_sum := v_pay_sum + v_pay.amount;
  END LOOP;

  -- Duplicate-product guard before any insert.
  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice on the bill — adjust the quantity on one line instead.';
  END IF;

  v_summary_mode := CASE
    WHEN v_pay_count = 1 THEN (p_payments->0->>'mode')
    ELSE 'Split'
  END;

  INSERT INTO bills (shop_id, payment_mode, notes, created_by)
  VALUES (p_shop_id, v_summary_mode, p_notes, p_user_id)
  RETURNING bills.id, bills.code INTO v_bill_id, v_code;

  FOR v_line IN
    SELECT (x->>'productId')::uuid AS product_id,
           (x->>'qty')::int        AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be a positive whole number.';
    END IF;

    SELECT p.id, p.name, p.mrp
    INTO v_product
    FROM products p
    WHERE p.id = v_line.product_id
      AND p.is_deleted = false
      AND p.active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found or inactive.', v_line.product_id;
    END IF;

    INSERT INTO bill_items (bill_id, product_id, qty, unit_price)
    VALUES (v_bill_id, v_product.id, v_line.qty, v_product.mrp);

    PERFORM fn_shop_inventory_sale(
      p_shop_id, v_product.id, v_line.qty, v_bill_id,
      'Bill ' || v_code, p_user_id
    );

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty + v_line.qty;
    v_total_amount := v_total_amount + (v_line.qty * v_product.mrp);
  END LOOP;

  -- Tenders must settle the bill exactly (no over/under-tender stored;
  -- the UI computes cash change for display only).
  IF v_pay_sum <> v_total_amount THEN
    RAISE EXCEPTION 'Payments (%) must equal the bill total (%).', v_pay_sum, v_total_amount;
  END IF;

  FOR v_pay IN
    SELECT (x->>'mode')::varchar   AS mode,
           (x->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_payments) x
  LOOP
    INSERT INTO bill_payments (bill_id, mode, amount)
    VALUES (v_bill_id, v_pay.mode, v_pay.amount);
  END LOOP;

  UPDATE bills b
  SET total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount,
      updated_by   = p_user_id
  WHERE b.id = v_bill_id;

  RETURN QUERY
  SELECT b.id, b.code, b.total_items, b.total_qty, b.total_amount
  FROM bills b WHERE b.id = v_bill_id;
END;
$$;


-- ------------------------------------------------------------
-- 5. fn_bill_get_payments — tender breakdown for a bill (detail view).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_get_payments(
  p_bill_id  uuid
)
RETURNS TABLE (
  id      uuid,
  mode    varchar,
  amount  numeric
)
LANGUAGE sql STABLE AS $$
  SELECT bp.id, bp.mode, bp.amount
  FROM   bill_payments bp
  WHERE  bp.bill_id = p_bill_id
  ORDER  BY bp.created_at;
$$;


-- ============================================================
-- VERIFY
--   SELECT tablename FROM pg_tables WHERE tablename = 'bill_payments';
--   SELECT bill_id, mode, amount FROM bill_payments LIMIT 5;
--   SELECT conname FROM pg_constraint WHERE conname = 'chk_bills_payment_mode';
-- ============================================================
