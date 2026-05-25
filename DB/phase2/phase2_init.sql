-- ============================================================
-- Kovilpatti Snacks — Phase 2 SCHEMA (DDL only — no seed data)
--
-- Adds stock-request workflow tables and app-wide settings.
-- Run AFTER all Phase 1 init + procedure files have been applied.
--
-- TIMEZONE POLICY: all `timestamptz` values are stored in UTC by Postgres
-- but the application treats wall-clock times as Asia/Kolkata (IST, UTC+5:30).
-- The BE converts when computing `editable_until` and the FE renders in IST.
-- ============================================================
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase2/phase2_init.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. Enum — stock request lifecycle
--
-- 'Draft' = shop user's saved-but-not-submitted request. A shop has at most
-- one Draft row at a time (enforced by partial unique index below). Once
-- submitted, the draft row is consumed (deleted) and a fresh Pending row
-- takes its place — so Draft never transitions to other statuses directly.
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE request_status AS ENUM (
    'Draft', 'Pending', 'Approved', 'Rejected', 'Dispatched', 'Received', 'Cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 1. app_settings  — key/value config (cutoff time, etc.)
--    Designed extensible. Phase 2 stores one row (cutoff). Future
--    settings (GST rate, notification toggles, …) reuse this table.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key         varchar(50)   PRIMARY KEY,
  value       varchar(200)  NOT NULL,
  description varchar(250),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  updated_by  uuid          REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO app_settings (key, value, description) VALUES
  ('request_lock_cutoff', '09:00',
   'Daily IST cutoff (HH:MM) after which shop requests lock. Only admin may edit thereafter.')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 2. stock_requests  — header
--    One row per shop's bulk order. Aggregates total_items/qty/amount
--    so list views don't have to re-aggregate items per row.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_requests (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  code              varchar(20)    UNIQUE NOT NULL,
  shop_id           uuid           NOT NULL REFERENCES shops(id)       ON DELETE RESTRICT,
  inventory_id      uuid           NOT NULL REFERENCES inventories(id) ON DELETE RESTRICT,
  status            request_status NOT NULL DEFAULT 'Pending',

  -- Cached aggregates (kept in sync by the stored procs that mutate items).
  total_items       int            NOT NULL DEFAULT 0,
  total_qty         int            NOT NULL DEFAULT 0,
  total_amount      numeric(12,2)  NOT NULL DEFAULT 0,

  notes             varchar(500),
  rejection_reason  varchar(500),

  -- Editability window: shop can edit/cancel only while NOW() <= editable_until.
  -- Computed in BE at submit time from app_settings.request_lock_cutoff (IST).
  editable_until    timestamptz    NOT NULL,

  submitted_at      timestamptz    NOT NULL DEFAULT now(),
  approved_at       timestamptz,
  approved_by       uuid           REFERENCES users(id) ON DELETE SET NULL,
  dispatched_at     timestamptz,
  dispatched_by     uuid           REFERENCES users(id) ON DELETE SET NULL,
  received_at       timestamptz,
  received_by       uuid           REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at      timestamptz,
  cancelled_by      uuid           REFERENCES users(id) ON DELETE SET NULL,

  is_deleted        boolean        NOT NULL DEFAULT false,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  created_by        uuid           REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  updated_by        uuid           REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT chk_rejection_reason_when_rejected
    CHECK (status <> 'Rejected' OR rejection_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_stock_requests_shop_status
  ON stock_requests(shop_id, status) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_stock_requests_inventory_status
  ON stock_requests(inventory_id, status) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_stock_requests_status_submitted
  ON stock_requests(status, submitted_at DESC) WHERE is_deleted = false;

-- One live draft per shop. Partial unique index — only enforces uniqueness
-- on the Draft status (Pending/Dispatched/etc. rows are unaffected). Lets
-- the DB itself reject a second draft insert; the BE can rely on this and
-- treat duplicate_object as "another tab beat me" rather than coding a
-- race-prone read-then-write.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_requests_one_draft_per_shop
  ON stock_requests(shop_id)
  WHERE status = 'Draft' AND is_deleted = false;

-- ------------------------------------------------------------
-- 3. stock_request_items  — line items (one row per product per request)
--    UNIQUE(request_id, product_id) — same product can't appear twice
--    in the same request. Shop must aggregate qty themselves.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_request_items (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid          NOT NULL REFERENCES stock_requests(id) ON DELETE CASCADE,
  product_id      uuid          NOT NULL REFERENCES products(id)       ON DELETE RESTRICT,

  requested_qty   int           NOT NULL,
  dispatched_qty  int,                                                  -- NULL until dispatch
  -- Inventory user's saved-but-not-finalised dispatch quantity (the WIP
  -- "Save as Draft" on the dispatch screen). NULL when no draft is in
  -- flight. Cleared by fn_request_dispatch when the dispatch is finalised.
  draft_dispatched_qty int,
  unit_price      numeric(10,2) NOT NULL,                               -- snapshot of products.mrp at submit
  -- Snapshot of the product's pack size at request time so the audit/history
  -- view doesn't silently change if the product's master record is later edited.
  weight_value    numeric(10,3),
  weight_unit     varchar(5),

  -- Generated column: line subtotal at request-time pricing.
  -- (When dispatched_qty differs, the BE can present a separate dispatched-subtotal at runtime.)
  subtotal        numeric(12,2) GENERATED ALWAYS AS (requested_qty * unit_price) STORED,

  created_at      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_stock_request_items UNIQUE (request_id, product_id),
  CONSTRAINT chk_requested_qty_positive CHECK (requested_qty > 0),
  -- Lower bound only — the upper-bound cap (≤ requested_qty) was removed
  -- on client request so inventory can dispatch more than originally
  -- requested (e.g. forced minimum case-size, last-mile rounding).
  CONSTRAINT chk_dispatched_qty_bounds
    CHECK (dispatched_qty IS NULL OR dispatched_qty >= 0),
  CONSTRAINT chk_draft_dispatched_qty_bounds
    CHECK (draft_dispatched_qty IS NULL OR draft_dispatched_qty >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_request_items_request ON stock_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_stock_request_items_product ON stock_request_items(product_id);

-- ------------------------------------------------------------
-- 4. updated_at triggers (reuse Phase 1's set_updated_at function)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_stock_requests_updated ON stock_requests;
CREATE TRIGGER trg_stock_requests_updated BEFORE UPDATE ON stock_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_app_settings_updated ON app_settings;
CREATE TRIGGER trg_app_settings_updated BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- \dt stock_requests stock_request_items app_settings
-- SELECT * FROM app_settings;          -- should show one row: request_lock_cutoff = '09:00'
-- ============================================================
