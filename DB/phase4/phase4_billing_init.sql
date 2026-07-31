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
-- 1b. customers — per-shop, phone-identified (features #6 + #4).
--     Created before bills so bills.customer_id can reference it.
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
-- 2. bills — invoice header
--    No status machine beyond Issued → Cancelled: a counter sale is
--    complete the instant it's created.
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS bill_code_seq START 1;

CREATE TABLE IF NOT EXISTS bills (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(20)   NOT NULL DEFAULT 'BILL' || lpad(nextval('bill_code_seq')::text, 4, '0'),
  shop_id        uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  -- Optional customer (walk-in = NULL); required for a Credit tender.
  customer_id    uuid          NULL REFERENCES customers(id) ON DELETE SET NULL,
  status         varchar(20)   NOT NULL DEFAULT 'Issued',
  payment_mode   varchar(10)   NOT NULL,
  -- Cached aggregates, kept in sync by fn_bill_create (same pattern as
  -- stock_requests.total_items/total_qty/total_amount).
  total_items    int           NOT NULL DEFAULT 0,
  total_qty      int           NOT NULL DEFAULT 0,
  total_amount   numeric(12,2) NOT NULL DEFAULT 0,
  notes          varchar(500)  NULL,
  -- Cancellation trail — set together by fn_bill_cancel.
  cancelled_at       timestamptz NULL,
  cancelled_by       uuid        NULL REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason_type varchar(20) NULL,   -- Mistake | Duplicate | CustomerRefused | Other
  cancel_reason      varchar(500) NULL,  -- free-text note
  is_deleted     boolean       NOT NULL DEFAULT false,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_bills_code UNIQUE (code),
  CONSTRAINT chk_bills_status       CHECK (status IN ('Issued','Cancelled')),
  -- 'Split' is a summary label for bills with more than one tender
  -- (breakdown lives in bill_payments); 'Credit' = single credit tender.
  CONSTRAINT chk_bills_payment_mode CHECK (payment_mode IN ('Cash','UPI','Split','Credit')),
  CONSTRAINT chk_bills_totals_nonneg
    CHECK (total_items >= 0 AND total_qty >= 0 AND total_amount >= 0),
  CONSTRAINT chk_bills_cancelled_pair
    CHECK ((status = 'Cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT chk_bills_cancel_reason_type
    CHECK (cancel_reason_type IS NULL
           OR cancel_reason_type IN ('Mistake','Duplicate','CustomerRefused','Other'))
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


-- ------------------------------------------------------------
-- 3b. bill_payments — one row per tender (feature #5, split payment).
--     A bill with a single tender still gets one row; 'Split' on the
--     header means jsonb had > 1 tender. Cash/UPI only for now.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_payments (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id     uuid          NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  mode        varchar(10)   NOT NULL,
  amount      numeric(12,2) NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_bill_payments_mode       CHECK (mode IN ('Cash','UPI','Credit')),
  CONSTRAINT chk_bill_payments_amount_pos CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);


-- ------------------------------------------------------------
-- 3c. customer_credit_ledger — one row per credit taken / settlement
--     paid (feature #4). References bills, so created after bills.
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
-- 3d. held_bills + held_bill_items — parked drafts (feature #3).
--     A draft consumes no stock and burns no bill code; finalising a
--     resumed draft goes through fn_bill_create normally.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS held_bills (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  customer_id  uuid          NULL REFERENCES customers(id) ON DELETE SET NULL,
  label        varchar(120)  NULL,
  note         varchar(500)  NULL,
  total_qty    int           NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  created_by   uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  updated_by   uuid          REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_held_bills_shop ON held_bills(shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS held_bill_items (
  id            uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  held_bill_id  uuid  NOT NULL REFERENCES held_bills(id) ON DELETE CASCADE,
  product_id    uuid  NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty           int   NOT NULL,
  CONSTRAINT uq_held_bill_items_bill_product UNIQUE (held_bill_id, product_id),
  CONSTRAINT chk_held_bill_items_qty_pos CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_held_bill_items_bill ON held_bill_items(held_bill_id);

DROP TRIGGER IF EXISTS trg_held_bills_updated ON held_bills;
CREATE TRIGGER trg_held_bills_updated BEFORE UPDATE ON held_bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- updated_at trigger — same set_updated_at() from phase 1.
DROP TRIGGER IF EXISTS trg_bills_updated ON bills;
CREATE TRIGGER trg_bills_updated BEFORE UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 4. bill_returns + bill_return_items — Return Bill (feature #1).
--    Cash/UPI refund, partial + full returns (qty capped at billed −
--    already-returned in fn_bill_return_create). A bill may have several
--    partial returns; each is its own header linked by source_bill_id.
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS bill_return_code_seq START 1;

CREATE TABLE IF NOT EXISTS bill_returns (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code             varchar(20)   NOT NULL DEFAULT 'RET' || lpad(nextval('bill_return_code_seq')::text, 4, '0'),
  source_bill_id   uuid          NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  shop_id          uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  refund_mode      varchar(10)   NOT NULL,
  reason_type      varchar(20)   NOT NULL,
  reason_note      varchar(500)  NULL,
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

CREATE TABLE IF NOT EXISTS bill_return_items (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id    uuid          NOT NULL REFERENCES bill_returns(id) ON DELETE CASCADE,
  product_id   uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty          int           NOT NULL,
  -- Snapshot of the price actually charged on the source bill line.
  unit_price   numeric(10,2) NOT NULL,
  line_total   numeric(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED,
  CONSTRAINT uq_bill_return_items_return_product UNIQUE (return_id, product_id),
  CONSTRAINT chk_bill_return_items_qty_pos      CHECK (qty > 0),
  CONSTRAINT chk_bill_return_items_price_nonneg CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_return_items_return  ON bill_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_bill_return_items_product ON bill_return_items(product_id);

DROP TRIGGER IF EXISTS trg_bill_returns_updated ON bill_returns;
CREATE TRIGGER trg_bill_returns_updated BEFORE UPDATE ON bill_returns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 5. Billing settings. Requires app_settings from phase2_init.sql.
-- ------------------------------------------------------------
INSERT INTO app_settings (key, value, description) VALUES
  ('customer_credit_limit_default', '5000',
   'Default per-customer credit limit (₹) applied to new customers. 0 = no limit.')
ON CONFLICT (key) DO NOTHING;

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
