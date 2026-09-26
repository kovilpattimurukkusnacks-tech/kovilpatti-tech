-- ============================================================
-- Kovilpatti Snacks — Phase 4 · BILLING · PROCEDURES (SPs)
--
-- Companion to phase4_billing_init.sql. Run AFTER:
--   1. phase4_shop_inventory_init.sql
--   2. phase4_shop_inventory_procedures.sql  (fn_shop_inventory_sale /
--      fn_shop_inventory_refund — called per line below)
--   3. phase4_billing_init.sql
--
-- All functions CREATE OR REPLACE — safe to reload after edits.
-- ============================================================

-- ------------------------------------------------------------
-- 1. fn_billing_products — powers the POS product grid + scan lookup.
--
-- Returns active products with their MRP and this shop's on-hand.
-- p_search matches name / code / barcode (ILIKE); the FE scan path
-- also resolves exact barcode-or-code matches client-side from the
-- same result set. on_hand is 0 for products the shop has never held.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_billing_products(uuid, varchar, int);
CREATE OR REPLACE FUNCTION fn_billing_products(
  p_shop_id  uuid,
  p_search   varchar DEFAULT NULL,
  p_limit    int     DEFAULT 500
)
RETURNS TABLE (
  id            uuid,
  code          text,
  barcode       varchar,
  name          varchar,
  category_name varchar,
  weight_value  numeric,
  weight_unit   varchar,
  mrp           numeric,
  on_hand       numeric,
  sold_loose    boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id,
         p.code,
         p.barcode,
         p.name,
         c.name AS category_name,
         p.weight_value,
         p.weight_unit,
         p.mrp,
         COALESCE(si.on_hand, 0) AS on_hand,
         p.sold_loose
  FROM   products p
  LEFT   JOIN categories c ON c.id = p.category_id
  LEFT   JOIN shop_inventory si
         ON si.product_id = p.id AND si.shop_id = p_shop_id
  WHERE  p.is_deleted = false
    AND  p.active = true
    AND  (p_search IS NULL OR p_search = ''
          OR p.name    ILIKE '%' || p_search || '%'
          OR p.code    ILIKE '%' || p_search || '%'
          OR p.barcode ILIKE '%' || p_search || '%')
  -- In-stock products first, out-of-stock at the end (client req
  -- 14-Jul-2026); alphabetical within each group.
  ORDER  BY (COALESCE(si.on_hand, 0) > 0) DESC, p.name
  LIMIT  p_limit;
$$;


-- ------------------------------------------------------------
-- 2. fn_bill_create — atomic: header + items + one Sale movement per
--    line through the shop-inventory ledger + tender rows.
--
-- p_items:    jsonb array of {"productId": uuid, "qty": int}
-- p_payments: jsonb array of {"mode": "Cash"|"UPI", "amount": numeric}
--             — tenders must sum to the computed bill total (feature #5).
--
-- Validation (each RAISEs → API surfaces as 400):
--   • cart not empty, qty > 0, no duplicate products
--   • at least one payment; each Cash/UPI, amount > 0; sum = bill total
--   • product exists, active, not deleted (price = current MRP snapshot)
--   • stock: fn_shop_inventory_sale row-locks and rejects an oversell.
-- Header payment_mode = the single tender's mode, or 'Split' for many.
-- ------------------------------------------------------------
-- p_customer_id: optional customer (walk-in = NULL). A 'Credit' tender
-- requires one and posts to their balance/ledger (feature #4).
-- 25-Sep-2026 (billing loophole fixes): signature grew p_cash_tendered.
-- Also: customer must belong to the shop on EVERY bill (not only credit),
-- discount capped by app_settings.bill_max_discount_percent, loose weight
-- capped at 50 kg, and loose lines deduct the EXACT fraction of a pack from
-- stock (was CEIL — a 50 g sale from a 200 g pack took a whole pack).
DROP FUNCTION IF EXISTS fn_bill_create(uuid, uuid, uuid, jsonb, jsonb, varchar);
DROP FUNCTION IF EXISTS fn_bill_create(uuid, uuid, uuid, jsonb, jsonb, varchar, varchar, numeric);
DROP FUNCTION IF EXISTS fn_bill_create(uuid, uuid, uuid, jsonb, jsonb, varchar, varchar, numeric, numeric);

CREATE OR REPLACE FUNCTION fn_bill_create(
  p_shop_id       uuid,
  p_user_id       uuid,
  p_customer_id   uuid,
  p_payments      jsonb,
  p_items         jsonb,
  p_notes         varchar DEFAULT NULL,
  -- Bill-level discount. 'Percent' → discount_value is 0-100 (%),
  -- 'Amount' → discount_value is a flat ₹ off. NULL/NULL = no discount.
  p_discount_kind  varchar DEFAULT NULL,
  p_discount_value numeric DEFAULT NULL,
  -- Cash the customer handed over (optional). Must cover the Cash tender.
  p_cash_tendered  numeric DEFAULT NULL
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
  c_max_loose_g     CONSTANT numeric := 50000;   -- 50 kg per line
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
  v_cash_sum        numeric(12,2) := 0;
  v_summary_mode    varchar(10);
  v_has_credit      boolean := false;
  v_cust            record;
  v_max_disc_pct    numeric;
BEGIN
  -- Discount input validation. Kind + value move together.
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
  IF p_cash_tendered IS NOT NULL AND p_cash_tendered < 0 THEN
    RAISE EXCEPTION 'Cash received cannot be negative.';
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
      v_has_credit := true;
      v_credit_sum := v_credit_sum + v_pay.amount;
    ELSIF v_pay.mode = 'Cash' THEN
      v_cash_sum := v_cash_sum + v_pay.amount;
    END IF;
  END LOOP;

  -- A credit tender needs a customer.
  IF v_has_credit AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required for a credit sale.';
  END IF;

  -- Any attached customer must belong to THIS shop (was only checked for
  -- credit sales — another shop's customer could be attached and their
  -- name/phone read back on the bill). Row-locked when credit is involved;
  -- lock order stays customer → inventory.
  IF p_customer_id IS NOT NULL THEN
    IF v_has_credit THEN
      SELECT c.id, c.credit_limit, c.credit_balance INTO v_cust
      FROM customers c
      WHERE c.id = p_customer_id AND c.shop_id = p_shop_id AND c.is_deleted = false
      FOR UPDATE;
    ELSE
      SELECT c.id, c.credit_limit, c.credit_balance INTO v_cust
      FROM customers c
      WHERE c.id = p_customer_id AND c.shop_id = p_shop_id AND c.is_deleted = false;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer not found.';
    END IF;
  END IF;

  -- Duplicate-product guard before any insert.
  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice on the bill — adjust the quantity on one line instead.';
  END IF;

  v_summary_mode := CASE WHEN v_pay_count = 1 THEN (p_payments->0->>'mode') ELSE 'Split' END;

  INSERT INTO bills (shop_id, customer_id, payment_mode, notes, cash_tendered, created_by)
  VALUES (p_shop_id, p_customer_id, v_summary_mode, p_notes, p_cash_tendered, p_user_id)
  RETURNING bills.id, bills.code INTO v_bill_id, v_code;

  DECLARE
    v_line_qty      int;
    v_line_loose_g  numeric(10,3);
    v_pack_g        numeric(10,3);
    v_line_total    numeric(12,2);
    v_stock_units   numeric(12,3);
  BEGIN
    FOR v_line IN
      SELECT (x->>'productId')::uuid AS product_id,
             NULLIF(x->>'qty', '')::int          AS qty,
             NULLIF(x->>'looseWeightG', '')::numeric AS loose_g
      FROM jsonb_array_elements(p_items) x
    LOOP
      v_line_qty     := v_line.qty;
      v_line_loose_g := v_line.loose_g;

      IF (v_line_qty IS NULL) = (v_line_loose_g IS NULL) THEN
        RAISE EXCEPTION 'Each line must be either a packet qty OR a loose weight (grams).';
      END IF;
      IF v_line_qty IS NOT NULL AND v_line_qty <= 0 THEN
        RAISE EXCEPTION 'Quantity must be a positive whole number.';
      END IF;
      IF v_line_loose_g IS NOT NULL AND v_line_loose_g <= 0 THEN
        RAISE EXCEPTION 'Loose weight must be greater than zero.';
      END IF;
      IF v_line_loose_g IS NOT NULL AND v_line_loose_g > c_max_loose_g THEN
        RAISE EXCEPTION 'Loose weight % g is too large — the limit is % kg per line.', trim_scale(v_line_loose_g), trim_scale(c_max_loose_g / 1000);
      END IF;

      SELECT p.id, p.name, p.mrp, p.sold_loose, p.weight_value, p.weight_unit
        INTO v_product
      FROM products p
      WHERE p.id = v_line.product_id AND p.is_deleted = false AND p.active = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found or inactive.', v_line.product_id;
      END IF;

      IF v_line_loose_g IS NOT NULL THEN
        IF NOT v_product.sold_loose THEN
          RAISE EXCEPTION 'Product "%" is not marked for loose sale.', v_product.name;
        END IF;
        v_pack_g := CASE v_product.weight_unit
                      WHEN 'kg' THEN v_product.weight_value * 1000
                      WHEN 'g'  THEN v_product.weight_value
                      ELSE NULL
                    END;
        IF v_pack_g IS NULL OR v_pack_g <= 0 THEN
          RAISE EXCEPTION 'Loose-sale product "%" needs weight_value + g/kg unit.', v_product.name;
        END IF;
        v_line_total  := ROUND((v_line_loose_g / v_pack_g) * v_product.mrp, 2);
        -- Exact fraction of a pack (3 dp, never 0 — the ledger rejects a
        -- zero delta). total_qty keeps counting packets touched (CEIL).
        v_stock_units := GREATEST(ROUND(v_line_loose_g / v_pack_g, 3), 0.001);
        v_total_qty   := v_total_qty + CEIL(v_line_loose_g / v_pack_g)::int;
        INSERT INTO bill_items (
          bill_id, product_id, qty, loose_weight_g, unit_price,
          pack_weight_g_snapshot, line_total
        ) VALUES (
          v_bill_id, v_product.id, NULL, v_line_loose_g, v_product.mrp,
          v_pack_g, v_line_total
        );
      ELSE
        v_line_total  := v_line_qty * v_product.mrp;
        v_stock_units := v_line_qty;
        v_total_qty   := v_total_qty + v_line_qty;
        INSERT INTO bill_items (
          bill_id, product_id, qty, unit_price, line_total
        ) VALUES (
          v_bill_id, v_product.id, v_line_qty, v_product.mrp, v_line_total
        );
      END IF;

      -- Ledger write — row-locks (shop, product); raises if on_hand would
      -- go negative, rolling back the whole bill.
      PERFORM fn_shop_inventory_sale(
        p_shop_id, v_product.id, v_stock_units, v_bill_id, 'Bill ' || v_code, p_user_id);

      v_total_items := v_total_items + 1;
      v_subtotal    := v_subtotal + v_line_total;
    END LOOP;
  END;

  -- Apply the bill-level discount now that subtotal is known.
  IF p_discount_kind = 'Percent' THEN
    v_discount_amount := ROUND(v_subtotal * p_discount_value / 100, 2);
  ELSIF p_discount_kind = 'Amount' THEN
    v_discount_amount := LEAST(p_discount_value, v_subtotal);
  END IF;

  -- Discount cap (both kinds, measured as % of the bill).
  IF v_discount_amount > 0 AND v_subtotal > 0 THEN
    v_max_disc_pct := COALESCE(
      (SELECT NULLIF(s.value, '')::numeric FROM app_settings s WHERE s.key = 'bill_max_discount_percent'),
      100);
    IF v_discount_amount * 100 > v_subtotal * v_max_disc_pct THEN
      RAISE EXCEPTION 'Discount of ₹% (% %%) is more than the allowed % %% of the bill. Ask the admin if a bigger discount is needed.',
        v_discount_amount, ROUND(v_discount_amount * 100 / v_subtotal, 1), v_max_disc_pct;
    END IF;
  END IF;

  v_total_amount := v_subtotal - v_discount_amount;

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'Bill total must be greater than zero.';
  END IF;

  -- A single tender means "the customer pays the whole bill", so the
  -- server's rounded total is authoritative (FE float rounding could miss
  -- by a paisa). Split tenders still must match exactly.
  IF v_pay_count = 1 THEN
    v_pay_sum    := v_total_amount;
    v_credit_sum := CASE WHEN v_has_credit THEN v_total_amount ELSE 0 END;
    v_cash_sum   := CASE WHEN (p_payments->0->>'mode') = 'Cash' THEN v_total_amount ELSE 0 END;
  END IF;

  IF v_pay_sum <> v_total_amount THEN
    RAISE EXCEPTION 'Payments (%) must equal the bill total (%).', v_pay_sum, v_total_amount;
  END IF;

  IF p_cash_tendered IS NOT NULL AND p_cash_tendered < v_cash_sum THEN
    RAISE EXCEPTION 'Cash received (₹%) is less than the cash due (₹%).', p_cash_tendered, v_cash_sum;
  END IF;

  -- Credit limit — checked against the FINAL credit portion. Nested IF:
  -- v_cust is only assigned when a customer is attached.
  IF v_has_credit THEN
    IF v_cust.credit_limit > 0
       AND (v_cust.credit_balance + v_credit_sum) > v_cust.credit_limit THEN
      RAISE EXCEPTION 'Credit limit exceeded: balance % + % is over the limit of %.',
        v_cust.credit_balance, v_credit_sum, v_cust.credit_limit;
    END IF;
  END IF;

  IF v_pay_count = 1 THEN
    INSERT INTO bill_payments (bill_id, mode, amount)
    VALUES (v_bill_id, (p_payments->0->>'mode'), v_total_amount);
  ELSE
    FOR v_pay IN
      SELECT (x->>'mode')::varchar AS mode, (x->>'amount')::numeric AS amount
      FROM jsonb_array_elements(p_payments) x
    LOOP
      INSERT INTO bill_payments (bill_id, mode, amount)
      VALUES (v_bill_id, v_pay.mode, v_pay.amount);
    END LOOP;
  END IF;

  -- Post the credit portion to the customer's balance + ledger. Columns
  -- qualified: a bare `id` collides with this function's RETURNS TABLE.
  IF v_credit_sum > 0 THEN
    UPDATE customers c
    SET    credit_balance = c.credit_balance + v_credit_sum, updated_by = p_user_id
    WHERE  c.id = p_customer_id;

    INSERT INTO customer_credit_ledger (customer_id, bill_id, entry_type, amount, balance_after, created_by)
    VALUES (p_customer_id, v_bill_id, 'Credit', v_credit_sum,
            (SELECT c.credit_balance FROM customers c WHERE c.id = p_customer_id), p_user_id);
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
-- 2b. fn_bill_get_payments — tender breakdown for a bill (feature #5).
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


-- ------------------------------------------------------------
-- 3. fn_bill_cancel — whole-bill reversal.
--
-- p_shop_id scopes the lookup (service passes the JWT shop claim, or the
-- bill's own shop for an admin override). Each line writes a Refund
-- movement putting goods back on the shelf.
--
-- Rules (25-Sep-2026 loophole fixes):
--   • Blocked once a return exists (stock + cash would be reversed twice).
--   • Credit tender is reversed on the customer's balance ('Reversal' row);
--     blocked if part of it is already repaid (balance < credit portion).
--   • Shop users (p_is_admin = false) may only cancel THEIR OWN bills and
--     only while the day is still open — i.e. the bill was made after the
--     shop's last day-end close. Anything older needs the admin. Stops
--     "cancel yesterday's cash bill and pocket the cash".
--   • Reason 'Other' needs a note.
--   • Stock refund = exactly what the sale took out (read from the bill's
--     Sale movements), so bills from before the loose-fraction change
--     refund their whole packs correctly.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_cancel(uuid, uuid, uuid, varchar, varchar);
DROP FUNCTION IF EXISTS fn_bill_cancel(uuid, uuid, uuid, varchar, varchar, boolean);

CREATE OR REPLACE FUNCTION fn_bill_cancel(
  p_bill_id      uuid,
  p_shop_id      uuid,
  p_user_id      uuid,
  p_reason_type  varchar,
  p_reason_note  varchar DEFAULT NULL,
  p_is_admin     boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_bill        record;
  v_line        record;
  v_credit_amt  numeric(12,2);
  v_balance     numeric(12,2);
  v_last_close  timestamptz;
BEGIN
  IF p_reason_type NOT IN ('Mistake','Duplicate','CustomerRefused','Other') THEN
    RAISE EXCEPTION 'Please choose a valid cancellation reason.';
  END IF;
  IF p_reason_type = 'Other' AND NULLIF(btrim(p_reason_note), '') IS NULL THEN
    RAISE EXCEPTION 'Please write why the bill is being cancelled.';
  END IF;

  SELECT b.id, b.code, b.status, b.customer_id, b.created_by, b.created_at
  INTO v_bill
  FROM bills b
  WHERE b.id = p_bill_id AND b.shop_id = p_shop_id AND b.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;

  IF v_bill.status = 'Cancelled' THEN
    RAISE EXCEPTION 'Bill % is already cancelled.', v_bill.code;
  END IF;

  IF NOT COALESCE(p_is_admin, false) THEN
    IF v_bill.created_by <> p_user_id THEN
      RAISE EXCEPTION 'Bill % was made by another cashier — only they or the admin can cancel it.', v_bill.code;
    END IF;
    v_last_close := fn_eod_last_close(p_shop_id);
    IF v_last_close IS NOT NULL AND v_bill.created_at <= v_last_close THEN
      RAISE EXCEPTION 'Bill % is from a day that is already closed, so it can''t be cancelled here. Ask the admin.', v_bill.code;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM bill_returns br
             WHERE br.source_bill_id = p_bill_id AND br.is_deleted = false) THEN
    RAISE EXCEPTION 'Bill % already has a return recorded, so it can''t be cancelled. Return the remaining items instead.',
      v_bill.code;
  END IF;

  -- Reverse the credit portion (if any) before touching stock.
  SELECT COALESCE(SUM(bp.amount), 0) INTO v_credit_amt
  FROM bill_payments bp
  WHERE bp.bill_id = p_bill_id AND bp.mode = 'Credit';

  IF v_credit_amt > 0 THEN
    SELECT c.credit_balance INTO v_balance
    FROM customers c
    WHERE c.id = v_bill.customer_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The credit customer on bill % no longer exists, so the credit can''t be reversed.', v_bill.code;
    END IF;
    IF v_balance < v_credit_amt THEN
      RAISE EXCEPTION 'Bill % was ₹% on credit, but the customer''s outstanding balance is only ₹% (part is already paid). Settle the difference with the customer first.',
        v_bill.code, v_credit_amt, v_balance;
    END IF;

    UPDATE customers
    SET credit_balance = credit_balance - v_credit_amt, updated_by = p_user_id
    WHERE id = v_bill.customer_id;

    INSERT INTO customer_credit_ledger (customer_id, bill_id, entry_type, amount, mode, note, balance_after, created_by)
    VALUES (v_bill.customer_id, p_bill_id, 'Reversal', v_credit_amt, NULL,
            'Bill ' || v_bill.code || ' cancelled',
            v_balance - v_credit_amt, p_user_id);
  END IF;

  -- Put back exactly what the sale took out.
  FOR v_line IN
    SELECT m.product_id, SUM(-m.qty_delta) AS refund_qty
    FROM shop_inventory_movements m
    WHERE m.ref_type = 'Bill' AND m.ref_id = p_bill_id
      AND m.movement_type = 'Sale' AND m.shop_id = p_shop_id
    GROUP BY m.product_id
    HAVING SUM(-m.qty_delta) > 0
  LOOP
    PERFORM fn_shop_inventory_refund(
      p_shop_id, v_line.product_id, v_line.refund_qty, p_bill_id,
      'Cancel ' || v_bill.code || ': ' || p_reason_type
        || CASE WHEN COALESCE(p_is_admin, false) THEN ' (admin)' ELSE '' END,
      p_user_id
    );
  END LOOP;

  UPDATE bills b
  SET status             = 'Cancelled',
      cancelled_at       = now(),
      cancelled_by       = p_user_id,
      cancel_reason_type = p_reason_type,
      cancel_reason      = NULLIF(btrim(p_reason_note), ''),
      updated_by         = p_user_id
  WHERE b.id = p_bill_id;
END;
$$;


-- ------------------------------------------------------------
-- 4. fn_bill_list — shop-scoped bill history, newest first.
--    total_count via window so the API gets rows + count in one call.
--    DROP first so re-running on an older DB can change the return type.
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
  SELECT b.id,
         b.code,
         b.status,
         b.payment_mode,
         b.total_items,
         b.total_qty,
         b.subtotal,
         b.discount_amount,
         b.total_amount,
         b.created_at,
         u.full_name AS created_by_name,
         b.cancelled_at,
         b.cancel_reason_type,
         b.cancel_reason,
         COUNT(*) OVER() AS total_count
  FROM   bills b
  LEFT   JOIN users u ON u.id = b.created_by
  WHERE  b.shop_id = p_shop_id
    AND  b.is_deleted = false
    AND  (p_status IS NULL OR p_status = '' OR b.status = p_status)
    AND  (p_search IS NULL OR p_search = '' OR b.code ILIKE '%' || p_search || '%')
    -- Date filters interpreted in IST — same boundary convention as
    -- the phase 3 accounts SPs.
    AND  (p_from IS NULL OR (b.created_at AT TIME ZONE 'Asia/Kolkata')::date >= p_from)
    AND  (p_to   IS NULL OR (b.created_at AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
  ORDER  BY b.created_at DESC
  LIMIT  p_page_size
  OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;


-- ------------------------------------------------------------
-- 5. fn_bill_get + fn_bill_get_items — bill detail.
--    DROP first so re-running on an older DB can change the return type.
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
  SELECT b.id,
         b.code,
         b.status,
         b.payment_mode,
         b.total_items,
         b.total_qty,
         b.subtotal,
         b.discount_kind,
         b.discount_value,
         b.discount_amount,
         b.total_amount,
         b.notes,
         b.created_at,
         cu.full_name AS created_by_name,
         b.cancelled_at,
         xu.full_name AS cancelled_by_name,
         b.cancel_reason_type,
         b.cancel_reason,
         b.customer_id,
         cust.name  AS customer_name,
         cust.phone AS customer_phone
  FROM   bills b
  LEFT   JOIN users cu ON cu.id = b.created_by
  LEFT   JOIN users xu ON xu.id = b.cancelled_by
  -- 25-Sep-2026: only this shop's customer (a bill could reference another shop's).
  LEFT   JOIN customers cust ON cust.id = b.customer_id AND cust.shop_id = b.shop_id
  WHERE  b.id = p_bill_id
    AND  b.shop_id = p_shop_id
    AND  b.is_deleted = false;
$$;

-- 01-Aug-2026: signature widened with loose_weight_g + pack_weight_g_snapshot.
DROP FUNCTION IF EXISTS fn_bill_get_items(uuid);

CREATE OR REPLACE FUNCTION fn_bill_get_items(
  p_bill_id  uuid
)
RETURNS TABLE (
  id                     uuid,
  product_id             uuid,
  product_code           text,
  product_name           varchar,
  weight_value           numeric,
  weight_unit            varchar,
  qty                    int,
  loose_weight_g         numeric,
  pack_weight_g_snapshot numeric,
  unit_price             numeric,
  line_total             numeric
)
LANGUAGE sql STABLE AS $$
  SELECT bi.id,
         bi.product_id,
         p.code  AS product_code,
         p.name  AS product_name,
         p.weight_value,
         p.weight_unit,
         bi.qty,
         bi.loose_weight_g,
         bi.pack_weight_g_snapshot,
         bi.unit_price,
         bi.line_total
  FROM   bill_items bi
  JOIN   products p ON p.id = bi.product_id
  WHERE  bi.bill_id = p_bill_id
  ORDER  BY p.name;
$$;


-- ============================================================
-- BILL RETURNS (feature #1) — Cash/UPI refund, partial + full.
-- See DB/One shot scripts/phase4_bill_returns_migration.sql for the
-- table DDL notes; the same SPs are reproduced here for fresh deploys.
-- ============================================================

-- ------------------------------------------------------------
-- 6. fn_bill_returnable_items — per-line returnable qty for a bill.
--    25-Sep-2026: + refund_unit_price = MRP × (bill total / subtotal), i.e.
--    the per-unit amount the customer actually paid after the bill discount.
--    Loose-weight lines are still excluded (no partial loose returns).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_returnable_items(uuid, uuid);
CREATE OR REPLACE FUNCTION fn_bill_returnable_items(
  p_bill_id  uuid,
  p_shop_id  uuid
)
RETURNS TABLE (
  product_id         uuid,
  product_code       text,
  product_name       varchar,
  weight_value       numeric,
  weight_unit        varchar,
  unit_price         numeric,
  refund_unit_price  numeric,
  billed_qty         int,
  returned_qty       int,
  returnable_qty     int
)
LANGUAGE sql STABLE AS $$
  SELECT bi.product_id,
         p.code AS product_code,
         p.name AS product_name,
         p.weight_value,
         p.weight_unit,
         bi.unit_price,
         ROUND(bi.unit_price * CASE WHEN b.subtotal > 0 THEN b.total_amount / b.subtotal ELSE 1 END, 2)
           AS refund_unit_price,
         bi.qty AS billed_qty,
         COALESCE(r.returned_qty, 0)::int AS returned_qty,
         (bi.qty - COALESCE(r.returned_qty, 0))::int AS returnable_qty
  FROM   bills b
  JOIN   bill_items bi ON bi.bill_id = b.id
  JOIN   products p    ON p.id = bi.product_id
  LEFT   JOIN (
           SELECT bri.product_id, SUM(bri.qty) AS returned_qty
           FROM   bill_return_items bri
           JOIN   bill_returns br ON br.id = bri.return_id
           WHERE  br.source_bill_id = p_bill_id
             AND  br.is_deleted = false
           GROUP  BY bri.product_id
         ) r ON r.product_id = bi.product_id
  WHERE  b.id = p_bill_id
    AND  b.shop_id = p_shop_id
    AND  b.is_deleted = false
    AND  bi.qty IS NOT NULL           -- exclude loose lines
  ORDER  BY p.name;
$$;


-- ------------------------------------------------------------
-- 6b. fn_bill_refund_options — how a return on this bill can be refunded.
--     One row per tender mode the bill was paid with: paid, already
--     refunded in that mode, and what's left. A refund must go back the
--     way the money came in (25-Sep-2026) — no cash out for a UPI or
--     credit sale.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_refund_options(uuid, uuid);
CREATE OR REPLACE FUNCTION fn_bill_refund_options(
  p_bill_id  uuid,
  p_shop_id  uuid
)
RETURNS TABLE (
  mode       varchar,
  paid       numeric,
  refunded   numeric,
  remaining  numeric
)
LANGUAGE sql STABLE AS $$
  SELECT bp.mode,
         SUM(bp.amount)::numeric(12,2) AS paid,
         COALESCE(MAX(r.refunded), 0)::numeric(12,2) AS refunded,
         (SUM(bp.amount) - COALESCE(MAX(r.refunded), 0))::numeric(12,2) AS remaining
  FROM   bills b
  JOIN   bill_payments bp ON bp.bill_id = b.id
  LEFT   JOIN (
           SELECT br.refund_mode, SUM(br.total_amount) AS refunded
           FROM   bill_returns br
           WHERE  br.source_bill_id = p_bill_id AND br.is_deleted = false
           GROUP  BY br.refund_mode
         ) r ON r.refund_mode = bp.mode
  WHERE  b.id = p_bill_id AND b.shop_id = p_shop_id AND b.is_deleted = false
  GROUP  BY bp.mode
  ORDER  BY bp.mode;
$$;


-- ------------------------------------------------------------
-- 7. fn_bill_return_create — atomic: validate vs source bill, insert
--    header + lines, refund stock per line. p_items jsonb array of
--    {"productId": uuid, "qty": int}.
--
-- 25-Sep-2026 loophole fixes:
--   • Refund = what the customer PAID: gross × (bill total / subtotal),
--     capped so all returns together never exceed the bill total. Used to
--     refund full MRP on a discounted bill.
--   • Refund mode must be one the bill was paid with, and can't exceed
--     what was paid in that mode minus earlier refunds. 'Credit' reduces
--     the customer's outstanding balance instead of paying out cash.
--   • Shop users can only return within bill_return_window_days of the
--     bill; older bills need the admin (p_is_admin).
--   • 'Damaged' returns are written off straight after going back on the
--     shelf (net stock unchanged) — damaged goods no longer inflate
--     sellable stock.
--   • Reason 'Other' needs a note. Loose-weight lines are rejected.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_return_create(uuid, uuid, uuid, varchar, varchar, varchar, jsonb);
DROP FUNCTION IF EXISTS fn_bill_return_create(uuid, uuid, uuid, varchar, varchar, varchar, jsonb, boolean);

CREATE OR REPLACE FUNCTION fn_bill_return_create(
  p_bill_id      uuid,
  p_shop_id      uuid,
  p_user_id      uuid,
  p_refund_mode  varchar,
  p_reason_type  varchar,
  p_reason_note  varchar,
  p_items        jsonb,
  p_is_admin     boolean DEFAULT false
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
  v_bill          record;
  v_return_id     uuid;
  v_code          varchar(20);
  v_line          record;
  v_billed_qty    int;
  v_returned_qty  int;
  v_unit_price    numeric(10,2);
  v_product_name  varchar;
  v_total_items   int := 0;
  v_total_qty     int := 0;
  v_gross         numeric(12,2) := 0;
  v_refund        numeric(12,2);
  v_factor        numeric;
  v_already       numeric(12,2);
  v_mode_left     numeric(12,2);
  v_window_days   int;
  v_balance       numeric(12,2);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A return must contain at least one item.';
  END IF;

  IF p_refund_mode NOT IN ('Cash','UPI','Credit') THEN
    RAISE EXCEPTION 'Invalid refund mode "%".', p_refund_mode;
  END IF;

  IF p_reason_type NOT IN ('Damaged','WrongItem','ChangedMind','Other') THEN
    RAISE EXCEPTION 'Invalid return reason.';
  END IF;
  IF p_reason_type = 'Other' AND NULLIF(btrim(p_reason_note), '') IS NULL THEN
    RAISE EXCEPTION 'Please write why the items are being returned.';
  END IF;

  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice on the return — combine the quantity on one line.';
  END IF;

  SELECT b.id, b.code, b.status, b.subtotal, b.total_amount, b.created_at, b.customer_id
  INTO v_bill
  FROM bills b
  WHERE b.id = p_bill_id AND b.shop_id = p_shop_id AND b.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;

  IF v_bill.status <> 'Issued' THEN
    RAISE EXCEPTION 'Bill % is %, so it cannot be returned.', v_bill.code, lower(v_bill.status);
  END IF;

  IF NOT COALESCE(p_is_admin, false) THEN
    v_window_days := COALESCE(
      (SELECT NULLIF(s.value, '')::int FROM app_settings s WHERE s.key = 'bill_return_window_days'), 7);
    IF v_bill.created_at < now() - make_interval(days => v_window_days) THEN
      RAISE EXCEPTION 'Bill % is more than % days old, so it can''t be returned here. Ask the admin.',
        v_bill.code, v_window_days;
    END IF;
  END IF;

  -- The refund mode must be one the bill was paid with.
  IF NOT EXISTS (SELECT 1 FROM bill_payments bp WHERE bp.bill_id = p_bill_id AND bp.mode = p_refund_mode) THEN
    RAISE EXCEPTION 'Bill % was not paid by %, so it can''t be refunded that way.', v_bill.code, p_refund_mode;
  END IF;

  INSERT INTO bill_returns (source_bill_id, shop_id, refund_mode, reason_type, reason_note, created_by)
  VALUES (p_bill_id, p_shop_id, p_refund_mode, p_reason_type, NULLIF(btrim(p_reason_note), ''), p_user_id)
  RETURNING bill_returns.id, bill_returns.code INTO v_return_id, v_code;

  FOR v_line IN
    SELECT (x->>'productId')::uuid AS product_id,
           (x->>'qty')::int        AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be a positive whole number.';
    END IF;

    SELECT bi.qty, bi.unit_price, p.name
    INTO v_billed_qty, v_unit_price, v_product_name
    FROM bill_items bi
    JOIN products p ON p.id = bi.product_id
    WHERE bi.bill_id = p_bill_id AND bi.product_id = v_line.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A product on the return was not on bill %.', v_bill.code;
    END IF;

    -- Loose-weight lines have qty NULL; the over-return check below would
    -- compare against NULL and silently pass.
    IF v_billed_qty IS NULL THEN
      RAISE EXCEPTION '"%" was sold loose by weight, so it can''t be returned here. Cancel the whole bill instead.',
        v_product_name;
    END IF;

    SELECT COALESCE(SUM(bri.qty), 0)
    INTO v_returned_qty
    FROM bill_return_items bri
    JOIN bill_returns br ON br.id = bri.return_id
    WHERE br.source_bill_id = p_bill_id
      AND br.is_deleted = false
      AND bri.product_id = v_line.product_id;

    IF v_line.qty > (v_billed_qty - v_returned_qty) THEN
      RAISE EXCEPTION 'Cannot return % of a product — only % remain returnable on bill %.',
        v_line.qty, (v_billed_qty - v_returned_qty), v_bill.code;
    END IF;

    INSERT INTO bill_return_items (return_id, product_id, qty, unit_price)
    VALUES (v_return_id, v_line.product_id, v_line.qty, v_unit_price);

    PERFORM fn_shop_inventory_refund(
      p_shop_id, v_line.product_id, v_line.qty, p_bill_id,
      'Return ' || v_code || ' (bill ' || v_bill.code || ')', p_user_id
    );

    -- Damaged goods are not sellable — write them straight back off.
    IF p_reason_type = 'Damaged' THEN
      PERFORM fn_shop_inventory_apply_movement(
        p_shop_id, v_line.product_id, 'Adjustment', -v_line.qty, NULL,
        'BillReturn', v_return_id, 'Damaged return ' || v_code || ' written off', p_user_id);
    END IF;

    v_total_items := v_total_items + 1;
    v_total_qty   := v_total_qty + v_line.qty;
    v_gross       := v_gross + (v_line.qty * v_unit_price);
  END LOOP;

  -- What the customer actually paid for these units (bill discount shared
  -- pro rata), never more than is left of the bill after earlier returns.
  v_factor := CASE WHEN v_bill.subtotal > 0 THEN v_bill.total_amount / v_bill.subtotal ELSE 1 END;
  v_refund := ROUND(v_gross * v_factor, 2);

  SELECT COALESCE(SUM(br.total_amount), 0) INTO v_already
  FROM bill_returns br
  WHERE br.source_bill_id = p_bill_id AND br.is_deleted = false AND br.id <> v_return_id;
  v_refund := LEAST(v_refund, v_bill.total_amount - v_already);

  -- The refund can't exceed what was paid in this mode minus earlier
  -- refunds in the same mode.
  SELECT o.remaining INTO v_mode_left
  FROM fn_bill_refund_options(p_bill_id, p_shop_id) o
  WHERE o.mode = p_refund_mode;
  -- fn_bill_refund_options already counts THIS return's header (total 0
  -- so far), so remaining is exact.
  IF v_refund > COALESCE(v_mode_left, 0) THEN
    RAISE EXCEPTION 'Only ₹% of bill % can still be refunded by % — choose another refund mode or return fewer items.',
      COALESCE(v_mode_left, 0), v_bill.code, p_refund_mode;
  END IF;

  -- Credit refund: reduce what the customer owes instead of paying out.
  IF p_refund_mode = 'Credit' AND v_refund > 0 THEN
    SELECT c.credit_balance INTO v_balance
    FROM customers c WHERE c.id = v_bill.customer_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The credit customer on bill % no longer exists.', v_bill.code;
    END IF;
    IF v_balance < v_refund THEN
      RAISE EXCEPTION 'The customer only owes ₹% now (part is already paid), less than this return of ₹%. Refund the difference by Cash or UPI in a separate return.',
        v_balance, v_refund;
    END IF;
    UPDATE customers SET credit_balance = credit_balance - v_refund, updated_by = p_user_id
    WHERE customers.id = v_bill.customer_id;
    INSERT INTO customer_credit_ledger (customer_id, bill_id, entry_type, amount, mode, note, balance_after, created_by)
    VALUES (v_bill.customer_id, p_bill_id, 'Reversal', v_refund, NULL,
            'Return ' || v_code || ' on bill ' || v_bill.code, v_balance - v_refund, p_user_id);
  END IF;

  UPDATE bill_returns br
  SET total_items  = v_total_items,
      total_qty    = v_total_qty,
      gross_amount = v_gross,
      total_amount = v_refund,
      updated_by   = p_user_id
  WHERE br.id = v_return_id;

  RETURN QUERY
  SELECT br.id, br.code, br.total_items, br.total_qty, br.total_amount
  FROM bill_returns br WHERE br.id = v_return_id;
END;
$$;


-- ------------------------------------------------------------
-- 8. fn_bill_return_list — shop-scoped return history, newest first.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_return_list(
  p_shop_id    uuid,
  p_search     varchar DEFAULT NULL,
  p_from       date    DEFAULT NULL,
  p_to         date    DEFAULT NULL,
  p_page       int     DEFAULT 1,
  p_page_size  int     DEFAULT 10
)
RETURNS TABLE (
  id               uuid,
  code             varchar,
  source_bill_id   uuid,
  source_bill_code varchar,
  refund_mode      varchar,
  reason_type      varchar,
  reason_note      varchar,
  total_items      int,
  total_qty        int,
  total_amount     numeric,
  created_at       timestamptz,
  created_by_name  varchar,
  total_count      bigint
)
LANGUAGE sql STABLE AS $$
  SELECT br.id,
         br.code,
         br.source_bill_id,
         b.code AS source_bill_code,
         br.refund_mode,
         br.reason_type,
         br.reason_note,
         br.total_items,
         br.total_qty,
         br.total_amount,
         br.created_at,
         u.full_name AS created_by_name,
         COUNT(*) OVER() AS total_count
  FROM   bill_returns br
  JOIN   bills b   ON b.id = br.source_bill_id
  LEFT   JOIN users u ON u.id = br.created_by
  WHERE  br.shop_id = p_shop_id
    AND  br.is_deleted = false
    AND  (p_search IS NULL OR p_search = ''
          OR br.code ILIKE '%' || p_search || '%'
          OR b.code  ILIKE '%' || p_search || '%')
    AND  (p_from IS NULL OR (br.created_at AT TIME ZONE 'Asia/Kolkata')::date >= p_from)
    AND  (p_to   IS NULL OR (br.created_at AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
  ORDER  BY br.created_at DESC
  LIMIT  p_page_size
  OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;


-- ------------------------------------------------------------
-- 9. fn_bill_return_get + fn_bill_return_get_items — return detail.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_return_get(
  p_return_id  uuid,
  p_shop_id    uuid
)
RETURNS TABLE (
  id               uuid,
  code             varchar,
  source_bill_id   uuid,
  source_bill_code varchar,
  refund_mode      varchar,
  reason_type      varchar,
  reason_note      varchar,
  total_items      int,
  total_qty        int,
  total_amount     numeric,
  created_at       timestamptz,
  created_by_name  varchar
)
LANGUAGE sql STABLE AS $$
  SELECT br.id,
         br.code,
         br.source_bill_id,
         b.code AS source_bill_code,
         br.refund_mode,
         br.reason_type,
         br.reason_note,
         br.total_items,
         br.total_qty,
         br.total_amount,
         br.created_at,
         u.full_name AS created_by_name
  FROM   bill_returns br
  JOIN   bills b   ON b.id = br.source_bill_id
  LEFT   JOIN users u ON u.id = br.created_by
  WHERE  br.id = p_return_id
    AND  br.shop_id = p_shop_id
    AND  br.is_deleted = false;
$$;

CREATE OR REPLACE FUNCTION fn_bill_return_get_items(
  p_return_id  uuid
)
RETURNS TABLE (
  id            uuid,
  product_id    uuid,
  product_code  text,
  product_name  varchar,
  weight_value  numeric,
  weight_unit   varchar,
  qty           int,
  unit_price    numeric,
  line_total    numeric
)
LANGUAGE sql STABLE AS $$
  SELECT bri.id,
         bri.product_id,
         p.code AS product_code,
         p.name AS product_name,
         p.weight_value,
         p.weight_unit,
         bri.qty,
         bri.unit_price,
         bri.line_total
  FROM   bill_return_items bri
  JOIN   products p ON p.id = bri.product_id
  WHERE  bri.return_id = p_return_id
  ORDER  BY p.name;
$$;


-- ============================================================
-- CUSTOMERS + CREDIT (features #6 + #4). See
-- DB/One shot scripts/phase4_customers_credit_migration.sql for table
-- DDL notes; SPs reproduced here for fresh deploys.
-- ============================================================

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

-- 25-Sep-2026: credit limits are the ADMIN's call. Shop users create
-- customers with the default limit only (the service drops any limit they
-- send); the admin sets per-customer limits here. 0 = no limit, same as
-- before. A limit below the current balance is allowed (it just blocks new
-- credit until the customer pays down).
CREATE OR REPLACE FUNCTION fn_customer_set_credit_limit(
  p_customer_id  uuid,
  p_limit        numeric,
  p_user_id      uuid
)
RETURNS TABLE (
  id uuid, code varchar, name varchar, phone varchar,
  credit_limit numeric, credit_balance numeric
)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 0 THEN
    RAISE EXCEPTION 'Credit limit cannot be negative.';
  END IF;
  UPDATE customers c
  SET    credit_limit = ROUND(p_limit, 2), updated_by = p_user_id
  WHERE  c.id = p_customer_id AND c.is_deleted = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;
  RETURN QUERY
  SELECT c.id, c.code, c.name, c.phone, c.credit_limit, c.credit_balance
  FROM customers c WHERE c.id = p_customer_id;
END;
$$;

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

CREATE OR REPLACE FUNCTION fn_customer_credit_settle(
  p_customer_id  uuid,
  p_shop_id      uuid,
  p_user_id      uuid,
  p_amount       numeric,
  p_mode         varchar,
  p_note         varchar DEFAULT NULL
)
RETURNS numeric
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
  UPDATE customers SET credit_balance = v_new, updated_by = p_user_id WHERE id = p_customer_id;
  INSERT INTO customer_credit_ledger (customer_id, entry_type, amount, mode, note, balance_after, created_by)
  VALUES (p_customer_id, 'Settlement', p_amount, p_mode, NULLIF(btrim(p_note), ''), v_new, p_user_id);
  RETURN v_new;
END;
$$;

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


-- ============================================================
-- HELD (DRAFT) BILLS (feature #3).
-- 25-Sep-2026: loose-weight lines supported (qty XOR loose_weight_g), the
-- customer must belong to the shop, and holds older than
-- app_settings.held_bill_expiry_days are discarded (purged on the next
-- hold, hidden from list/get meanwhile).
-- ============================================================

-- Expiry cut-off shared by the hold SPs.
CREATE OR REPLACE FUNCTION fn_bill_hold_cutoff()
RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT now() - make_interval(days => COALESCE(
    (SELECT NULLIF(s.value, '')::int FROM app_settings s WHERE s.key = 'held_bill_expiry_days'), 2));
$$;

CREATE OR REPLACE FUNCTION fn_bill_hold_create(
  p_shop_id      uuid,
  p_user_id      uuid,
  p_customer_id  uuid,
  p_label        varchar,
  p_note         varchar,
  p_items        jsonb
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id      uuid;
  v_line    record;
  v_qty     int := 0;
  v_amt     numeric(12,2) := 0;
  v_prod    record;
  v_pack_g  numeric;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nothing to hold — the bill is empty.';
  END IF;

  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice — adjust the quantity on one line instead.';
  END IF;

  IF p_customer_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM customers c
       WHERE c.id = p_customer_id AND c.shop_id = p_shop_id AND c.is_deleted = false) THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;

  -- Purge this shop's expired holds.
  DELETE FROM held_bills h WHERE h.shop_id = p_shop_id AND h.created_at < fn_bill_hold_cutoff();

  INSERT INTO held_bills (shop_id, customer_id, label, note, created_by)
  VALUES (p_shop_id, p_customer_id, NULLIF(btrim(p_label), ''), NULLIF(btrim(p_note), ''), p_user_id)
  RETURNING held_bills.id INTO v_id;

  FOR v_line IN
    SELECT (x->>'productId')::uuid AS product_id,
           NULLIF(x->>'qty', '')::int AS qty,
           NULLIF(x->>'looseWeightG', '')::numeric AS loose_g
    FROM jsonb_array_elements(p_items) x
  LOOP
    IF (v_line.qty IS NULL) = (v_line.loose_g IS NULL) THEN
      RAISE EXCEPTION 'Each line must be either a packet qty OR a loose weight (grams).';
    END IF;
    IF v_line.qty IS NOT NULL AND v_line.qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be a positive whole number.';
    END IF;
    IF v_line.loose_g IS NOT NULL AND v_line.loose_g <= 0 THEN
      RAISE EXCEPTION 'Loose weight must be greater than zero.';
    END IF;

    SELECT p.mrp, p.weight_value, p.weight_unit INTO v_prod
    FROM products p WHERE p.id = v_line.product_id AND p.is_deleted = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found.', v_line.product_id;
    END IF;

    INSERT INTO held_bill_items (held_bill_id, product_id, qty, loose_weight_g)
    VALUES (v_id, v_line.product_id, v_line.qty, v_line.loose_g);

    IF v_line.qty IS NOT NULL THEN
      v_qty := v_qty + v_line.qty;
      v_amt := v_amt + (v_line.qty * COALESCE(v_prod.mrp, 0));
    ELSE
      v_pack_g := CASE v_prod.weight_unit WHEN 'kg' THEN v_prod.weight_value * 1000
                                          WHEN 'g'  THEN v_prod.weight_value END;
      v_qty := v_qty + CASE WHEN v_pack_g > 0 THEN CEIL(v_line.loose_g / v_pack_g)::int ELSE 1 END;
      v_amt := v_amt + CASE WHEN v_pack_g > 0 THEN ROUND((v_line.loose_g / v_pack_g) * COALESCE(v_prod.mrp, 0), 2) ELSE 0 END;
    END IF;
  END LOOP;

  UPDATE held_bills h SET total_qty = v_qty, total_amount = v_amt WHERE h.id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_bill_hold_list(
  p_shop_id  uuid
)
RETURNS TABLE (
  id uuid, label varchar, note varchar, customer_name varchar,
  item_count int, total_qty int, total_amount numeric, created_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT h.id, h.label, h.note, c.name AS customer_name,
         (SELECT COUNT(*)::int FROM held_bill_items hi WHERE hi.held_bill_id = h.id) AS item_count,
         h.total_qty, h.total_amount, h.created_at
  FROM   held_bills h
  LEFT   JOIN customers c ON c.id = h.customer_id AND c.shop_id = h.shop_id
  WHERE  h.shop_id = p_shop_id
    AND  h.created_at >= fn_bill_hold_cutoff()
  ORDER  BY h.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION fn_bill_hold_get(
  p_held_bill_id  uuid,
  p_shop_id       uuid
)
RETURNS TABLE (
  id uuid, customer_id uuid, label varchar, note varchar
)
LANGUAGE sql STABLE AS $$
  SELECT h.id, h.customer_id, h.label, h.note
  FROM   held_bills h
  WHERE  h.id = p_held_bill_id AND h.shop_id = p_shop_id
    AND  h.created_at >= fn_bill_hold_cutoff();
$$;

-- Return shape grew loose_weight_g + sold_loose → DROP first.
DROP FUNCTION IF EXISTS fn_bill_hold_get_items(uuid, uuid);
CREATE OR REPLACE FUNCTION fn_bill_hold_get_items(
  p_held_bill_id  uuid,
  p_shop_id       uuid
)
RETURNS TABLE (
  id uuid, code text, barcode varchar, name varchar,
  weight_value numeric, weight_unit varchar, mrp numeric, on_hand numeric,
  sold_loose boolean, qty int, loose_weight_g numeric
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.barcode, p.name, p.weight_value, p.weight_unit, p.mrp,
         COALESCE(si.on_hand, 0) AS on_hand, p.sold_loose, hi.qty, hi.loose_weight_g
  FROM   held_bill_items hi
  JOIN   held_bills h ON h.id = hi.held_bill_id AND h.shop_id = p_shop_id
  JOIN   products p   ON p.id = hi.product_id
  LEFT   JOIN shop_inventory si ON si.product_id = p.id AND si.shop_id = p_shop_id
  WHERE  hi.held_bill_id = p_held_bill_id
    AND  h.created_at >= fn_bill_hold_cutoff()
  ORDER  BY p.name;
$$;

CREATE OR REPLACE FUNCTION fn_bill_hold_delete(
  p_held_bill_id  uuid,
  p_shop_id       uuid
)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM held_bills WHERE id = p_held_bill_id AND shop_id = p_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Held bill not found.';
  END IF;
END;
$$;
