-- ============================================================
-- Kovilpatti Snacks — Phase 4b · CUSTOMERS + CREDIT · MIGRATION
--
-- Features #6 (customer identification) + #4 (credit sales) from
-- DB/planned/phase4_billing_full_scope.md. Client term is "credit"
-- (not "udhaar").
--
--   • customers            — per-shop, phone-identified, cached credit_balance
--   • customer_credit_ledger — one row per credit taken / settlement paid
--   • bills.customer_id    — optional customer on a bill (walk-in = NULL)
--   • 'Credit' becomes a valid tender (bill_payments.mode) and header
--     summary (bills.payment_mode)
--   • fn_bill_create now takes p_customer_id; a Credit tender adds to the
--     customer's balance (capped at credit_limit) and writes a ledger row
--   • fn_customer_credit_settle records a repayment (Cash/UPI)
--
-- Credit limit default is an app_settings value (customer_credit_limit_default)
-- — set to 5000 here; adjust per client.
--
-- Idempotent one-shot. Baked into DB/phase4 canonical files for fresh
-- deploys. Run AFTER phase4_billing_init.sql + phase4_billing_procedures.sql
-- and the split-payment migration.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. customers — per-shop. Phone is unique per shop (partial index so
--    soft-deleted rows free the number).
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS customer_code_seq START 1;

