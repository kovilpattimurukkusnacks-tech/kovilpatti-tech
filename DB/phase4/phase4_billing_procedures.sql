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
CREATE OR REPLACE FUNCTION fn_billing_products(
  p_shop_id  uuid,
  p_search   varchar DEFAULT NULL,
  p_limit    int     DEFAULT 500
)
RETURNS TABLE (
  id           uuid,
  code         text,
  barcode      varchar,
  name         varchar,
  weight_value numeric,
  weight_unit  varchar,
  mrp          numeric,
  on_hand      numeric
)
LANGUAGE sql STABLE AS $$
  SELECT p.id,
         p.code,
         p.barcode,
         p.name,
         p.weight_value,
         p.weight_unit,
         p.mrp,
         COALESCE(si.on_hand, 0) AS on_hand
  FROM   products p
  LEFT   JOIN shop_inventory si
         ON si.product_id = p.id AND si.shop_id = p_shop_id
  WHERE  p.is_deleted = false
    AND  p.active = true
    AND  (p_search IS NULL OR p_search = ''
          OR p.name    ILIKE '%' || p_search || '%'
          OR p.code    ILIKE '%' || p_search || '%'
          OR p.barcode ILIKE '%' || p_search || '%')
  ORDER  BY p.name
  LIMIT  p_limit;
$$;


-- ------------------------------------------------------------
-- 2. fn_bill_create — atomic: header + items + one Sale movement per
--    line through the shop-inventory ledger.
--
-- p_items: jsonb array of {"productId": uuid, "qty": int}
--
-- Validation (each RAISEs → API surfaces as 400):
--   • cart not empty, qty > 0, no duplicate products
--   • product exists, active, not deleted (price = current MRP snapshot)
--   • stock: fn_shop_inventory_sale row-locks and rejects an oversell
--     with a clear message — no separate pre-check needed (the lock IS
--     the check, so two cashiers can't both sell the last packet).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_create(
  p_shop_id       uuid,
  p_user_id       uuid,
  p_payment_mode  varchar,
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
  v_bill_id      uuid;
  v_code         varchar(20);
  v_line         record;
  v_product      record;
  v_total_items  int := 0;
  v_total_qty    int := 0;
  v_total_amount numeric(12,2) := 0;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item.';
  END IF;

  IF p_payment_mode NOT IN ('Cash','UPI') THEN
    RAISE EXCEPTION 'Invalid payment mode "%": must be Cash or UPI.', p_payment_mode;
  END IF;

  -- Duplicate-product guard before any insert, so the error is friendly
  -- rather than a unique-constraint violation.
  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice on the bill — adjust the quantity on one line instead.';
  END IF;

  INSERT INTO bills (shop_id, payment_mode, notes, created_by)
  VALUES (p_shop_id, p_payment_mode, p_notes, p_user_id)
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

    -- Ledger write — row-locks (shop, product); raises if on_hand would
    -- go negative, rolling back the whole bill.
    PERFORM fn_shop_inventory_sale(
      p_shop_id, v_product.id, v_line.qty, v_bill_id,
      'Bill ' || v_code, p_user_id
    );

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty + v_line.qty;
    v_total_amount := v_total_amount + (v_line.qty * v_product.mrp);
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
-- 3. fn_bill_cancel — whole-bill reversal.
--
-- p_shop_id scopes the lookup so a shop user can only cancel their own
-- shop's bills (service passes the JWT shop claim). Each line writes a
-- Refund movement putting goods back on the shelf.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_cancel(
  p_bill_id  uuid,
  p_shop_id  uuid,
  p_user_id  uuid,
  p_reason   varchar
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_bill  record;
  v_line  record;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A cancellation reason is required.';
  END IF;

  SELECT b.id, b.code, b.status
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

  FOR v_line IN
    SELECT bi.product_id, bi.qty FROM bill_items bi WHERE bi.bill_id = p_bill_id
  LOOP
    PERFORM fn_shop_inventory_refund(
      p_shop_id, v_line.product_id, v_line.qty, p_bill_id,
      'Cancel ' || v_bill.code || ': ' || p_reason, p_user_id
    );
  END LOOP;

  UPDATE bills b
  SET status        = 'Cancelled',
      cancelled_at  = now(),
      cancelled_by  = p_user_id,
      cancel_reason = p_reason,
      updated_by    = p_user_id
  WHERE b.id = p_bill_id;
END;
$$;


-- ------------------------------------------------------------
-- 4. fn_bill_list — shop-scoped bill history, newest first.
--    total_count via window so the API gets rows + count in one call.
-- ------------------------------------------------------------
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
  id              uuid,
  code            varchar,
  status          varchar,
  payment_mode    varchar,
  total_items     int,
  total_qty       int,
  total_amount    numeric,
  created_at      timestamptz,
  created_by_name varchar,
  cancelled_at    timestamptz,
  cancel_reason   varchar,
  total_count     bigint
)
LANGUAGE sql STABLE AS $$
  SELECT b.id,
         b.code,
         b.status,
         b.payment_mode,
         b.total_items,
         b.total_qty,
         b.total_amount,
         b.created_at,
         u.full_name AS created_by_name,
         b.cancelled_at,
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
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_get(
  p_bill_id  uuid,
  p_shop_id  uuid
)
RETURNS TABLE (
  id                uuid,
  code              varchar,
  status            varchar,
  payment_mode      varchar,
  total_items       int,
  total_qty         int,
  total_amount      numeric,
  notes             varchar,
  created_at        timestamptz,
  created_by_name   varchar,
  cancelled_at      timestamptz,
  cancelled_by_name varchar,
  cancel_reason     varchar
)
LANGUAGE sql STABLE AS $$
  SELECT b.id,
         b.code,
         b.status,
         b.payment_mode,
         b.total_items,
         b.total_qty,
         b.total_amount,
         b.notes,
         b.created_at,
         cu.full_name AS created_by_name,
         b.cancelled_at,
         xu.full_name AS cancelled_by_name,
         b.cancel_reason
  FROM   bills b
  LEFT   JOIN users cu ON cu.id = b.created_by
  LEFT   JOIN users xu ON xu.id = b.cancelled_by
  WHERE  b.id = p_bill_id
    AND  b.shop_id = p_shop_id
    AND  b.is_deleted = false;
$$;

CREATE OR REPLACE FUNCTION fn_bill_get_items(
  p_bill_id  uuid
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
  SELECT bi.id,
         bi.product_id,
         p.code  AS product_code,
         p.name  AS product_name,
         p.weight_value,
         p.weight_unit,
         bi.qty,
         bi.unit_price,
         bi.line_total
  FROM   bill_items bi
  JOIN   products p ON p.id = bi.product_id
  WHERE  bi.bill_id = p_bill_id
  ORDER  BY p.name;
$$;
