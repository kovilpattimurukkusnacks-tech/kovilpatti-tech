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
-- 3. Stock-take — REMOVED 2026-08-03.
--
-- Previously defined `stock_take_code_seq` + `shop_stock_takes` +
-- `shop_stock_take_items`. Deleted along with the FE screens + BE
-- controllers because the feature wasn't landing cleanly. If it
-- comes back, restore from git history at commit before this line.
-- Historical `shop_inventory_movements` rows with `ref_type='StockTake'`
-- stay in the ledger — they've already applied to on_hand and count
-- as audit history.
-- ------------------------------------------------------------


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
