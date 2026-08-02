-- ============================================================
-- Phase 5b — E-way bills inbound wiring (upgrade-only)
-- ------------------------------------------------------------
-- Brings a live DB that already has Phase 5a (vendors, vendor_purchases,
-- vendor_purchase_items) up to the current baseline in
-- DB/phase5/phase5_init.sql + phase5_procedures.sql.
--
-- What ships here:
--   1. eway_bills table (both-direction schema, only Inbound written by
--      Phase 5b; Outbound rows will come later from Phase 4).
--   2. eway_api_logs table (dormant — Phase 5c GSP integration populates it).
--   3. Two app_settings rows: eway_bill_threshold_inbound / _outbound,
--      both seeded '0' = gate disabled.
--   4. fn_vendor_purchase_receive updated to return varchar status code
--      ('ok' | 'not_found' | 'eway_required') with the inbound gate.
--   5. fn_vendor_purchase_list_paged updated to include eway_status column
--      for the AdminPurchases chip column.
--   6. New helpers: fn_eway_threshold_get, fn_eway_bill_record,
--      fn_eway_bill_get, fn_eway_bill_list_for_purchase, fn_eway_bill_cancel.
--
-- Depends on: Phase 5a (vendor_purchases), Phase 4 (bills), Phase 2
-- (app_settings, stock_requests, set_updated_at).
--
-- Author: Ramji J G   —   2026-07-31
-- ============================================================

BEGIN;

-- Guard: fail fast if the required parent tables aren't there. Otherwise the
-- CREATE TABLE FK constraints throw a less helpful error.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='vendor_purchases') THEN
    RAISE EXCEPTION 'phase5b requires vendor_purchases (Phase 5a). Run phase5/phase5_init.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bills') THEN
    RAISE EXCEPTION 'phase5b requires bills (Phase 4). Run phase4/phase4_billing_init.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_settings') THEN
    RAISE EXCEPTION 'phase5b requires app_settings (Phase 2). Run phase2/phase2_init.sql first.';
  END IF;
END$$;

-- ------------------------------------------------------------
-- 1. eway_bills — both-direction e-way records
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eway_bills (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  eway_number           varchar(20)   NOT NULL,
  generation_date       timestamptz,
  direction             varchar(10)   NOT NULL,
  stock_request_id      uuid          REFERENCES stock_requests(id)   ON DELETE RESTRICT,
  bill_id               uuid          REFERENCES bills(id)            ON DELETE RESTRICT,
  vendor_purchase_id    uuid          REFERENCES vendor_purchases(id) ON DELETE RESTRICT,
  supply_type           varchar(20),
  sub_type              varchar(30),
  document_type         varchar(20),
  document_number       varchar(40),
  document_date         date,
  from_gstin            varchar(15),
  from_state_code       varchar(2),
  from_address          text,
  to_gstin              varchar(15),
  to_state_code         varchar(2),
  to_address            text,
  transport_mode        varchar(20),
  distance_km           smallint,
  transporter_name      varchar(120),
  transporter_id        varchar(15),
  transporter_doc_no    varchar(40),
  transporter_doc_date  date,
  vehicle_number        varchar(20),
  vehicle_type          varchar(20),
  taxable_amount        numeric(12,2),
  cgst_amount           numeric(12,2) NOT NULL DEFAULT 0,
  sgst_amount           numeric(12,2) NOT NULL DEFAULT 0,
  igst_amount           numeric(12,2) NOT NULL DEFAULT 0,
  total_amount          numeric(12,2),
  valid_from            timestamptz,
  valid_until           timestamptz,
  status                varchar(20)   NOT NULL DEFAULT 'Generated',
  cancellation_reason   text,
  cancelled_at          timestamptz,
  cancelled_by          uuid          REFERENCES users(id) ON DELETE SET NULL,
  generated_via         varchar(20)   NOT NULL DEFAULT 'Manual',
  gsp_request_id        varchar(50),
  gsp_response_status   varchar(20),
  attachment_url        text,
  notes                 text,
  is_deleted            boolean       NOT NULL DEFAULT false,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  created_by            uuid          REFERENCES users(id) ON DELETE SET NULL,
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  updated_by            uuid          REFERENCES users(id) ON DELETE SET NULL
);

