-- ============================================================
-- ONE-SHOT — Phase 4 POS billing (UAT / prod)
-- Assembled 14-Jul-2026 from canonical files on feature/shop-billing
-- (PR #104). Verbatim copies — if the canonical files change later,
-- re-run those instead of editing this.
--
-- DELIVERS
--   1. products.barcode column + partial-unique index
--   2. bills + bill_items + bill_code_seq
--   3. Billing SPs: fn_billing_products, fn_bill_create, fn_bill_cancel,
--      fn_bill_list, fn_bill_get, fn_bill_get_items
--   4. Product SPs updated for barcode: fn_product_list, fn_product_get,
--      fn_product_list_paged, fn_product_create, fn_product_update
--      (DROP-first — return shapes / signatures changed)
--
-- PREREQUISITE — the phase 4 SHOP INVENTORY slice must already be on
-- the target DB (fn_bill_create calls fn_shop_inventory_sale, cancel
-- calls fn_shop_inventory_refund). If missing, first run:
--   DB/phase4/phase4_shop_inventory_init.sql
--   DB/phase4/phase4_shop_inventory_procedures.sql
--
-- AFTER RUNNING — one-time opening stock per shop (idempotent; skips
-- pairs already opened). Without this every product bills as
-- "out of stock":
--   SELECT * FROM fn_shop_inventory_seed_opening(NULL);
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ────── 1+2. Schema (verbatim: phase4/phase4_billing_init.sql) ──────
-- ============================================================
-- Kovilpatti Snacks — Phase 4 · BILLING · SCHEMA (DDL)
--
-- Second Phase 4 slice (first: shop inventory). Full plan lives at
-- DB/planned/phase4_pos_billing.md — this slice is the MINIMAL v1
-- approved 14-Jul-2026 from the UI preview:
--   • bills            (header: Cash/UPI single tender, no GST lines)
--   • bill_items       (MRP snapshot per line)
--   • bill_code_seq    (BILL0001 counter)
--   • products.barcode (nullable scannable code — real EAN/UPC for
--                       bought-in goods; falls back to products.code
--                       for in-house packs)
--
-- OUT of this slice (deferred until asked): bill_payments multi-tender,
-- bill_returns (partial returns), GST split, customers, cash sessions.
-- Whole-bill CANCEL is in scope — reverses stock via the existing
-- fn_shop_inventory_refund wrapper.
--
-- Run AFTER phase4_shop_inventory_init.sql (fn_bill_create writes Sale
-- movements through the shop-inventory ledger).
-- ============================================================
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase4/phase4_billing_init.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. products.barcode — the scannable string
--    Partial-unique like the category name indexes: active products
--    can't collide, soft-deleted rows free the code up.
-- ------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_barcode_active
  ON products(barcode) WHERE barcode IS NOT NULL AND is_deleted = false;


-- ------------------------------------------------------------
-- 2. bills — invoice header
--    No status machine beyond Issued → Cancelled: a counter sale is
--    complete the instant it's created.
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS bill_code_seq START 1;

CREATE TABLE IF NOT EXISTS bills (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(20)   NOT NULL DEFAULT 'BILL' || lpad(nextval('bill_code_seq')::text, 4, '0'),
  shop_id        uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  status         varchar(20)   NOT NULL DEFAULT 'Issued',
  payment_mode   varchar(10)   NOT NULL,
  -- Cached aggregates, kept in sync by fn_bill_create (same pattern as
  -- stock_requests.total_items/total_qty/total_amount).
  total_items    int           NOT NULL DEFAULT 0,
  total_qty      int           NOT NULL DEFAULT 0,
  total_amount   numeric(12,2) NOT NULL DEFAULT 0,
  notes          varchar(500)  NULL,
  -- Cancellation trail — set together by fn_bill_cancel.
  cancelled_at     timestamptz NULL,
  cancelled_by     uuid        NULL REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason    varchar(500) NULL,
  is_deleted     boolean       NOT NULL DEFAULT false,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_bills_code UNIQUE (code),
  CONSTRAINT chk_bills_status       CHECK (status IN ('Issued','Cancelled')),
  CONSTRAINT chk_bills_payment_mode CHECK (payment_mode IN ('Cash','UPI')),
  CONSTRAINT chk_bills_totals_nonneg
    CHECK (total_items >= 0 AND total_qty >= 0 AND total_amount >= 0),
  CONSTRAINT chk_bills_cancelled_pair
    CHECK ((status = 'Cancelled') = (cancelled_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_bills_shop_time   ON bills(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_status      ON bills(status) WHERE is_deleted = false;


-- ------------------------------------------------------------
-- 3. bill_items — lines. Same product can't appear twice on one bill
--    (counter staff adjusts qty on the existing line instead) — same
--    rule as stock_request_items.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_items (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id      uuid          NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  product_id   uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty          int           NOT NULL,
  -- MRP snapshot at sale time — a later MRP edit must not rewrite an
  -- issued bill (same rationale as stock_request_items.unit_price).
  unit_price   numeric(10,2) NOT NULL,
  line_total   numeric(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED,
  CONSTRAINT uq_bill_items_bill_product UNIQUE (bill_id, product_id),
  CONSTRAINT chk_bill_items_qty_pos        CHECK (qty > 0),
  CONSTRAINT chk_bill_items_price_nonneg   CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_items_bill    ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_product ON bill_items(product_id);


-- updated_at trigger — same set_updated_at() from phase 1.
DROP TRIGGER IF EXISTS trg_bills_updated ON bills;
CREATE TRIGGER trg_bills_updated BEFORE UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;


-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
--   SELECT tablename FROM pg_tables WHERE tablename IN ('bills','bill_items');
--   SELECT sequencename FROM pg_sequences WHERE sequencename = 'bill_code_seq';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'products' AND column_name = 'barcode';
--
-- Then run phase4_billing_procedures.sql to add the SPs.
-- ============================================================

-- ────── 3. Billing SPs (verbatim: phase4/phase4_billing_procedures.sql) ──────
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
  -- In-stock products first, out-of-stock at the end (client req
  -- 14-Jul-2026); alphabetical within each group.
  ORDER  BY (COALESCE(si.on_hand, 0) > 0) DESC, p.name
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

-- ────── 4. Product SPs w/ barcode (verbatim: phase1/phase1_procedures.sql) ──────

-- 14-Jul-2026 — barcode added (POS billing scan). RETURN-shape change →
-- drop-first, same pattern as phase1_pagination.sql.
DROP FUNCTION IF EXISTS fn_product_list(varchar, int);

CREATE OR REPLACE FUNCTION fn_product_list(
  p_search      varchar DEFAULT NULL,
  p_category_id int     DEFAULT NULL
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  barcode            varchar,
  name               varchar,
  category_id        int,
  category_name      varchar,
  type               varchar,
  weight_value       numeric,
  weight_unit        varchar,
  mrp                numeric,
  purchase_price     numeric,
  gst                numeric,
  active             boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.barcode, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.is_deleted = false
    -- Tokenised search (10-Jul-2026, client feedback). MUST STAY IN SYNC
    -- with the identical predicate in fn_product_list_paged + fn_product_count
    -- (phase1_pagination.sql). Splits p_search on any non-alnum separator
    -- and requires EVERY token to appear as a case-insensitive substring
    -- of the combined "code name" — so 'nat.kam', 'nat kam', '1kg lkd',
    -- 'nk-25' all find the row where the naive whole-string ILIKE failed.
    AND (p_search IS NULL OR trim(p_search) = ''
         OR NOT EXISTS (
           SELECT 1
           FROM regexp_split_to_table(lower(trim(p_search)), '[^a-z0-9]+') AS tok
           WHERE tok <> ''
             AND strpos(lower(p.code || ' ' || p.name), tok) = 0
         ))
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ORDER BY p.code;
$$;

DROP FUNCTION IF EXISTS fn_product_get(uuid);

CREATE OR REPLACE FUNCTION fn_product_get(p_id uuid)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  barcode            varchar,
  name               varchar,
  category_id        int,
  category_name      varchar,
  type               varchar,
  weight_value       numeric,
  weight_unit        varchar,
  mrp                numeric,
  purchase_price     numeric,
  gst                numeric,
  active             boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.barcode, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.id = p_id AND p.is_deleted = false
  LIMIT 1;
$$;

-- p_barcode added 14-Jul-2026 (POS billing scan). Old 11-arg signature
-- dropped so positional calls can't hit an ambiguous overload.
DROP FUNCTION IF EXISTS fn_product_create(varchar, varchar, int, varchar, numeric, varchar, numeric, numeric, numeric, boolean, uuid);

CREATE OR REPLACE FUNCTION fn_product_create(
  p_code               varchar,
  p_name               varchar,
  p_category_id        int,
  p_type               varchar,
  p_weight_value       numeric,
  p_weight_unit        varchar,
  p_mrp                numeric,
  p_purchase_price     numeric,
  p_gst                numeric,
  p_active             boolean,
  p_user_id            uuid,
  p_barcode            varchar DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO products (code, barcode, name, category_id, type,
                        weight_value, weight_unit, mrp, purchase_price,
                        gst, active, created_by, updated_by)
  VALUES (p_code, NULLIF(btrim(p_barcode), ''), p_name, p_category_id, p_type,
          p_weight_value, p_weight_unit, p_mrp, p_purchase_price,
          p_gst, p_active, p_user_id, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS fn_product_update(uuid, varchar, varchar, int, varchar, numeric, varchar, numeric, numeric, numeric, boolean, uuid);

CREATE OR REPLACE FUNCTION fn_product_update(
  p_id                 uuid,
  p_code               varchar,
  p_name               varchar,
  p_category_id        int,
  p_type               varchar,
  p_weight_value       numeric,
  p_weight_unit        varchar,
  p_mrp                numeric,
  p_purchase_price     numeric,
  p_gst                numeric,
  p_active             boolean,
  p_user_id            uuid,
  p_barcode            varchar DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  -- Code is editable as of 07-Jun-2026 (client #10). Uniqueness is guarded
  -- by the UNIQUE constraint on products.code — service does a pre-check
  -- against OTHER rows for a clean error; this insert/update still trips
  -- the constraint if a concurrent writer collides.
  -- Barcode uniqueness rides the partial index uq_products_barcode_active
  -- (phase4_billing_init.sql); service maps 23505 to a friendly error.
  UPDATE products
  SET code               = p_code,
      barcode            = NULLIF(btrim(p_barcode), ''),
      name               = p_name,
      category_id        = p_category_id,
      type               = p_type,
      weight_value       = p_weight_value,
      weight_unit        = p_weight_unit,
      mrp                = p_mrp,
      purchase_price     = p_purchase_price,
      gst                = p_gst,
      active             = p_active,
      updated_by         = p_user_id,
      updated_at         = now()
  WHERE id = p_id;

  RETURN FOUND;
END;
$$;

-- ────── 4b. Paged list (verbatim: phase1/phase1_pagination.sql) ──────
-- 06-Jul-2026 — is_vendor_procured removed (Special Request rework). Same
-- return-shape drop pattern as above — PG blocks RETURN-shape changes on
-- CREATE OR REPLACE, so drop first.
-- 14-Jul-2026 — barcode added (POS billing scan); same drop-first dance.
DROP FUNCTION IF EXISTS fn_product_list_paged(varchar, int[], varchar[], int, int);

CREATE OR REPLACE FUNCTION fn_product_list_paged(
  p_search       varchar    DEFAULT NULL,
  p_category_ids int[]      DEFAULT NULL,
  p_types        varchar[]  DEFAULT NULL,
  p_page         int        DEFAULT 1,
  p_page_size    int        DEFAULT 25
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  barcode            varchar,
  name               varchar,
  category_id        int,
  category_name      varchar,
  type               varchar,
  weight_value       numeric,
  weight_unit        varchar,
  mrp                numeric,
  purchase_price     numeric,
  gst                numeric,
  active             boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.barcode, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.is_deleted = false
    -- Tokenised search — see fn_product_list (phase1_procedures.sql) for
    -- the full rationale. MUST STAY IN SYNC with fn_product_count below +
    -- fn_product_list. 10-Jul-2026, client feedback: 'nat.kam' returned
    -- No options because the label had a space, not a dot.
    AND (p_search IS NULL OR trim(p_search) = ''
         OR NOT EXISTS (
           SELECT 1
           FROM regexp_split_to_table(lower(trim(p_search)), '[^a-z0-9]+') AS tok
           WHERE tok <> ''
             AND strpos(lower(p.code || ' ' || p.name), tok) = 0
         ))
    AND (p_category_ids IS NULL OR cardinality(p_category_ids) = 0
         OR p.category_id = ANY(p_category_ids))
    AND (p_types IS NULL OR cardinality(p_types) = 0
         OR p.type = ANY(p_types))
  ORDER BY p.code
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;
