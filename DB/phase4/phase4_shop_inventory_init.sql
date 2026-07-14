-- ============================================================
-- Kovilpatti Snacks — Phase 4 · SHOP INVENTORY · SCHEMA (DDL)
--
-- Phase 4 = POS billing + shop inventory. Full plan lives at
-- DB/planned/phase4_pos_billing.md. Each slice of Phase 4 lives in
-- its own paired files:
--   • phase4_shop_inventory_init.sql        (THIS FILE)
--   • phase4_shop_inventory_procedures.sql
-- Future slices (bills, cash, expenses, e-way, vendors, customers,
-- barcodes) will follow the same paired-file pattern.
--
-- Run AFTER phase1 (products, shops, users) + phase2 (stock_requests,
-- stock_request_items). Then run phase4_shop_inventory_procedures.sql.
--
-- TIMEZONE POLICY: same as Phase 2 — all timestamptz in UTC; the app
-- renders in Asia/Kolkata (IST, UTC+5:30). Reporting SPs convert at
-- the boundary via `AT TIME ZONE 'Asia/Kolkata'`.
-- ============================================================
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase4/phase4_shop_inventory_init.sql
-- ============================================================
--
-- SCOPE OF THIS SLICE — shop inventory only:
--   • shop_inventory              (standing on-hand + avg_cost per shop, product)
--   • shop_inventory_movements    (signed ledger — every change writes a row)
--   • shop_stock_takes            (physical count session header)
--   • shop_stock_take_items       (per-product counted qty vs system_qty)
--   • stock_take_code_seq         (STK0001 counter)
--
-- Design notes:
--   • shop_inventory.on_hand + avg_cost is the "current state";
--     shop_inventory_movements is the "how we got here" audit log.
--   • Every write to on_hand goes through fn_shop_inventory_apply_movement
--     (see phase4_shop_inventory_procedures.sql) which row-locks FOR UPDATE
--     — prevents two cashiers overselling the last packet.
--   • Weighted-average cost updates ONLY on Receipt / Opening (goods
--     coming IN with a known unit_cost). Sales / Returns / Adjustments
--     preserve avg_cost.
--   • Stock-take sessions carry a snapshot of system_qty per line so
--     the diff is stable even if operational movements happen mid-count.
-- ============================================================

BEGIN;


-- ------------------------------------------------------------
-- 1. shop_inventory — standing on-hand + avg_cost per (shop, product)
--    Composite PK; every read/write keys by (shop_id, product_id).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_inventory (
  shop_id           uuid          NOT NULL REFERENCES shops(id)    ON DELETE RESTRICT,
  product_id        uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  on_hand           numeric(12,3) NOT NULL DEFAULT 0,
  avg_cost          numeric(10,2) NOT NULL DEFAULT 0,
  last_movement_at  timestamptz   NULL,
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, product_id),
  CONSTRAINT chk_shop_inventory_on_hand_nonneg  CHECK (on_hand  >= 0),
  CONSTRAINT chk_shop_inventory_avg_cost_nonneg CHECK (avg_cost >= 0)
);

CREATE INDEX IF NOT EXISTS idx_shop_inventory_product
  ON shop_inventory(product_id);

-- Partial index for the low-stock report — only rows below the typical
-- reorder point are indexed so the index stays tiny.
CREATE INDEX IF NOT EXISTS idx_shop_inventory_low_stock
  ON shop_inventory(shop_id) WHERE on_hand < 5;


