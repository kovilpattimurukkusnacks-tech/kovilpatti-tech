-- ============================================================
-- Phase 4c — Bill-level discount (upgrade-only)
-- ------------------------------------------------------------
-- Adds 4 columns + 4 CHECK constraints to `bills`, and replaces
-- fn_bill_create / fn_bill_get / fn_bill_list with the discount-aware
-- signatures. Line-level pricing (`bill_items.unit_price`, `line_total`)
-- is untouched — the discount is applied only at the bill header.
--
-- Baseline lives in DB/phase4/phase4_billing_init.sql + phase4_billing_procedures.sql.
--
-- Author: Ramji J G   —   2026-08-01
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Columns on bills
-- ------------------------------------------------------------
ALTER TABLE bills ADD COLUMN IF NOT EXISTS subtotal        numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS discount_kind   varchar(10)   NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS discount_value  numeric(10,2) NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;

-- Backfill existing rows: subtotal = total_amount (no discount was ever applied).
UPDATE bills SET subtotal = total_amount WHERE subtotal = 0 AND total_amount > 0;

-- ------------------------------------------------------------
-- 2. CHECK constraints — idempotent
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bills_discount_kind') THEN
    ALTER TABLE bills ADD CONSTRAINT chk_bills_discount_kind
      CHECK (discount_kind IS NULL OR discount_kind IN ('Percent','Amount'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bills_discount_pair') THEN
    ALTER TABLE bills ADD CONSTRAINT chk_bills_discount_pair
      CHECK ((discount_kind IS NULL AND discount_value IS NULL AND discount_amount = 0)
             OR (discount_kind IS NOT NULL AND discount_value IS NOT NULL AND discount_amount >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bills_discount_percent_range') THEN
    ALTER TABLE bills ADD CONSTRAINT chk_bills_discount_percent_range
      CHECK (discount_kind <> 'Percent' OR (discount_value >= 0 AND discount_value <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bills_subtotal_nonneg') THEN
    ALTER TABLE bills ADD CONSTRAINT chk_bills_subtotal_nonneg
      CHECK (subtotal >= 0 AND discount_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bills_total_math') THEN
    ALTER TABLE bills ADD CONSTRAINT chk_bills_total_math
      CHECK (total_amount = subtotal - discount_amount);
  END IF;
END$$;

-- ------------------------------------------------------------
-- 3. fn_bill_create — new params + wider RETURNS TABLE
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_create(uuid, uuid, uuid, jsonb, jsonb, varchar);
DROP FUNCTION IF EXISTS fn_bill_create(uuid, uuid, uuid, jsonb, jsonb, varchar, varchar, numeric);

CREATE OR REPLACE FUNCTION fn_bill_create(
  p_shop_id        uuid,
  p_user_id        uuid,
  p_customer_id    uuid,
  p_payments       jsonb,
  p_items          jsonb,
  p_notes          varchar DEFAULT NULL,
  p_discount_kind  varchar DEFAULT NULL,
  p_discount_value numeric DEFAULT NULL
)
RETURNS TABLE (
  id              uuid,
  code            varchar,
  total_items     int,
  total_qty       int,
  subtotal        numeric,
  discount_amount numeric,
  total_amount    numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_bill_id         uuid;
  v_code            varchar(20);
  v_line            record;
  v_pay             record;
  v_product         record;
  v_total_items     int := 0;
  v_total_qty       int := 0;
  v_subtotal        numeric(12,2) := 0;
  v_discount_amount numeric(12,2) := 0;
  v_total_amount    numeric(12,2) := 0;
  v_pay_count       int;
  v_pay_sum         numeric(12,2) := 0;
  v_credit_sum      numeric(12,2) := 0;
  v_summary_mode    varchar(10);
  v_cust            record;
BEGIN
  IF (p_discount_kind IS NULL) <> (p_discount_value IS NULL) THEN
    RAISE EXCEPTION 'Discount kind and value must both be set or both be NULL.';
  END IF;
  IF p_discount_kind IS NOT NULL AND p_discount_kind NOT IN ('Percent','Amount') THEN
    RAISE EXCEPTION 'Discount kind must be Percent or Amount.';
  END IF;
  IF p_discount_kind = 'Percent' AND (p_discount_value < 0 OR p_discount_value > 100) THEN
    RAISE EXCEPTION 'Percent discount must be between 0 and 100.';
  END IF;
  IF p_discount_kind = 'Amount' AND p_discount_value < 0 THEN
    RAISE EXCEPTION 'Amount discount cannot be negative.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item.';
  END IF;
  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'Bill must have at least one payment.';
  END IF;

  v_pay_count := jsonb_array_length(p_payments);
  FOR v_pay IN SELECT (x->>'mode')::varchar AS mode, (x->>'amount')::numeric AS amount
               FROM jsonb_array_elements(p_payments) x LOOP
    IF v_pay.mode NOT IN ('Cash','UPI','Credit') THEN
      RAISE EXCEPTION 'Invalid payment mode "%".', v_pay.mode;
    END IF;
    IF v_pay.amount IS NULL OR v_pay.amount <= 0 THEN
      RAISE EXCEPTION 'Each payment amount must be greater than zero.';
    END IF;
    v_pay_sum := v_pay_sum + v_pay.amount;
    IF v_pay.mode = 'Credit' THEN v_credit_sum := v_credit_sum + v_pay.amount; END IF;
  END LOOP;

  IF v_credit_sum > 0 THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'A customer is required for a credit sale.';
    END IF;
    SELECT c.id, c.credit_limit, c.credit_balance INTO v_cust
    FROM customers c WHERE c.id = p_customer_id AND c.shop_id = p_shop_id AND c.is_deleted = false
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found.'; END IF;
    IF v_cust.credit_limit > 0 AND (v_cust.credit_balance + v_credit_sum) > v_cust.credit_limit THEN
      RAISE EXCEPTION 'Credit limit exceeded: balance % + % is over the limit of %.',
        v_cust.credit_balance, v_credit_sum, v_cust.credit_limit;
    END IF;
  END IF;

  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice on the bill — adjust the quantity on one line instead.';
  END IF;

  v_summary_mode := CASE WHEN v_pay_count = 1 THEN (p_payments->0->>'mode') ELSE 'Split' END;

  INSERT INTO bills (shop_id, customer_id, payment_mode, notes, created_by)
  VALUES (p_shop_id, p_customer_id, v_summary_mode, p_notes, p_user_id)
  RETURNING bills.id, bills.code INTO v_bill_id, v_code;

  FOR v_line IN SELECT (x->>'productId')::uuid AS product_id, (x->>'qty')::int AS qty
                FROM jsonb_array_elements(p_items) x LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be a positive whole number.';
    END IF;
    SELECT p.id, p.name, p.mrp INTO v_product FROM products p
    WHERE p.id = v_line.product_id AND p.is_deleted = false AND p.active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product % not found or inactive.', v_line.product_id; END IF;

    INSERT INTO bill_items (bill_id, product_id, qty, unit_price)
    VALUES (v_bill_id, v_product.id, v_line.qty, v_product.mrp);

    PERFORM fn_shop_inventory_sale(
      p_shop_id, v_product.id, v_line.qty, v_bill_id, 'Bill ' || v_code, p_user_id);

    v_total_items := v_total_items + 1;
    v_total_qty   := v_total_qty + v_line.qty;
    v_subtotal    := v_subtotal + (v_line.qty * v_product.mrp);
  END LOOP;

  IF p_discount_kind = 'Percent' THEN
    v_discount_amount := ROUND(v_subtotal * p_discount_value / 100, 2);
  ELSIF p_discount_kind = 'Amount' THEN
    v_discount_amount := LEAST(p_discount_value, v_subtotal);
  END IF;
  v_total_amount := v_subtotal - v_discount_amount;

  IF v_pay_sum <> v_total_amount THEN
    RAISE EXCEPTION 'Payments (%) must equal the bill total (%).', v_pay_sum, v_total_amount;
  END IF;

  FOR v_pay IN SELECT (x->>'mode')::varchar AS mode, (x->>'amount')::numeric AS amount
               FROM jsonb_array_elements(p_payments) x LOOP
    INSERT INTO bill_payments (bill_id, mode, amount) VALUES (v_bill_id, v_pay.mode, v_pay.amount);
  END LOOP;

  IF v_credit_sum > 0 THEN
    UPDATE customers SET credit_balance = credit_balance + v_credit_sum, updated_by = p_user_id
    WHERE id = p_customer_id;
    INSERT INTO customer_credit_ledger (customer_id, bill_id, entry_type, amount, balance_after, created_by)
    VALUES (p_customer_id, v_bill_id, 'Credit', v_credit_sum,
            (SELECT credit_balance FROM customers WHERE id = p_customer_id), p_user_id);
  END IF;

  UPDATE bills b
  SET total_items     = v_total_items,
      total_qty       = v_total_qty,
      subtotal        = v_subtotal,
      discount_kind   = p_discount_kind,
      discount_value  = p_discount_value,
      discount_amount = v_discount_amount,
      total_amount    = v_total_amount,
      updated_by      = p_user_id
  WHERE b.id = v_bill_id;

  RETURN QUERY
  SELECT b.id, b.code, b.total_items, b.total_qty, b.subtotal, b.discount_amount, b.total_amount
  FROM bills b WHERE b.id = v_bill_id;
END;
$$;

-- ------------------------------------------------------------
-- 4. fn_bill_list + fn_bill_get — new discount columns in the return shape
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_list(uuid, varchar, varchar, date, date, int, int);
CREATE OR REPLACE FUNCTION fn_bill_list(
  p_shop_id    uuid,
  p_search     varchar DEFAULT NULL,
  p_status     varchar DEFAULT NULL,
  p_from       date    DEFAULT NULL,
  p_to         date    DEFAULT NULL,
  p_page       int     DEFAULT 1,
  p_page_size  int     DEFAULT 10
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  status             varchar,
  payment_mode       varchar,
  total_items        int,
  total_qty          int,
  subtotal           numeric,
  discount_amount    numeric,
  total_amount       numeric,
  created_at         timestamptz,
  created_by_name    varchar,
  cancelled_at       timestamptz,
  cancel_reason_type varchar,
  cancel_reason      varchar,
  total_count        bigint
)
LANGUAGE sql STABLE AS $$
  SELECT b.id, b.code, b.status, b.payment_mode, b.total_items, b.total_qty,
         b.subtotal, b.discount_amount, b.total_amount,
         b.created_at, u.full_name, b.cancelled_at,
         b.cancel_reason_type, b.cancel_reason,
         COUNT(*) OVER() AS total_count
  FROM bills b
  LEFT JOIN users u ON u.id = b.created_by
  WHERE b.shop_id = p_shop_id AND b.is_deleted = false
    AND (p_status IS NULL OR p_status = '' OR b.status = p_status)
    AND (p_search IS NULL OR p_search = '' OR b.code ILIKE '%' || p_search || '%')
    AND (p_from IS NULL OR (b.created_at AT TIME ZONE 'Asia/Kolkata')::date >= p_from)
    AND (p_to   IS NULL OR (b.created_at AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
  ORDER BY b.created_at DESC
  LIMIT p_page_size OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;

DROP FUNCTION IF EXISTS fn_bill_get(uuid, uuid);
CREATE OR REPLACE FUNCTION fn_bill_get(
  p_bill_id  uuid,
  p_shop_id  uuid
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  status             varchar,
  payment_mode       varchar,
  total_items        int,
  total_qty          int,
  subtotal           numeric,
  discount_kind      varchar,
  discount_value     numeric,
  discount_amount    numeric,
  total_amount       numeric,
  notes              varchar,
  created_at         timestamptz,
  created_by_name    varchar,
  cancelled_at       timestamptz,
  cancelled_by_name  varchar,
  cancel_reason_type varchar,
  cancel_reason      varchar,
  customer_id        uuid,
  customer_name      varchar,
  customer_phone     varchar
)
LANGUAGE sql STABLE AS $$
  SELECT b.id, b.code, b.status, b.payment_mode, b.total_items, b.total_qty,
         b.subtotal, b.discount_kind, b.discount_value, b.discount_amount, b.total_amount,
         b.notes, b.created_at, cu.full_name,
         b.cancelled_at, xu.full_name,
         b.cancel_reason_type, b.cancel_reason,
         b.customer_id, cust.name, cust.phone
  FROM bills b
  LEFT JOIN users cu     ON cu.id   = b.created_by
  LEFT JOIN users xu     ON xu.id   = b.cancelled_by
  LEFT JOIN customers cust ON cust.id = b.customer_id
  WHERE b.id = p_bill_id AND b.shop_id = p_shop_id AND b.is_deleted = false;
$$;

COMMIT;

-- ============================================================
-- VERIFY
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'bills' AND column_name LIKE 'discount%' OR column_name = 'subtotal';
-- SELECT * FROM fn_bill_get('<some-existing-bill-id>', '<shop-id>');
-- ============================================================
