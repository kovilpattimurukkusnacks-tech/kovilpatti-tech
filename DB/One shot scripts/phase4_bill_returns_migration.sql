-- ============================================================
-- Kovilpatti Snacks — Phase 4b · BILL RETURNS · MIGRATION
--
-- Feature #1 (Return Bill) from DB/planned/phase4_billing_full_scope.md.
-- Agreed scope (22-Jul-2026):
--   • Refund modes: Cash | UPI only  (customer/credit balance from
--     feature #4 is NOT built yet — no "add to credit" / store-credit)
--   • Partial AND full returns (pick items + qty, capped at billed −
--     already-returned)
--   • No return-window enforcement
--   • No thermal print
--
-- Idempotent one-shot for an existing dev/UAT deploy. Safe to re-run:
-- CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE throughout. The same
-- DDL/SPs are baked into DB/phase4/phase4_billing_init.sql +
-- phase4_billing_procedures.sql for fresh deploys.
--
-- Run AFTER: phase4_billing_init.sql + phase4_billing_procedures.sql.
-- ------------------------------------------------------------
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f "DB/One shot scripts/phase4_bill_returns_migration.sql"
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. bill_returns — return header. One row per return event; a bill
--    can have several partial returns over time (each is its own row,
--    linked by source_bill_id — same trace pattern as
--    stock_requests.source_request_id for Phase 3 accounts).
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS bill_return_code_seq START 1;

CREATE TABLE IF NOT EXISTS bill_returns (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code             varchar(20)   NOT NULL DEFAULT 'RET' || lpad(nextval('bill_return_code_seq')::text, 4, '0'),
  source_bill_id   uuid          NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  shop_id          uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  -- Cash back or UPI reverse. Credit/store-credit deferred to feature #4.
  refund_mode      varchar(10)   NOT NULL,
  -- Category + free-text note (doc: damaged / wrong item / changed mind / other).
  reason_type      varchar(20)   NOT NULL,
  reason_note      varchar(500)  NULL,
  -- Cached aggregates, kept in sync by fn_bill_return_create (same
  -- pattern as bills.total_items/total_qty/total_amount).
  total_items      int           NOT NULL DEFAULT 0,
  total_qty        int           NOT NULL DEFAULT 0,
  total_amount     numeric(12,2) NOT NULL DEFAULT 0,
  is_deleted       boolean       NOT NULL DEFAULT false,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  created_by       uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  updated_by       uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_bill_returns_code UNIQUE (code),
  CONSTRAINT chk_bill_returns_refund_mode CHECK (refund_mode IN ('Cash','UPI')),
  CONSTRAINT chk_bill_returns_reason_type
    CHECK (reason_type IN ('Damaged','WrongItem','ChangedMind','Other')),
  CONSTRAINT chk_bill_returns_totals_nonneg
    CHECK (total_items >= 0 AND total_qty >= 0 AND total_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_returns_shop_time ON bill_returns(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_returns_source     ON bill_returns(source_bill_id);


-- ------------------------------------------------------------
-- 2. bill_return_items — returned lines. unit_price is copied from the
--    original bill line (refund at the price actually charged, never
--    current MRP). Same product can't appear twice on one return.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_return_items (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id    uuid          NOT NULL REFERENCES bill_returns(id) ON DELETE CASCADE,
  product_id   uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty          int           NOT NULL,
  unit_price   numeric(10,2) NOT NULL,
  line_total   numeric(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED,
  CONSTRAINT uq_bill_return_items_return_product UNIQUE (return_id, product_id),
  CONSTRAINT chk_bill_return_items_qty_pos      CHECK (qty > 0),
  CONSTRAINT chk_bill_return_items_price_nonneg CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_return_items_return  ON bill_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_bill_return_items_product ON bill_return_items(product_id);


-- updated_at trigger — reuse set_updated_at() from phase 1.
DROP TRIGGER IF EXISTS trg_bill_returns_updated ON bill_returns;
CREATE TRIGGER trg_bill_returns_updated BEFORE UPDATE ON bill_returns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;


-- ============================================================
-- PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- 3. fn_bill_returnable_items — per-line returnable qty for a bill.
--    Powers the Return dialog: billed qty, already-returned qty (sum
--    over prior non-deleted returns), and remaining returnable.
--    Rows with returnable = 0 are still returned so the UI can grey them.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_returnable_items(
  p_bill_id  uuid,
  p_shop_id  uuid
)
RETURNS TABLE (
  product_id       uuid,
  product_code     text,
  product_name     varchar,
  weight_value     numeric,
  weight_unit      varchar,
  unit_price       numeric,
  billed_qty       int,
  returned_qty     int,
  returnable_qty   int
)
LANGUAGE sql STABLE AS $$
  SELECT bi.product_id,
         p.code AS product_code,
         p.name AS product_name,
         p.weight_value,
         p.weight_unit,
         bi.unit_price,
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
  ORDER  BY p.name;
$$;


-- ------------------------------------------------------------
-- 4. fn_bill_return_create — atomic: validate against the source bill,
--    insert header + lines, and put each returned qty back on the shelf
--    via fn_shop_inventory_refund.
--
-- p_items: jsonb array of {"productId": uuid, "qty": int}
--
-- Validation (each RAISEs → API surfaces as 400):
--   • source bill exists, same shop, status 'Issued' (a Cancelled bill
--     already reversed its stock — nothing to return)
--   • cart not empty, qty > 0, no duplicate products
--   • each product was on the bill; qty <= billed − already-returned
--   • refund_mode Cash|UPI, reason_type in the allowed set
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_return_create(
  p_bill_id      uuid,
  p_shop_id      uuid,
  p_user_id      uuid,
  p_refund_mode  varchar,
  p_reason_type  varchar,
  p_reason_note  varchar,
  p_items        jsonb
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
  v_bill         record;
  v_return_id    uuid;
  v_code         varchar(20);
  v_line         record;
  v_billed_qty   int;
  v_returned_qty int;
  v_unit_price   numeric(10,2);
  v_total_items  int := 0;
  v_total_qty    int := 0;
  v_total_amount numeric(12,2) := 0;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A return must contain at least one item.';
  END IF;

  IF p_refund_mode NOT IN ('Cash','UPI') THEN
    RAISE EXCEPTION 'Invalid refund mode "%": must be Cash or UPI.', p_refund_mode;
  END IF;

  IF p_reason_type NOT IN ('Damaged','WrongItem','ChangedMind','Other') THEN
    RAISE EXCEPTION 'Invalid return reason.';
  END IF;

  -- Duplicate-product guard for a friendly error before any insert.
  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice on the return — combine the quantity on one line.';
  END IF;

  -- Lock the source bill so two concurrent returns can't both consume
  -- the same remaining returnable qty.
  SELECT b.id, b.code, b.status
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

    -- The line must exist on the source bill; grab its sold price.
    SELECT bi.qty, bi.unit_price
    INTO v_billed_qty, v_unit_price
    FROM bill_items bi
    WHERE bi.bill_id = p_bill_id AND bi.product_id = v_line.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A product on the return was not on bill %.', v_bill.code;
    END IF;

    -- Already returned on earlier returns for this bill.
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

    -- Put the goods back on the shelf (Refund movement, row-locked).
    PERFORM fn_shop_inventory_refund(
      p_shop_id, v_line.product_id, v_line.qty, p_bill_id,
      'Return ' || v_code || ' (bill ' || v_bill.code || ')', p_user_id
    );

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty + v_line.qty;
    v_total_amount := v_total_amount + (v_line.qty * v_unit_price);
  END LOOP;

  UPDATE bill_returns br
  SET total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount,
      updated_by   = p_user_id
  WHERE br.id = v_return_id;

  RETURN QUERY
  SELECT br.id, br.code, br.total_items, br.total_qty, br.total_amount
  FROM bill_returns br WHERE br.id = v_return_id;
END;
$$;


-- ------------------------------------------------------------
-- 5. fn_bill_return_list — shop-scoped return history, newest first.
--    total_count via window so the API gets rows + count in one call.
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
    -- IST date boundaries — same convention as fn_bill_list / phase 3.
    AND  (p_from IS NULL OR (br.created_at AT TIME ZONE 'Asia/Kolkata')::date >= p_from)
    AND  (p_to   IS NULL OR (br.created_at AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
  ORDER  BY br.created_at DESC
  LIMIT  p_page_size
  OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;


-- ------------------------------------------------------------
-- 6. fn_bill_return_get + fn_bill_return_get_items — return detail.
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
-- VERIFY
--   SELECT tablename FROM pg_tables WHERE tablename IN ('bill_returns','bill_return_items');
--   SELECT proname FROM pg_proc WHERE proname LIKE 'fn_bill_return%'
--                                  OR proname = 'fn_bill_returnable_items';
-- ============================================================
