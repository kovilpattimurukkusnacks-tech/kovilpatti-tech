-- ============================================================
-- Phase 5 — Vendor Purchases: stored procedures (Phase 5a)
-- ============================================================
-- Conventions match phase1 (Shops — master-data CRUD) and phase2
-- (StockRequest — header+items+lifecycle, single jsonb round trip for
-- line items). No RAISE EXCEPTION for business-rule/state guards — those
-- return boolean (RETURN FOUND / early RETURN false) so the C# service
-- layer can turn a false into a clean 400, matching fn_request_receive.

-- ============== Vendors ===========================================

CREATE OR REPLACE FUNCTION fn_vendor_next_code()
RETURNS varchar
LANGUAGE sql AS $$
  SELECT 'VEN' || lpad(nextval('seq_vendor_code')::text, 4, '0');
$$;

CREATE OR REPLACE FUNCTION fn_vendor_list()
RETURNS TABLE (
  id             uuid,
  code           varchar,
  name           varchar,
  gstin          varchar,
  state_code     varchar,
  address        varchar,
  contact_person varchar,
  contact_phone  varchar,
  email          varchar,
  active         boolean
)
LANGUAGE sql STABLE AS $$
  SELECT v.id, v.code, v.name, v.gstin, v.state_code,
         v.address, v.contact_person, v.contact_phone, v.email, v.active
  FROM vendors v
  WHERE v.is_deleted = false
  ORDER BY v.code;
$$;

CREATE OR REPLACE FUNCTION fn_vendor_list_paged(
  p_page      int     DEFAULT 1,
  p_page_size int     DEFAULT 10,
  p_search    varchar DEFAULT NULL,
  p_active    boolean DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  code           varchar,
  name           varchar,
  gstin          varchar,
  state_code     varchar,
  address        varchar,
  contact_person varchar,
  contact_phone  varchar,
  email          varchar,
  active         boolean
)
LANGUAGE sql STABLE AS $$
  SELECT v.id, v.code, v.name, v.gstin, v.state_code,
         v.address, v.contact_person, v.contact_phone, v.email, v.active
  FROM vendors v
  WHERE v.is_deleted = false
    AND (p_search IS NULL OR v.name ILIKE '%' || p_search || '%' OR v.code ILIKE '%' || p_search || '%')
    AND (p_active IS NULL OR v.active = p_active)
  ORDER BY v.code
  OFFSET GREATEST(p_page - 1, 0) * p_page_size
  LIMIT  p_page_size;
$$;

CREATE OR REPLACE FUNCTION fn_vendor_count(
  p_search varchar DEFAULT NULL,
  p_active boolean DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)
  FROM vendors v
  WHERE v.is_deleted = false
    AND (p_search IS NULL OR v.name ILIKE '%' || p_search || '%' OR v.code ILIKE '%' || p_search || '%')
    AND (p_active IS NULL OR v.active = p_active);
$$;

CREATE OR REPLACE FUNCTION fn_vendor_get(p_id uuid)
RETURNS TABLE (
  id             uuid,
  code           varchar,
  name           varchar,
  gstin          varchar,
  state_code     varchar,
  address        varchar,
  contact_person varchar,
  contact_phone  varchar,
  email          varchar,
  active         boolean
)
LANGUAGE sql STABLE AS $$
  SELECT v.id, v.code, v.name, v.gstin, v.state_code,
         v.address, v.contact_person, v.contact_phone, v.email, v.active
  FROM vendors v
  WHERE v.id = p_id AND v.is_deleted = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_vendor_exists(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM vendors WHERE id = p_id AND is_deleted = false);
$$;

CREATE OR REPLACE FUNCTION fn_vendor_exists_by_code(p_code varchar)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM vendors WHERE code = p_code);
$$;