-- ------------------------------------------------------------
-- 2. shop_inventory_movements — signed ledger, one row per change
--    movement_type: Opening / Receipt / Sale / Return / Adjustment / Refund
--    ref_type:      pointer back to the source row (Opening / StockRequest /
--                   Bill / StockTake / ManualAdjustment / BillReturn)
--    qty_after:     running on_hand snapshot after this row — audit + fast
--                   reporting without recomputing from history each time
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_inventory_movements (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid          NOT NULL REFERENCES shops(id)    ON DELETE RESTRICT,
  product_id     uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  movement_type  varchar(20)   NOT NULL,
  qty_delta      numeric(12,3) NOT NULL,
  qty_after      numeric(12,3) NOT NULL,
  unit_cost      numeric(10,2) NULL,
  ref_type       varchar(30)   NOT NULL,
  ref_id         uuid          NULL,
  note           text          NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_shop_inv_mov_type
    CHECK (movement_type IN ('Opening','Receipt','Sale','Return','Adjustment','Refund')),
  CONSTRAINT chk_shop_inv_mov_ref_type
    CHECK (ref_type IN ('Opening','StockRequest','Bill','StockTake','ManualAdjustment','BillReturn')),
  CONSTRAINT chk_shop_inv_mov_qty_after_nonneg CHECK (qty_after >= 0),
  CONSTRAINT chk_shop_inv_mov_delta_nonzero    CHECK (qty_delta <> 0)
);

CREATE INDEX IF NOT EXISTS idx_shop_inv_mov_shop_product_time
  ON shop_inventory_movements(shop_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_inv_mov_ref
  ON shop_inventory_movements(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_shop_inv_mov_created_at
  ON shop_inventory_movements(created_at);


-- ------------------------------------------------------------
-- 3. Stock-take session — code sequence + header + items
--
-- Users can pause a count mid-way (Draft) and resume; on Submit, one
-- Adjustment movement is written per non-zero diff. Only ONE Draft
-- per shop at a time — partial UNIQUE index below enforces.
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS stock_take_code_seq START 1;

CREATE TABLE IF NOT EXISTS shop_stock_takes (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code          varchar(20)   NOT NULL DEFAULT 'STK' || lpad(nextval('stock_take_code_seq')::text, 4, '0'),
  shop_id       uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  status        varchar(20)   NOT NULL DEFAULT 'Draft',
  started_at    timestamptz   NOT NULL DEFAULT now(),
  submitted_at  timestamptz   NULL,
  notes         text          NULL,
  is_deleted    boolean       NOT NULL DEFAULT false,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  updated_by    uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_shop_stock_takes_code UNIQUE (code),
  CONSTRAINT chk_stock_take_status
    CHECK (status IN ('Draft','Submitted','Cancelled')),
  CONSTRAINT chk_stock_take_submitted_pair
    CHECK ((status = 'Submitted') = (submitted_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_takes_one_draft_per_shop
  ON shop_stock_takes(shop_id) WHERE status = 'Draft' AND is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_stock_takes_shop_time
  ON shop_stock_takes(shop_id, started_at DESC);


CREATE TABLE IF NOT EXISTS shop_stock_take_items (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id   uuid          NOT NULL REFERENCES shop_stock_takes(id) ON DELETE CASCADE,
  product_id      uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  system_qty      numeric(12,3) NOT NULL,
  counted_qty     numeric(12,3) NOT NULL,
  -- Generated column — always (counted − system). Read-only from callers.
  qty_diff        numeric(12,3) GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
  note            text          NULL,
  CONSTRAINT uq_stock_take_items_take_product UNIQUE (stock_take_id, product_id),
  CONSTRAINT chk_stock_take_items_counted_nonneg CHECK (counted_qty >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_take_items_take
  ON shop_stock_take_items(stock_take_id);


COMMIT;


-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- After this file commits, confirm the tables + sequence landed:
--
--   SELECT tablename FROM pg_tables
--    WHERE tablename IN ('shop_inventory','shop_inventory_movements',
--                        'shop_stock_takes','shop_stock_take_items')
--    ORDER BY 1;
--
--   SELECT sequencename FROM pg_sequences WHERE sequencename = 'stock_take_code_seq';
--
-- Then run phase4_shop_inventory_procedures.sql to add the SPs.
-- ============================================================
