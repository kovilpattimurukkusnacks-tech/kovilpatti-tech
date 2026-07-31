-- ============================================================
-- Phase 5 — Vendor Purchases (Phase 5a: foundation, no e-way wiring)
-- ============================================================
-- See DB/planned/phase5_vendor_purchases.md + phase5_reconciliation_notes.md.
--
-- `vendors` here uses the exact shape phase4_pos_billing.md Domain 6.7
-- (T21) already specced, since that table was never actually built —
-- Phase 5 creates it. `vendor_purchases` replaces the never-built
-- `vendor_shipments` stand-in with a real header + line-items pair.
--
-- Deliberately OUT of this slice (Phase 5a): e-way bill fields/wiring.
-- `eway_bills` doesn't exist in this codebase yet (still design-only in
-- phase4_pos_billing.md Domain 6.7) and the eway_bill_threshold value is
-- still unconfirmed (see reconciliation notes Decision 5) — Phase 5b adds
-- both once that's settled. Don't run this against a DB that already has
-- a hand-built `vendors` table from Domain 6.7; reconcile shapes first.

-- ------------------------------------------------------------
-- 1. vendors — bare-bones master
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_vendor_code START 1;

CREATE TABLE vendors (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(20)   UNIQUE NOT NULL,
  name           varchar(120)  NOT NULL,
  gstin          varchar(15),
  -- 2-digit GST state code (e.g. '33' = Tamil Nadu), NOT a free-text state
  -- name — `is_interstate` on vendor_purchases derives from this.
  state_code     varchar(2),
  address        varchar(250),
  contact_person varchar(120),
  contact_phone  varchar(20),
  email          varchar(120),
  active         boolean       NOT NULL DEFAULT true,
  is_deleted     boolean       NOT NULL DEFAULT false,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid          REFERENCES users(id) ON DELETE SET NULL,
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_vendors_gstin_length CHECK (gstin IS NULL OR length(gstin) = 15)
);

CREATE INDEX idx_vendors_active ON vendors(active) WHERE is_deleted = false;
CREATE INDEX idx_vendors_gstin  ON vendors(gstin)  WHERE gstin IS NOT NULL;

CREATE TRIGGER trg_vendors_updated BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 2. vendor_purchases — header (replaces the never-built vendor_shipments)
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_vendor_purchase_code START 1;

CREATE TABLE vendor_purchases (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code             varchar(20)   UNIQUE NOT NULL,      -- PUR0001
  vendor_id        uuid          NOT NULL REFERENCES vendors(id)     ON DELETE RESTRICT,
  godown_id        uuid          NOT NULL REFERENCES inventories(id) ON DELETE RESTRICT,

  -- Derived at insert from vendors.state_code <> '33' (Tamil Nadu). Not
  -- user-editable — frozen even if the vendor's state is edited later.
  is_interstate    boolean       NOT NULL DEFAULT false,

  invoice_number   varchar(60)   NOT NULL,
  invoice_date     date          NOT NULL,
  invoice_amount   numeric(12,2) NOT NULL,

  status           varchar(20)   NOT NULL DEFAULT 'Ordered',

  total_items      int           NOT NULL DEFAULT 0,
  total_qty        numeric(12,3) NOT NULL DEFAULT 0,
  total_amount     numeric(12,2) NOT NULL DEFAULT 0,

  notes            varchar(500),

  received_at      timestamptz,
  received_by      uuid          REFERENCES users(id) ON DELETE SET NULL,

  is_deleted       boolean       NOT NULL DEFAULT false,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  created_by       uuid          REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  updated_by       uuid          REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT chk_vendor_purchases_status CHECK (status IN ('Ordered', 'Received')),
  CONSTRAINT chk_vendor_purchases_amounts_nonneg CHECK (invoice_amount >= 0 AND total_amount >= 0),
  CONSTRAINT chk_vendor_purchases_received_pair
    CHECK ((status = 'Received') = (received_at IS NOT NULL))
);

CREATE INDEX idx_vendor_purchases_vendor_date ON vendor_purchases(vendor_id, invoice_date DESC);
CREATE INDEX idx_vendor_purchases_godown      ON vendor_purchases(godown_id);
CREATE INDEX idx_vendor_purchases_status      ON vendor_purchases(status) WHERE is_deleted = false;
CREATE INDEX idx_vendor_purchases_interstate  ON vendor_purchases(is_interstate) WHERE is_deleted = false;

CREATE TRIGGER trg_vendor_purchases_updated BEFORE UPDATE ON vendor_purchases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 3. vendor_purchase_items — lines (snapshot pricing, same rationale as
--    stock_request_items.unit_price / purchase_price_snapshot)
-- ------------------------------------------------------------
CREATE TABLE vendor_purchase_items (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id    uuid          NOT NULL REFERENCES vendor_purchases(id) ON DELETE CASCADE,
  product_id     uuid          NOT NULL REFERENCES products(id)         ON DELETE RESTRICT,

  qty            numeric(12,3) NOT NULL,
  -- Purchase cost negotiated with the vendor for this line — NOT the
  -- product master's purchase_price, and not auto-resolved like
  -- stock_request_items.unit_price (MRP) is. Client-supplied, frozen here.
  unit_cost      numeric(10,2) NOT NULL,
  line_total     numeric(12,2) GENERATED ALWAYS AS (qty * unit_cost) STORED,

  -- Snapshot from products at insert time — frozen even if the product
  -- master's weight changes later.
  weight_value   numeric(10,3),
  weight_unit    varchar(10),

  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_vendor_purchase_items_qty_pos      CHECK (qty > 0),
  CONSTRAINT chk_vendor_purchase_items_cost_nonneg  CHECK (unit_cost >= 0)
);

CREATE INDEX idx_vendor_purchase_items_purchase ON vendor_purchase_items(purchase_id);
CREATE INDEX idx_vendor_purchase_items_product  ON vendor_purchase_items(product_id);

CREATE TRIGGER trg_vendor_purchase_items_updated BEFORE UPDATE ON vendor_purchase_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