CREATE OR REPLACE FUNCTION fn_vendor_create(
  p_code           varchar,
  p_name           varchar,
  p_gstin          varchar,
  p_state_code     varchar,
  p_address        varchar,
  p_contact_person varchar,
  p_contact_phone  varchar,
  p_email          varchar,
  p_active         boolean,
  p_user_id        uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO vendors (
    code, name, gstin, state_code, address, contact_person, contact_phone,
    email, active, created_by, updated_by
  ) VALUES (
    p_code, p_name, p_gstin, p_state_code, p_address, p_contact_person,
    p_contact_phone, p_email, COALESCE(p_active, true), p_user_id, p_user_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_vendor_update(
  p_id             uuid,
  p_name           varchar,
  p_gstin          varchar,
  p_state_code     varchar,
  p_address        varchar,
  p_contact_person varchar,
  p_contact_phone  varchar,
  p_email          varchar,
  p_active         boolean,
  p_user_id        uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vendors
  SET name           = p_name,
      gstin          = p_gstin,
      state_code     = p_state_code,
      address        = p_address,
      contact_person = p_contact_person,
      contact_phone  = p_contact_phone,
      email          = p_email,
      active         = p_active,
      updated_by     = p_user_id
  WHERE id = p_id AND is_deleted = false;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fn_vendor_soft_delete(p_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vendors
  SET is_deleted = true, updated_by = p_user_id
  WHERE id = p_id AND is_deleted = false;
  RETURN FOUND;
END;
$$;

-- ============== Vendor Purchases ==================================

CREATE OR REPLACE FUNCTION fn_vendor_purchase_next_code()
RETURNS varchar
LANGUAGE sql AS $$
  SELECT 'PUR' || lpad(nextval('seq_vendor_purchase_code')::text, 4, '0');
$$;

-- List/count share the same filter set: vendor, godown, status,
-- interstate-only, invoice-date range, free-text search (code/vendor
-- name/invoice number). p_to_date is inclusive.
--
-- Phase 5b: adds eway_status column — computed per-row from is_interstate,
-- invoice_amount, and the inbound threshold. One of:
--   'NotRequired' — intrastate OR threshold=0 OR invoice below threshold
--   'Attached'    — a Generated inbound eway_bills row exists
--   'Missing'     — gate applies but no Generated inbound row exists yet
-- The FE renders this as a coloured chip so admins can spot pending
-- compliance at a glance.
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
    FROM app_settings
    WHERE key = 'eway_bill_threshold_inbound'
  )
  SELECT p.id, p.code,
         p.vendor_id, v.code, v.name,
         p.godown_id, i.code, i.name,
         p.is_interstate, p.invoice_number, p.invoice_date, p.invoice_amount,
         p.status, p.total_items, p.total_qty, p.total_amount, p.notes,
         p.received_at, ur.full_name AS received_by_name,
         p.created_at,
         CASE
           WHEN NOT p.is_interstate                           THEN 'NotRequired'
           WHEN (SELECT v FROM thr) = 0                       THEN 'NotRequired'
           WHEN p.invoice_amount < (SELECT v FROM thr)        THEN 'NotRequired'
           WHEN EXISTS (
             SELECT 1 FROM eway_bills eb
             WHERE eb.vendor_purchase_id = p.id
               AND eb.direction          = 'Inbound'
               AND eb.status             = 'Generated'
               AND eb.is_deleted         = false
           )                                                  THEN 'Attached'
           ELSE                                                    'Missing'
         END::varchar AS eway_status
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

CREATE OR REPLACE FUNCTION fn_vendor_purchase_count(
  p_vendor_id     uuid    DEFAULT NULL,
  p_godown_id     uuid    DEFAULT NULL,
  p_status        varchar DEFAULT NULL,
  p_is_interstate boolean DEFAULT NULL,
  p_from_date     date    DEFAULT NULL,
  p_to_date       date    DEFAULT NULL,
  p_search        varchar DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)
  FROM vendor_purchases p
  INNER JOIN vendors v ON v.id = p.vendor_id
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
         OR p.invoice_number ILIKE '%' || p_search || '%');
$$;

-- Detail fetch — items pre-aggregated as one jsonb array column, same
-- "items JSON blob, deserialised in C#" pattern as fn_request_get.
CREATE OR REPLACE FUNCTION fn_vendor_purchase_get(p_id uuid)
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
  items           jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code,
         p.vendor_id, v.code, v.name,
         p.godown_id, i.code, i.name,
         p.is_interstate, p.invoice_number, p.invoice_date, p.invoice_amount,
         p.status, p.total_items, p.total_qty, p.total_amount, p.notes,
         p.received_at, ur.full_name AS received_by_name,
         p.created_at,
         (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id',           it.id,
            'product_id',   it.product_id,
            'product_code', pr.code,
            'product_name', pr.name,
            'qty',          it.qty,
            'unit_cost',    it.unit_cost,
            'line_total',   it.line_total,
            'weight_value', it.weight_value,
            'weight_unit',  it.weight_unit
          ) ORDER BY pr.name), '[]'::jsonb)
          FROM vendor_purchase_items it
          JOIN products pr ON pr.id = it.product_id
          WHERE it.purchase_id = p.id) AS items
  FROM vendor_purchases p
  INNER JOIN vendors     v ON v.id = p.vendor_id
  INNER JOIN inventories i ON i.id = p.godown_id
  LEFT JOIN  users      ur ON ur.id = p.received_by
  WHERE p.id = p_id AND p.is_deleted = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_vendor_purchase_exists(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM vendor_purchases WHERE id = p_id AND is_deleted = false);