-- CHECK constraints — idempotent via pg_constraint lookup.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_eway_bills_direction') THEN
    ALTER TABLE eway_bills ADD CONSTRAINT chk_eway_bills_direction
      CHECK (direction IN ('Inbound','Outbound'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_eway_bills_status') THEN
    ALTER TABLE eway_bills ADD CONSTRAINT chk_eway_bills_status
      CHECK (status IN ('Draft','Generated','Cancelled','Expired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_eway_bills_transport_mode') THEN
    ALTER TABLE eway_bills ADD CONSTRAINT chk_eway_bills_transport_mode
      CHECK (transport_mode IS NULL OR transport_mode IN ('Road','Rail','Air','Ship'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_eway_bills_gstin_lengths') THEN
    ALTER TABLE eway_bills ADD CONSTRAINT chk_eway_bills_gstin_lengths
      CHECK ((from_gstin IS NULL OR length(from_gstin) = 15)
         AND (to_gstin   IS NULL OR length(to_gstin)   = 15));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_eway_bills_tax_exclusive') THEN
    ALTER TABLE eway_bills ADD CONSTRAINT chk_eway_bills_tax_exclusive
      CHECK (NOT (igst_amount > 0 AND (cgst_amount > 0 OR sgst_amount > 0)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_eway_bills_generated_via') THEN
    ALTER TABLE eway_bills ADD CONSTRAINT chk_eway_bills_generated_via
      CHECK (generated_via IN ('Manual','API'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_eway_bills_direction_ref') THEN
    ALTER TABLE eway_bills ADD CONSTRAINT chk_eway_bills_direction_ref CHECK (
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
    );
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_eway_bills_number_active
  ON eway_bills(eway_number) WHERE status <> 'Cancelled';
CREATE INDEX IF NOT EXISTS idx_eway_bills_direction_date  ON eway_bills(direction, generation_date DESC);
CREATE INDEX IF NOT EXISTS idx_eway_bills_stock_request   ON eway_bills(stock_request_id)   WHERE stock_request_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eway_bills_bill            ON eway_bills(bill_id)            WHERE bill_id            IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eway_bills_vendor_purchase ON eway_bills(vendor_purchase_id) WHERE vendor_purchase_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_eway_bills_updated') THEN
    CREATE TRIGGER trg_eway_bills_updated BEFORE UPDATE ON eway_bills
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END$$;

-- ------------------------------------------------------------
-- 2. eway_api_logs — GSP audit trail (dormant in Phase 5b)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eway_api_logs (
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

CREATE INDEX IF NOT EXISTS idx_eway_api_logs_eway     ON eway_api_logs(eway_bill_id)  WHERE eway_bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eway_api_logs_endpoint ON eway_api_logs(gsp_endpoint, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_eway_api_logs_time     ON eway_api_logs(called_at DESC);

-- ------------------------------------------------------------
-- 3. Threshold settings — seed as '0' = disabled
-- ------------------------------------------------------------
INSERT INTO app_settings (key, value, description) VALUES
  ('eway_bill_threshold_inbound', '0',
   'Interstate vendor purchase invoice amount (₹) at/above which a Generated inbound e-way bill is required before Ordered→Received. 0 = gate disabled.'),
  ('eway_bill_threshold_outbound', '0',
   'Outbound B2B threshold (₹) — stock request / POS bill amount at/above which an outbound e-way bill is required. Consumed by Phase 4 outbound wiring (not yet built). 0 = gate disabled.')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 4. fn_vendor_purchase_receive — signature changes bool → varchar
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_vendor_purchase_receive(uuid, uuid);

CREATE OR REPLACE FUNCTION fn_vendor_purchase_receive(p_id uuid, p_user_id uuid)
RETURNS varchar
LANGUAGE plpgsql AS $$
DECLARE
  v_purchase       vendor_purchases%ROWTYPE;
  v_threshold_txt  varchar;
  v_threshold      numeric(12,2);
  v_gate_applies   boolean;
  v_has_eway       boolean;
BEGIN
  SELECT * INTO v_purchase
  FROM vendor_purchases
  WHERE id = p_id AND status = 'Ordered' AND is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF v_purchase.is_interstate THEN
    SELECT value INTO v_threshold_txt FROM app_settings WHERE key = 'eway_bill_threshold_inbound';
    v_threshold := COALESCE(NULLIF(v_threshold_txt, '')::numeric(12,2), 0);
    v_gate_applies := v_threshold > 0 AND v_purchase.invoice_amount >= v_threshold;

    IF v_gate_applies THEN
      SELECT EXISTS (
        SELECT 1 FROM eway_bills eb
        WHERE eb.vendor_purchase_id = p_id
          AND eb.direction          = 'Inbound'
          AND eb.status             = 'Generated'
          AND eb.is_deleted         = false
      ) INTO v_has_eway;

      IF NOT v_has_eway THEN RETURN 'eway_required'; END IF;
    END IF;
  END IF;

  UPDATE vendor_purchases
  SET status='Received', received_at=now(), received_by=p_user_id, updated_by=p_user_id
  WHERE id = p_id;

  RETURN 'ok';
END;
$$;

-- ------------------------------------------------------------
-- 5. fn_vendor_purchase_list_paged — adds eway_status column
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_vendor_purchase_list_paged(int, int, uuid, uuid, varchar, boolean, date, date, varchar);

CREATE OR REPLACE FUNCTION fn_vendor_purchase_list_paged(
  p_page          int     DEFAULT 1,
  p_page_size     int     DEFAULT 10,
  p_vendor_id     uuid    DEFAULT NULL,
  p_godown_id     uuid    DEFAULT NULL,
  p_status        varchar DEFAULT NULL,
  p_is_interstate boolean DEFAULT NULL,
  p_from_date     date    DEFAULT NULL,
  p_to_date       date    DEFAULT NULL,
  p_search        varchar DEFAULT NULL
)
RETURNS TABLE (
  id              uuid,
  code            varchar,
  vendor_id       uuid,
  vendor_code     varchar,
  vendor_name     varchar,
  godown_id       uuid,
  godown_code     varchar,
  godown_name     varchar,
  is_interstate   boolean,
  invoice_number  varchar,
  invoice_date    date,
  invoice_amount  numeric,
  status          varchar,
  total_items     int,
  total_qty       numeric,
  total_amount    numeric,
  notes           varchar,
  received_at     timestamptz,
  received_by_name varchar,
  created_at      timestamptz,
  eway_status     varchar
)
LANGUAGE sql STABLE AS $$
  WITH thr AS (
    SELECT COALESCE(NULLIF(value, '')::numeric(12,2), 0) AS v
    FROM app_settings WHERE key = 'eway_bill_threshold_inbound'
  )
  SELECT p.id, p.code,
         p.vendor_id, v.code, v.name,
         p.godown_id, i.code, i.name,
         p.is_interstate, p.invoice_number, p.invoice_date, p.invoice_amount,
         p.status, p.total_items, p.total_qty, p.total_amount, p.notes,
         p.received_at, ur.full_name AS received_by_name,
         p.created_at,
         CASE
           WHEN NOT p.is_interstate                    THEN 'NotRequired'
           WHEN (SELECT v FROM thr) = 0                THEN 'NotRequired'
           WHEN p.invoice_amount < (SELECT v FROM thr) THEN 'NotRequired'
           WHEN EXISTS (SELECT 1 FROM eway_bills eb
             WHERE eb.vendor_purchase_id = p.id
               AND eb.direction='Inbound' AND eb.status='Generated' AND eb.is_deleted=false)
                                                       THEN 'Attached'
           ELSE                                              'Missing'
         END::varchar
  FROM vendor_purchases p
  INNER JOIN vendors     v ON v.id = p.vendor_id
  INNER JOIN inventories i ON i.id = p.godown_id
  LEFT JOIN  users      ur ON ur.id = p.received_by
  WHERE p.is_deleted = false
    AND (p_vendor_id     IS NULL OR p.vendor_id = p_vendor_id)
    AND (p_godown_id     IS NULL OR p.godown_id = p_godown_id)
    AND (p_status        IS NULL OR p.status = p_status)
    AND (p_is_interstate IS NULL OR p.is_interstate = p_is_interstate)
    AND (p_from_date     IS NULL OR p.invoice_date >= p_from_date)
    AND (p_to_date       IS NULL OR p.invoice_date < (p_to_date + 1))
    AND (p_search IS NULL
         OR p.code ILIKE '%' || p_search || '%'
         OR v.name ILIKE '%' || p_search || '%'
         OR p.invoice_number ILIKE '%' || p_search || '%')
  ORDER BY p.invoice_date DESC, p.code DESC
  OFFSET GREATEST(p_page - 1, 0) * p_page_size
  LIMIT  p_page_size;
$$;

-- ------------------------------------------------------------
-- 6. E-way helper SPs (bodies identical to phase5_procedures.sql)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_eway_threshold_get(p_direction varchar)
RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_key varchar; v_txt varchar;
BEGIN
  v_key := CASE p_direction
             WHEN 'Inbound'  THEN 'eway_bill_threshold_inbound'
             WHEN 'Outbound' THEN 'eway_bill_threshold_outbound'
             ELSE NULL
           END;
  IF v_key IS NULL THEN RETURN 0; END IF;
  SELECT value INTO v_txt FROM app_settings WHERE key = v_key;
  RETURN COALESCE(NULLIF(v_txt, '')::numeric(12,2), 0);
END;
$$;

CREATE OR REPLACE FUNCTION fn_eway_bill_record(
  p_purchase_id       uuid,
  p_eway_number       varchar,
  p_generation_date   timestamptz,
  p_document_number   varchar,
  p_document_date     date,
  p_valid_until       timestamptz,
  p_from_gstin        varchar,
  p_from_state_code   varchar,
  p_to_gstin          varchar,
  p_to_state_code     varchar,
  p_transport_mode    varchar,
  p_distance_km       int,
  p_transporter_name  varchar,
  p_vehicle_number    varchar,
  p_taxable_amount    numeric,
  p_cgst_amount       numeric,
  p_sgst_amount       numeric,
  p_igst_amount       numeric,
  p_total_amount      numeric,
  p_attachment_url    text,
  p_notes             text,
  p_user_id           uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vendor_purchases WHERE id = p_purchase_id AND is_deleted = false) THEN
    RAISE EXCEPTION 'Vendor purchase % not found', p_purchase_id;
  END IF;
  SELECT id INTO v_id FROM eway_bills
   WHERE vendor_purchase_id = p_purchase_id AND eway_number = p_eway_number AND is_deleted = false
   LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  INSERT INTO eway_bills (
    eway_number, generation_date, direction, vendor_purchase_id,
    supply_type, sub_type, document_type, document_number, document_date,
    from_gstin, from_state_code, to_gstin, to_state_code,
    transport_mode, distance_km, transporter_name, vehicle_number,
    taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
    valid_from, valid_until, status, generated_via,
    attachment_url, notes, created_by, updated_by
  ) VALUES (
    p_eway_number, COALESCE(p_generation_date, now()), 'Inbound', p_purchase_id,
    'Inward', 'Supply', 'TaxInvoice', p_document_number, p_document_date,
    p_from_gstin, p_from_state_code, p_to_gstin, p_to_state_code,
    p_transport_mode, p_distance_km, p_transporter_name, p_vehicle_number,
    p_taxable_amount, COALESCE(p_cgst_amount, 0), COALESCE(p_sgst_amount, 0),
    COALESCE(p_igst_amount, 0), p_total_amount,
    COALESCE(p_generation_date, now()), p_valid_until, 'Generated', 'Manual',
    p_attachment_url, p_notes, p_user_id, p_user_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_eway_bill_get(p_id uuid)
RETURNS TABLE (
  id uuid, eway_number varchar, generation_date timestamptz, direction varchar,
  vendor_purchase_id uuid, stock_request_id uuid, bill_id uuid,
  document_number varchar, document_date date,
  from_gstin varchar, from_state_code varchar, to_gstin varchar, to_state_code varchar,
  transport_mode varchar, distance_km smallint, transporter_name varchar, vehicle_number varchar,
  taxable_amount numeric, cgst_amount numeric, sgst_amount numeric, igst_amount numeric, total_amount numeric,
  valid_from timestamptz, valid_until timestamptz,
  status varchar, generated_via varchar,
  attachment_url text, notes text, created_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT eb.id, eb.eway_number, eb.generation_date, eb.direction,
         eb.vendor_purchase_id, eb.stock_request_id, eb.bill_id,
         eb.document_number, eb.document_date,
         eb.from_gstin, eb.from_state_code, eb.to_gstin, eb.to_state_code,
         eb.transport_mode, eb.distance_km, eb.transporter_name, eb.vehicle_number,
         eb.taxable_amount, eb.cgst_amount, eb.sgst_amount, eb.igst_amount, eb.total_amount,
         eb.valid_from, eb.valid_until, eb.status, eb.generated_via,
         eb.attachment_url, eb.notes, eb.created_at
  FROM eway_bills eb
  WHERE eb.id = p_id AND eb.is_deleted = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_eway_bill_list_for_purchase(p_purchase_id uuid)
RETURNS TABLE (
  id uuid, eway_number varchar, generation_date timestamptz, direction varchar,
  vendor_purchase_id uuid, stock_request_id uuid, bill_id uuid,
  document_number varchar, document_date date,
  from_gstin varchar, from_state_code varchar, to_gstin varchar, to_state_code varchar,
  transport_mode varchar, distance_km smallint, transporter_name varchar, vehicle_number varchar,
  taxable_amount numeric, cgst_amount numeric, sgst_amount numeric, igst_amount numeric, total_amount numeric,
  valid_from timestamptz, valid_until timestamptz,
  status varchar, generated_via varchar,
  attachment_url text, notes text, created_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT eb.id, eb.eway_number, eb.generation_date, eb.direction,
         eb.vendor_purchase_id, eb.stock_request_id, eb.bill_id,
         eb.document_number, eb.document_date,
         eb.from_gstin, eb.from_state_code, eb.to_gstin, eb.to_state_code,
         eb.transport_mode, eb.distance_km, eb.transporter_name, eb.vehicle_number,
         eb.taxable_amount, eb.cgst_amount, eb.sgst_amount, eb.igst_amount, eb.total_amount,
         eb.valid_from, eb.valid_until, eb.status, eb.generated_via,
         eb.attachment_url, eb.notes, eb.created_at
  FROM eway_bills eb
  WHERE eb.vendor_purchase_id = p_purchase_id AND eb.is_deleted = false
  ORDER BY eb.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION fn_eway_bill_cancel(p_id uuid, p_reason text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE eway_bills
  SET status='Cancelled', cancellation_reason=p_reason,
      cancelled_at=now(), cancelled_by=p_user_id, updated_by=p_user_id
  WHERE id=p_id AND status='Generated' AND is_deleted=false;
  RETURN FOUND;
END;
$$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- SELECT direction, status FROM eway_bills LIMIT 1;             -- table exists
-- SELECT value FROM app_settings WHERE key LIKE 'eway_bill_%';  -- both '0' rows
-- SELECT fn_eway_threshold_get('Inbound');                      -- 0
-- ============================================================
