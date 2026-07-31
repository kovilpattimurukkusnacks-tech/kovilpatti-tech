-- ============================================================
-- Phase 5 — Vendor Purchases (5a foundation + 5b e-way inbound wiring)
-- ============================================================
-- See DB/planned/phase5_vendor_purchases.md + phase5_reconciliation_notes.md.
--
-- `vendors` here uses the exact shape phase4_pos_billing.md Domain 6.7
-- (T21) already specced, since that table was never actually built —
-- Phase 5 creates it. `vendor_purchases` replaces the never-built
-- `vendor_shipments` stand-in with a real header + line-items pair.
--
-- Layout of this file
--   §1-§3  Phase 5a  — vendors, vendor_purchases, vendor_purchase_items
--   §4-§6  Phase 5b  — eway_bills, eway_api_logs, threshold settings
--                       (both-direction schema shipped; Phase 5b writes
--                        only Inbound rows, Phase 4 later writes Outbound)
--
-- Don't run this against a DB that already has a hand-built `vendors`
-- table from Domain 6.7; reconcile shapes first.

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

-- ============================================================
-- Phase 5b — E-way bills (inbound wiring)
-- ============================================================
-- Schema matches phase4_pos_billing.md Domain 6.7 T22 (post-reconciliation)
-- exactly: both directions present, `vendor_purchase_id` FK to Phase 5a's
-- vendor_purchases (replacing the never-built vendor_shipments).
--
-- Phase 5b writes only Inbound rows here (via `fn_eway_bill_record`).
-- Phase 4's outbound e-way wiring (POS bills, stock_requests >= ₹50k) can
-- populate stock_request_id / bill_id later without any schema change.

-- ------------------------------------------------------------
-- 4. eway_bills — both-direction e-way records + GSP metadata
-- ------------------------------------------------------------
CREATE TABLE eway_bills (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 12-digit portal-issued number. NOT locally sequenced — for Phase 5b
  -- it's the client keying in what the GST portal returned; Phase 5c
  -- (GSP integration) will still store the portal-issued number here.
  eway_number           varchar(20)   NOT NULL,
  generation_date       timestamptz,

  direction             varchar(10)   NOT NULL,

  -- Parent link — exactly ONE populated per direction (see check below).
  stock_request_id      uuid          REFERENCES stock_requests(id)   ON DELETE RESTRICT,
  bill_id               uuid          REFERENCES bills(id)            ON DELETE RESTRICT,
  vendor_purchase_id    uuid          REFERENCES vendor_purchases(id) ON DELETE RESTRICT,

  -- Supply classification (portal fields)
  supply_type           varchar(20),
  sub_type              varchar(30),
  document_type         varchar(20),
  document_number       varchar(40),
  document_date         date,

  -- From / To parties
  from_gstin            varchar(15),
  from_state_code       varchar(2),
  from_address          text,
  to_gstin              varchar(15),
  to_state_code         varchar(2),
  to_address            text,

  -- Transport
  transport_mode        varchar(20),
  distance_km           smallint,
  transporter_name      varchar(120),
  transporter_id        varchar(15),
  transporter_doc_no    varchar(40),
  transporter_doc_date  date,
  vehicle_number        varchar(20),
  vehicle_type          varchar(20),

  -- Money — CGST+SGST XOR IGST (never both), enforced below.
  taxable_amount        numeric(12,2),
  cgst_amount           numeric(12,2) NOT NULL DEFAULT 0,
  sgst_amount           numeric(12,2) NOT NULL DEFAULT 0,
  igst_amount           numeric(12,2) NOT NULL DEFAULT 0,
  total_amount          numeric(12,2),

  -- Validity + status
  valid_from            timestamptz,
  valid_until           timestamptz,
  status                varchar(20)   NOT NULL DEFAULT 'Generated',
  cancellation_reason   text,
  cancelled_at          timestamptz,
  cancelled_by          uuid          REFERENCES users(id) ON DELETE SET NULL,

  -- GSP integration metadata — 'Manual' for Phase 5b, 'API' comes in 5c.
  generated_via         varchar(20)   NOT NULL DEFAULT 'Manual',
  gsp_request_id        varchar(50),
  gsp_response_status   varchar(20),

  attachment_url        text,
  notes                 text,

  is_deleted            boolean       NOT NULL DEFAULT false,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  created_by            uuid          REFERENCES users(id) ON DELETE SET NULL,
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  updated_by            uuid          REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT chk_eway_bills_direction
    CHECK (direction IN ('Inbound','Outbound')),
  CONSTRAINT chk_eway_bills_status
    CHECK (status IN ('Draft','Generated','Cancelled','Expired')),
  CONSTRAINT chk_eway_bills_transport_mode
    CHECK (transport_mode IS NULL OR transport_mode IN ('Road','Rail','Air','Ship')),
  CONSTRAINT chk_eway_bills_gstin_lengths
    CHECK ((from_gstin IS NULL OR length(from_gstin) = 15)
       AND (to_gstin   IS NULL OR length(to_gstin)   = 15)),
  CONSTRAINT chk_eway_bills_tax_exclusive
    CHECK (NOT (igst_amount > 0 AND (cgst_amount > 0 OR sgst_amount > 0))),
  CONSTRAINT chk_eway_bills_generated_via
    CHECK (generated_via IN ('Manual','API')),
  -- Direction ↔ parent-FK integrity: exactly one parent populated per direction.
  CONSTRAINT chk_eway_bills_direction_ref CHECK (
    (direction = 'Outbound'
     AND vendor_purchase_id IS NULL
     AND ((stock_request_id IS NOT NULL) <> (bill_id IS NOT NULL))
    )
    OR
    (direction = 'Inbound'
     AND stock_request_id IS NULL
     AND bill_id IS NULL
     AND vendor_purchase_id IS NOT NULL
    )
  )
);

