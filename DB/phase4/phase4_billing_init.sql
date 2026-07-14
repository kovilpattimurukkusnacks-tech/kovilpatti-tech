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