CREATE TABLE IF NOT EXISTS customers (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(20)   NOT NULL DEFAULT 'CUST' || lpad(nextval('customer_code_seq')::text, 4, '0'),
  shop_id        uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  name           varchar(120)  NOT NULL,
  phone          varchar(20)   NOT NULL,
  credit_limit   numeric(12,2) NOT NULL DEFAULT 0,   -- 0 = no limit
  credit_balance numeric(12,2) NOT NULL DEFAULT 0,   -- cached; ledger is source of truth
  is_deleted     boolean       NOT NULL DEFAULT false,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_customers_code UNIQUE (code),
  CONSTRAINT chk_customers_credit_nonneg CHECK (credit_limit >= 0 AND credit_balance >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_shop_phone_active
  ON customers(shop_id, phone) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_customers_shop ON customers(shop_id) WHERE is_deleted = false;

DROP TRIGGER IF EXISTS trg_customers_updated ON customers;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 2. customer_credit_ledger — every credit taken and every settlement.
--    entry_type 'Credit' (balance up) or 'Settlement' (balance down).
--    mode is the repayment tender for settlements; NULL for credit.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_credit_ledger (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid          NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  bill_id       uuid          NULL REFERENCES bills(id) ON DELETE SET NULL,
  entry_type    varchar(12)   NOT NULL,
  amount        numeric(12,2) NOT NULL,
  mode          varchar(10)   NULL,
  note          varchar(500)  NULL,
  balance_after numeric(12,2) NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ccl_entry_type CHECK (entry_type IN ('Credit','Settlement')),
  CONSTRAINT chk_ccl_amount_pos CHECK (amount > 0),
  CONSTRAINT chk_ccl_mode       CHECK (mode IS NULL OR mode IN ('Cash','UPI'))
);

CREATE INDEX IF NOT EXISTS idx_ccl_customer ON customer_credit_ledger(customer_id, created_at DESC);


-- ------------------------------------------------------------
-- 3. bills.customer_id + widen tender/summary CHECKs for 'Credit'.
-- ------------------------------------------------------------
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS customer_id uuid NULL REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bills_customer ON bills(customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bills_payment_mode;
ALTER TABLE bills ADD  CONSTRAINT chk_bills_payment_mode
  CHECK (payment_mode IN ('Cash','UPI','Split','Credit'));

ALTER TABLE bill_payments DROP CONSTRAINT IF EXISTS chk_bill_payments_mode;
ALTER TABLE bill_payments ADD  CONSTRAINT chk_bill_payments_mode
  CHECK (mode IN ('Cash','UPI','Credit'));

-- 4. Default credit limit setting.
INSERT INTO app_settings (key, value, description) VALUES
  ('customer_credit_limit_default', '5000',
   'Default per-customer credit limit (₹) applied to new customers. 0 = no limit.')
ON CONFLICT (key) DO NOTHING;

COMMIT;


-- ============================================================
-- PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- 5. fn_customer_lookup — exact phone match for the POS header.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_lookup(
  p_shop_id  uuid,
  p_phone    varchar
)
RETURNS TABLE (
  id uuid, code varchar, name varchar, phone varchar,
  credit_limit numeric, credit_balance numeric
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.code, c.name, c.phone, c.credit_limit, c.credit_balance
  FROM   customers c
  WHERE  c.shop_id = p_shop_id AND c.is_deleted = false
    AND  c.phone = btrim(p_phone);
$$;

-- ------------------------------------------------------------
-- 6. fn_customer_create — quick-add. credit_limit NULL ⇒ default setting.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_create(
  p_shop_id       uuid,
  p_user_id       uuid,
  p_name          varchar,
  p_phone         varchar,
  p_credit_limit  numeric DEFAULT NULL
)
RETURNS TABLE (
  id uuid, code varchar, name varchar, phone varchar,
  credit_limit numeric, credit_balance numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_id     uuid;
  v_limit  numeric(12,2);
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required.';
  END IF;
  IF p_phone IS NULL OR btrim(p_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required.';
  END IF;

  IF EXISTS (SELECT 1 FROM customers c
             WHERE c.shop_id = p_shop_id AND c.is_deleted = false AND c.phone = btrim(p_phone)) THEN
    RAISE EXCEPTION 'A customer with this phone already exists.';
  END IF;

  v_limit := COALESCE(
    p_credit_limit,
    (SELECT COALESCE(NULLIF(value, '')::numeric, 0) FROM app_settings WHERE key = 'customer_credit_limit_default'),
    0);

  INSERT INTO customers (shop_id, name, phone, credit_limit, created_by)
  VALUES (p_shop_id, btrim(p_name), btrim(p_phone), v_limit, p_user_id)
  RETURNING customers.id INTO v_id;

  RETURN QUERY
  SELECT c.id, c.code, c.name, c.phone, c.credit_limit, c.credit_balance
  FROM customers c WHERE c.id = v_id;
END;
$$;

-- ------------------------------------------------------------
-- 7. fn_customer_list — shop-scoped, newest first, optional search on
--    name/phone/code. Window count for pagination.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_list(
  p_shop_id    uuid,
  p_search     varchar DEFAULT NULL,
  p_page       int     DEFAULT 1,
  p_page_size  int     DEFAULT 20
)
RETURNS TABLE (
  id uuid, code varchar, name varchar, phone varchar,
  credit_limit numeric, credit_balance numeric,
  created_at timestamptz, total_count bigint
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.code, c.name, c.phone, c.credit_limit, c.credit_balance,
         c.created_at, COUNT(*) OVER() AS total_count
  FROM   customers c
  WHERE  c.shop_id = p_shop_id AND c.is_deleted = false
    AND  (p_search IS NULL OR p_search = ''
          OR c.name  ILIKE '%' || p_search || '%'
          OR c.phone ILIKE '%' || p_search || '%'
          OR c.code  ILIKE '%' || p_search || '%')
  ORDER  BY c.created_at DESC
  LIMIT  p_page_size
  OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;

-- ------------------------------------------------------------
-- 8. fn_customer_credit_settle — record a repayment against balance.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_credit_settle(
  p_customer_id  uuid,
  p_shop_id      uuid,
  p_user_id      uuid,
  p_amount       numeric,
  p_mode         varchar,
  p_note         varchar DEFAULT NULL
)
RETURNS numeric      -- new balance
LANGUAGE plpgsql AS $$
DECLARE
  v_balance  numeric(12,2);
  v_new      numeric(12,2);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Settlement amount must be greater than zero.';
  END IF;
  IF p_mode NOT IN ('Cash','UPI') THEN
    RAISE EXCEPTION 'Settlement must be Cash or UPI.';
  END IF;

  SELECT c.credit_balance INTO v_balance
  FROM customers c
  WHERE c.id = p_customer_id AND c.shop_id = p_shop_id AND c.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;

  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Settlement (%) exceeds the outstanding balance (%).', p_amount, v_balance;
  END IF;

  v_new := v_balance - p_amount;

  UPDATE customers SET credit_balance = v_new, updated_by = p_user_id
  WHERE id = p_customer_id;

  INSERT INTO customer_credit_ledger (customer_id, entry_type, amount, mode, note, balance_after, created_by)
  VALUES (p_customer_id, 'Settlement', p_amount, p_mode, NULLIF(btrim(p_note), ''), v_new, p_user_id);

  RETURN v_new;
END;
$$;

-- ------------------------------------------------------------
-- 9. fn_customer_credit_ledger_list — statement for one customer.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_credit_ledger_list(
  p_customer_id  uuid,
  p_shop_id      uuid,
  p_page         int DEFAULT 1,
  p_page_size    int DEFAULT 20
)
RETURNS TABLE (
  id uuid, entry_type varchar, amount numeric, mode varchar,
  note varchar, balance_after numeric, bill_code varchar,
  created_at timestamptz, created_by_name varchar, total_count bigint
)
LANGUAGE sql STABLE AS $$
  SELECT l.id, l.entry_type, l.amount, l.mode, l.note, l.balance_after,
         b.code AS bill_code, l.created_at, u.full_name AS created_by_name,
         COUNT(*) OVER() AS total_count
  FROM   customer_credit_ledger l
  JOIN   customers c ON c.id = l.customer_id AND c.shop_id = p_shop_id
  LEFT   JOIN bills b ON b.id = l.bill_id
  LEFT   JOIN users u ON u.id = l.created_by
  WHERE  l.customer_id = p_customer_id
  ORDER  BY l.created_at DESC
  LIMIT  p_page_size
  OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;

-- ------------------------------------------------------------
-- 10. fn_bill_create — now takes p_customer_id and accepts a 'Credit'
--     tender. A Credit tender adds to the customer's balance (capped at
--     credit_limit) and writes a ledger row.
--
--     Drop the split-payment signature (no customer arg) so only the
--     customer-aware overload remains.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_create(uuid, uuid, jsonb, jsonb, varchar);

CREATE OR REPLACE FUNCTION fn_bill_create(
  p_shop_id       uuid,
  p_user_id       uuid,
  p_customer_id   uuid,
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
  v_credit_sum    numeric(12,2) := 0;
  v_summary_mode  varchar(10);
  v_cust          record;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item.';
  END IF;
  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'Bill must have at least one payment.';
  END IF;

  v_pay_count := jsonb_array_length(p_payments);

  FOR v_pay IN
    SELECT (x->>'mode')::varchar AS mode, (x->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_payments) x
  LOOP
    IF v_pay.mode NOT IN ('Cash','UPI','Credit') THEN
      RAISE EXCEPTION 'Invalid payment mode "%".', v_pay.mode;
    END IF;
    IF v_pay.amount IS NULL OR v_pay.amount <= 0 THEN
      RAISE EXCEPTION 'Each payment amount must be greater than zero.';
    END IF;
    v_pay_sum := v_pay_sum + v_pay.amount;
    IF v_pay.mode = 'Credit' THEN
      v_credit_sum := v_credit_sum + v_pay.amount;
    END IF;
  END LOOP;

  -- A credit tender needs a customer with enough remaining limit.
  IF v_credit_sum > 0 THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'A customer is required for a credit sale.';
    END IF;
    SELECT c.id, c.credit_limit, c.credit_balance INTO v_cust
    FROM customers c
    WHERE c.id = p_customer_id AND c.shop_id = p_shop_id AND c.is_deleted = false
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer not found.';
    END IF;
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

  FOR v_line IN
    SELECT (x->>'productId')::uuid AS product_id, (x->>'qty')::int AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be a positive whole number.';
    END IF;

    SELECT p.id, p.name, p.mrp INTO v_product
    FROM products p
    WHERE p.id = v_line.product_id AND p.is_deleted = false AND p.active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found or inactive.', v_line.product_id;
    END IF;

    INSERT INTO bill_items (bill_id, product_id, qty, unit_price)
    VALUES (v_bill_id, v_product.id, v_line.qty, v_product.mrp);

    PERFORM fn_shop_inventory_sale(
      p_shop_id, v_product.id, v_line.qty, v_bill_id, 'Bill ' || v_code, p_user_id);

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty + v_line.qty;
    v_total_amount := v_total_amount + (v_line.qty * v_product.mrp);
  END LOOP;

  IF v_pay_sum <> v_total_amount THEN
    RAISE EXCEPTION 'Payments (%) must equal the bill total (%).', v_pay_sum, v_total_amount;
  END IF;

  FOR v_pay IN
    SELECT (x->>'mode')::varchar AS mode, (x->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_payments) x
  LOOP
    INSERT INTO bill_payments (bill_id, mode, amount)
    VALUES (v_bill_id, v_pay.mode, v_pay.amount);
  END LOOP;

  -- Post the credit to the customer's balance + ledger.
  IF v_credit_sum > 0 THEN
    UPDATE customers SET credit_balance = credit_balance + v_credit_sum, updated_by = p_user_id
    WHERE id = p_customer_id;

    INSERT INTO customer_credit_ledger (customer_id, bill_id, entry_type, amount, balance_after, created_by)
    VALUES (p_customer_id, v_bill_id, 'Credit', v_credit_sum,
            (SELECT credit_balance FROM customers WHERE id = p_customer_id), p_user_id);
  END IF;

  UPDATE bills b
  SET total_items = v_total_items, total_qty = v_total_qty,
      total_amount = v_total_amount, updated_by = p_user_id
  WHERE b.id = v_bill_id;

  RETURN QUERY
  SELECT b.id, b.code, b.total_items, b.total_qty, b.total_amount
  FROM bills b WHERE b.id = v_bill_id;
END;
$$;


-- ------------------------------------------------------------
-- 11. fn_bill_get — surface the attached customer on bill detail.
--     DROP first: return type changes (new customer columns).
-- ------------------------------------------------------------
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
         b.total_amount, b.notes, b.created_at, cu.full_name AS created_by_name,
         b.cancelled_at, xu.full_name AS cancelled_by_name,
         b.cancel_reason_type, b.cancel_reason,
         b.customer_id, cust.name AS customer_name, cust.phone AS customer_phone
  FROM   bills b
  LEFT   JOIN users cu ON cu.id = b.created_by
  LEFT   JOIN users xu ON xu.id = b.cancelled_by
  LEFT   JOIN customers cust ON cust.id = b.customer_id
  WHERE  b.id = p_bill_id AND b.shop_id = p_shop_id AND b.is_deleted = false;
$$;


-- ============================================================
-- VERIFY
--   SELECT tablename FROM pg_tables WHERE tablename IN ('customers','customer_credit_ledger');
--   SELECT key,value FROM app_settings WHERE key='customer_credit_limit_default';
-- ============================================================