-- Uniqueness on eway_number excludes Cancelled rows so a re-issue reusing
-- the same number after cancel doesn't blow up.
CREATE UNIQUE INDEX uq_eway_bills_number_active
  ON eway_bills(eway_number) WHERE status <> 'Cancelled';
CREATE INDEX idx_eway_bills_direction_date  ON eway_bills(direction, generation_date DESC);
CREATE INDEX idx_eway_bills_stock_request   ON eway_bills(stock_request_id)   WHERE stock_request_id   IS NOT NULL;
CREATE INDEX idx_eway_bills_bill            ON eway_bills(bill_id)            WHERE bill_id            IS NOT NULL;
CREATE INDEX idx_eway_bills_vendor_purchase ON eway_bills(vendor_purchase_id) WHERE vendor_purchase_id IS NOT NULL;

CREATE TRIGGER trg_eway_bills_updated BEFORE UPDATE ON eway_bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 5. eway_api_logs — GSP call audit trail (Phase 5c, table exists day 1)
-- ------------------------------------------------------------
-- Phase 5b never writes here (generated_via='Manual' for every row).
-- Phase 5c's GSP client appends one row per API call for compliance dispute
-- resolution ("GSP says success, portal says not found — who's right?").
CREATE TABLE eway_api_logs (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  eway_bill_id   uuid          REFERENCES eway_bills(id) ON DELETE SET NULL,
  gsp_endpoint   varchar(60)   NOT NULL,
  request_body   jsonb         NOT NULL,
  response_body  jsonb,
  http_status    smallint,
  error_message  text,
  called_at      timestamptz   NOT NULL DEFAULT now(),
  called_by      uuid          REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_eway_api_logs_eway     ON eway_api_logs(eway_bill_id)  WHERE eway_bill_id IS NOT NULL;
CREATE INDEX idx_eway_api_logs_endpoint ON eway_api_logs(gsp_endpoint, called_at DESC);
CREATE INDEX idx_eway_api_logs_time     ON eway_api_logs(called_at DESC);

-- ------------------------------------------------------------
-- 6. Threshold settings — inbound + outbound kept separate per Decision 5
-- ------------------------------------------------------------
-- Seed as '0' = disabled (the receive gate treats 0 as "no threshold, no
-- e-way required at any invoice amount"). Client sets the real number via
-- Settings once GST-Council rules are re-confirmed. '0' is used instead of
-- NULL because app_settings.value is NOT NULL.
--
-- Only eway_bill_threshold_inbound is read by Phase 5b's receive gate;
-- eway_bill_threshold_outbound ships now for Phase 4's outbound wiring
-- to pick up without a second migration.
INSERT INTO app_settings (key, value, description) VALUES
  ('eway_bill_threshold_inbound', '0',
   'Interstate vendor purchase invoice amount (₹) at/above which a Generated inbound e-way bill is required before Ordered→Received. 0 = gate disabled.'),
  ('eway_bill_threshold_outbound', '0',
   'Outbound B2B threshold (₹) — stock request / POS bill amount at/above which an outbound e-way bill is required. Consumed by Phase 4 outbound wiring (not yet built). 0 = gate disabled.')
ON CONFLICT (key) DO NOTHING;