$$;

-- Header + items in one round trip — same jsonb_array_elements loop shape
-- as fn_request_create. is_interstate derived server-side from the
-- vendor's state_code so the FE's badge is only ever a preview, never the
-- source of truth. unit_cost/qty come straight from the client (purchase
-- cost is negotiated, not resolved from the product master); weight is
-- snapshotted from products at insert time.
CREATE OR REPLACE FUNCTION fn_vendor_purchase_create(
  p_code           varchar,
  p_vendor_id      uuid,
  p_godown_id      uuid,
  p_invoice_number varchar,
  p_invoice_date   date,
  p_invoice_amount numeric,
  p_notes          varchar,
  p_items          jsonb,
  p_user_id        uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id            uuid;
  v_is_interstate boolean;
  v_total_items   int := 0;
  v_total_qty     numeric(12,3) := 0;
  v_total_amount  numeric(12,2) := 0;
  v_item          jsonb;
  v_qty           numeric(12,3);
  v_cost          numeric(10,2);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Vendor purchase must include at least one item';
  END IF;

  SELECT COALESCE(state_code, '33') <> '33' INTO v_is_interstate
  FROM vendors WHERE id = p_vendor_id;

  INSERT INTO vendor_purchases (
    code, vendor_id, godown_id, is_interstate,
    invoice_number, invoice_date, invoice_amount, status, notes,
    created_by, updated_by
  ) VALUES (
    p_code, p_vendor_id, p_godown_id, COALESCE(v_is_interstate, false),
    p_invoice_number, p_invoice_date, p_invoice_amount, 'Ordered', p_notes,
    p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty  := (v_item->>'qty')::numeric(12,3);
    v_cost := (v_item->>'unit_cost')::numeric(10,2);

    INSERT INTO vendor_purchase_items (
      purchase_id, product_id, qty, unit_cost, weight_value, weight_unit
    )
    SELECT v_id, pr.id, v_qty, v_cost, pr.weight_value, pr.weight_unit
    FROM   products pr
    WHERE  pr.id = (v_item->>'product_id')::uuid;

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty   + v_qty;
    v_total_amount := v_total_amount + (v_qty * v_cost);
  END LOOP;

  UPDATE vendor_purchases
  SET total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

-- Replace-all-items update, same shape as fn_request_update. Only allowed
-- while status='Ordered' (guarded by the WHERE on the header UPDATE) —
-- editing a Received purchase would silently rewrite history.
CREATE OR REPLACE FUNCTION fn_vendor_purchase_update(
  p_id             uuid,
  p_invoice_number varchar,
  p_invoice_date   date,
  p_invoice_amount numeric,
  p_notes          varchar,
  p_items          jsonb,
  p_user_id        uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_flipped      boolean;
  v_total_items  int := 0;
  v_total_qty    numeric(12,3) := 0;
  v_total_amount numeric(12,2) := 0;
  v_item         jsonb;
  v_qty          numeric(12,3);
  v_cost         numeric(10,2);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Vendor purchase must include at least one item';
  END IF;

  UPDATE vendor_purchases
  SET invoice_number = p_invoice_number,
      invoice_date   = p_invoice_date,
      invoice_amount = p_invoice_amount,
      notes          = p_notes,
      updated_by     = p_user_id
  WHERE id = p_id AND status = 'Ordered' AND is_deleted = false;
  v_flipped := FOUND;

  IF v_flipped THEN
    DELETE FROM vendor_purchase_items WHERE purchase_id = p_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_qty  := (v_item->>'qty')::numeric(12,3);
      v_cost := (v_item->>'unit_cost')::numeric(10,2);

      INSERT INTO vendor_purchase_items (
        purchase_id, product_id, qty, unit_cost, weight_value, weight_unit
      )
      SELECT p_id, pr.id, v_qty, v_cost, pr.weight_value, pr.weight_unit
      FROM   products pr
      WHERE  pr.id = (v_item->>'product_id')::uuid;

      v_total_items  := v_total_items + 1;
      v_total_qty    := v_total_qty   + v_qty;
      v_total_amount := v_total_amount + (v_qty * v_cost);
    END LOOP;

    UPDATE vendor_purchases
    SET total_items  = v_total_items,
        total_qty    = v_total_qty,
        total_amount = v_total_amount
    WHERE id = p_id;
  END IF;

  RETURN v_flipped;
END;
$$;

-- Ordered → Received. Phase 5b adds the e-way gate: when the purchase is
-- interstate AND its invoice_amount is at/above the inbound threshold, the
-- transition is blocked unless a Generated inbound eway_bills row is
-- attached. Threshold '0' disables the gate (same convention as gst_enabled
-- in app_settings).
--
-- Return contract — text status code:
--   'ok'            — transition happened.
--   'not_found'     — no such purchase, or already Received, or soft-deleted.
--   'eway_required' — gate matched but no Generated inbound e-way present.
-- Text return (not boolean) so the C# layer can distinguish "wrong state"
-- from "missing e-way" and surface a specific 400 message for the latter.
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

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  -- Interstate-only gate. Intrastate purchases never require an inbound
  -- e-way bill regardless of threshold.
  IF v_purchase.is_interstate THEN
    SELECT value INTO v_threshold_txt
    FROM app_settings
    WHERE key = 'eway_bill_threshold_inbound';

    v_threshold := COALESCE(NULLIF(v_threshold_txt, '')::numeric(12,2), 0);

    -- '0' = gate disabled. Non-zero threshold = gate matches when invoice
    -- amount is at/above it. `>=` (not `>`) intentionally: portal rule is
    -- inclusive at the threshold.
    v_gate_applies := v_threshold > 0 AND v_purchase.invoice_amount >= v_threshold;

    IF v_gate_applies THEN
      SELECT EXISTS (
        SELECT 1
        FROM eway_bills eb
        WHERE eb.vendor_purchase_id = p_id
          AND eb.direction          = 'Inbound'
          AND eb.status             = 'Generated'
          AND eb.is_deleted         = false
      ) INTO v_has_eway;

      IF NOT v_has_eway THEN
        RETURN 'eway_required';
      END IF;
    END IF;
  END IF;

  UPDATE vendor_purchases
  SET status      = 'Received',
      received_at = now(),
      received_by = p_user_id,
      updated_by  = p_user_id
  WHERE id = p_id;

  RETURN 'ok';
END;
$$;

-- Cancel — only while still Ordered (soft-delete; Received purchases are
-- audit history and must not disappear).
CREATE OR REPLACE FUNCTION fn_vendor_purchase_cancel(p_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vendor_purchases
  SET is_deleted = true, updated_by = p_user_id
  WHERE id = p_id AND status = 'Ordered' AND is_deleted = false;
  RETURN FOUND;
END;
$$;

-- ============== E-way Bills (Phase 5b, Inbound only) ================

-- Returns the current inbound-direction threshold in ₹. Zero = gate disabled.
-- Both directions kept as separate settings keys per Decision 5.
CREATE OR REPLACE FUNCTION fn_eway_threshold_get(p_direction varchar)
RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_key varchar;
  v_txt varchar;
BEGIN
  v_key := CASE p_direction
             WHEN 'Inbound'  THEN 'eway_bill_threshold_inbound'
             WHEN 'Outbound' THEN 'eway_bill_threshold_outbound'
             ELSE NULL
           END;
  IF v_key IS NULL THEN
    RETURN 0;
  END IF;

  SELECT value INTO v_txt FROM app_settings WHERE key = v_key;
  RETURN COALESCE(NULLIF(v_txt, '')::numeric(12,2), 0);
END;
$$;

-- Record an inbound e-way bill against a Phase 5a vendor_purchase. Phase 5b
-- writes Manual rows only (generated_via='Manual', no GSP call). The row
-- lands as status='Generated' immediately — Draft is a Phase 5c concept
-- (in-flight GSP call) that's not reachable via this SP.
--
-- Idempotency: the caller passes eway_number; if that number already exists
-- against this same purchase (regardless of Cancelled state), we treat it
-- as a re-submit and return the existing id rather than duplicating. Numbers
-- clashing across purchases fail on the unique index — that's a real error
-- (typo or wrong purchase) and should surface as a 409.
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

  -- Re-submit dedup: same purchase + same number → return the existing row.
  SELECT id INTO v_id
  FROM eway_bills
  WHERE vendor_purchase_id = p_purchase_id
    AND eway_number        = p_eway_number
    AND is_deleted         = false
  LIMIT 1;

  IF FOUND THEN
    RETURN v_id;
  END IF;

  INSERT INTO eway_bills (
    eway_number, generation_date, direction,
    vendor_purchase_id,
    supply_type, sub_type, document_type, document_number, document_date,
    from_gstin, from_state_code,
    to_gstin,   to_state_code,
    transport_mode, distance_km, transporter_name, vehicle_number,
    taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
    valid_from, valid_until, status, generated_via,
    attachment_url, notes,
    created_by, updated_by
  ) VALUES (
    p_eway_number, COALESCE(p_generation_date, now()), 'Inbound',
    p_purchase_id,
    'Inward', 'Supply', 'TaxInvoice', p_document_number, p_document_date,
    p_from_gstin, p_from_state_code,
    p_to_gstin,   p_to_state_code,
    p_transport_mode, p_distance_km, p_transporter_name, p_vehicle_number,
    p_taxable_amount, COALESCE(p_cgst_amount, 0), COALESCE(p_sgst_amount, 0),
    COALESCE(p_igst_amount, 0), p_total_amount,
    COALESCE(p_generation_date, now()), p_valid_until, 'Generated', 'Manual',
    p_attachment_url, p_notes,
    p_user_id, p_user_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_eway_bill_get(p_id uuid)
RETURNS TABLE (
  id                    uuid,
  eway_number           varchar,
  generation_date       timestamptz,
  direction             varchar,
  vendor_purchase_id    uuid,
  stock_request_id      uuid,
  bill_id               uuid,
  document_number       varchar,
  document_date         date,
  from_gstin            varchar,
  from_state_code       varchar,
  to_gstin              varchar,
  to_state_code         varchar,
  transport_mode        varchar,
  distance_km           smallint,
  transporter_name      varchar,
  vehicle_number        varchar,
  taxable_amount        numeric,
  cgst_amount           numeric,
  sgst_amount           numeric,
  igst_amount           numeric,
  total_amount          numeric,
  valid_from            timestamptz,
  valid_until           timestamptz,
  status                varchar,
  generated_via         varchar,
  attachment_url        text,
  notes                 text,
  created_at            timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT eb.id, eb.eway_number, eb.generation_date, eb.direction,
         eb.vendor_purchase_id, eb.stock_request_id, eb.bill_id,
         eb.document_number, eb.document_date,
         eb.from_gstin, eb.from_state_code,
         eb.to_gstin, eb.to_state_code,
         eb.transport_mode, eb.distance_km, eb.transporter_name, eb.vehicle_number,
         eb.taxable_amount, eb.cgst_amount, eb.sgst_amount, eb.igst_amount, eb.total_amount,
         eb.valid_from, eb.valid_until, eb.status, eb.generated_via,
         eb.attachment_url, eb.notes, eb.created_at
  FROM eway_bills eb
  WHERE eb.id = p_id AND eb.is_deleted = false
  LIMIT 1;
$$;

-- List all (non-deleted) e-way rows attached to a purchase, newest first.
-- Same column shape as fn_eway_bill_get for a shared C# entity.
CREATE OR REPLACE FUNCTION fn_eway_bill_list_for_purchase(p_purchase_id uuid)
RETURNS TABLE (
  id                    uuid,
  eway_number           varchar,
  generation_date       timestamptz,
  direction             varchar,
  vendor_purchase_id    uuid,
  stock_request_id      uuid,
  bill_id               uuid,
  document_number       varchar,
  document_date         date,
  from_gstin            varchar,
  from_state_code       varchar,
  to_gstin              varchar,
  to_state_code         varchar,
  transport_mode        varchar,
  distance_km           smallint,
  transporter_name      varchar,
  vehicle_number        varchar,
  taxable_amount        numeric,
  cgst_amount           numeric,
  sgst_amount           numeric,
  igst_amount           numeric,
  total_amount          numeric,
  valid_from            timestamptz,
  valid_until           timestamptz,
  status                varchar,
  generated_via         varchar,
  attachment_url        text,
  notes                 text,
  created_at            timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT eb.id, eb.eway_number, eb.generation_date, eb.direction,
         eb.vendor_purchase_id, eb.stock_request_id, eb.bill_id,
         eb.document_number, eb.document_date,
         eb.from_gstin, eb.from_state_code,
         eb.to_gstin, eb.to_state_code,
         eb.transport_mode, eb.distance_km, eb.transporter_name, eb.vehicle_number,
         eb.taxable_amount, eb.cgst_amount, eb.sgst_amount, eb.igst_amount, eb.total_amount,
         eb.valid_from, eb.valid_until, eb.status, eb.generated_via,
         eb.attachment_url, eb.notes, eb.created_at
  FROM eway_bills eb
  WHERE eb.vendor_purchase_id = p_purchase_id AND eb.is_deleted = false
  ORDER BY eb.created_at DESC;
$$;

-- Soft-cancel an e-way bill (mark Cancelled, preserve the row for audit).
-- Only Generated → Cancelled is allowed; already-Cancelled or Expired rows
-- are no-ops. Returns FOUND flag.
CREATE OR REPLACE FUNCTION fn_eway_bill_cancel(
  p_id     uuid,
  p_reason text,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE eway_bills
  SET status              = 'Cancelled',
      cancellation_reason = p_reason,
      cancelled_at        = now(),
      cancelled_by        = p_user_id,
      updated_by          = p_user_id
  WHERE id         = p_id
    AND status     = 'Generated'
    AND is_deleted = false;
  RETURN FOUND;
END;
$$;
