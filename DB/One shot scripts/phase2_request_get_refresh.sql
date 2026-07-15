-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — fn_request_get refresh (one-shot)
-- 03-Jul-2026
--
-- Consolidated redefinition of fn_request_get with EVERY recent items-JSON
-- projection added since the initial phase 2 build:
--   • is_vendor_procured          (03-Jul-2026 back-order feature)
--   • parent_request_id/code      (03-Jul-2026 back-order carve linkage)
--   • expected_arrival_at         (03-Jul-2026 back-order ETA)
--   • backorder_children          (03-Jul-2026 back-order carve linkage)
--   • received_qty                (03-Jul-2026 confirm-receipt discrepancy)
--   • return_weight_g             (03-Jul-2026 partial-weight return / B2)
--
-- If any of the receipt-changes / partial-weight / back-order UIs are
-- rendering empty, this is the SP to re-apply. Body copied 1:1 from
-- DB/phase2/phase2_procedures.sql — no drift risk.
--
-- Idempotent: CREATE OR REPLACE, RETURNS shape unchanged. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_request_get(p_id uuid)
RETURNS TABLE (
  id                    uuid,
  code                  varchar,
  shop_id               uuid,
  shop_code             varchar,
  shop_name             varchar,
  shop_contact_phone    varchar,
  inventory_id          uuid,
  inventory_code        varchar,
  inventory_name        varchar,
  submitted_by_name       varchar,
  approved_by_name        varchar,
  dispatched_by_name      varchar,
  received_by_name        varchar,
  accepted_by_name        varchar,
  status                  varchar,
  request_type            varchar,
  total_items             int,
  total_qty               int,
  total_dispatched_qty    int,
  total_amount            numeric,
  total_dispatched_amount numeric,
  notes                   varchar,
  rejection_reason        varchar,
  editable_until          timestamptz,
  submitted_at            timestamptz,
  updated_at              timestamptz,
  approved_at             timestamptz,
  approved_by             uuid,
  dispatched_at           timestamptz,
  dispatched_by           uuid,
  received_at             timestamptz,
  accepted_at             timestamptz,
  accepted_by             uuid,
  cancelled_at            timestamptz,
  cancelled_by            uuid,
  source_request_id       uuid,
  source_request_code     varchar,
  parent_request_id       uuid,
  parent_request_code     varchar,
  expected_arrival_at     timestamptz,
  backorder_children      jsonb,
  items                   jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.code,
         r.shop_id, s.code, s.name, s.contact_phone_1 AS shop_contact_phone,
         r.inventory_id, i.code, i.name,
         u.full_name    AS submitted_by_name,
         ua.full_name   AS approved_by_name,
         ud.full_name   AS dispatched_by_name,
         urcv.full_name AS received_by_name,
         uac.full_name  AS accepted_by_name,
         r.status::varchar       AS status,
         r.request_type::varchar AS request_type,
         r.total_items, r.total_qty,
         (SELECT SUM(it.dispatched_qty)::int
          FROM stock_request_items it
          WHERE it.request_id = r.id) AS total_dispatched_qty,
         r.total_amount,
         (SELECT SUM(it.dispatched_qty * it.unit_price)::numeric(12,2)
          FROM stock_request_items it
          WHERE it.request_id = r.id) AS total_dispatched_amount,
         r.notes, r.rejection_reason, r.editable_until,
         r.submitted_at, r.updated_at,
         r.approved_at, r.approved_by,
         r.dispatched_at, r.dispatched_by, r.received_at,
         r.accepted_at, r.accepted_by,
         r.cancelled_at, r.cancelled_by,
         r.source_request_id,
         src.code AS source_request_code,
         r.parent_request_id,
         par.code AS parent_request_code,
         r.expected_arrival_at,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_object(
               'id',                  br.id,
               'code',                br.code,
               'status',              br.status::varchar,
               'total_items',         br.total_items,
               'total_qty',           br.total_qty,
               'total_amount',        br.total_amount,
               'expected_arrival_at', br.expected_arrival_at,
               'submitted_at',        br.submitted_at
             ) ORDER BY br.submitted_at
           )
           FROM stock_requests br
           WHERE br.parent_request_id = r.id AND br.is_deleted = false
         ), '[]'::jsonb) AS backorder_children,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_object(
               'id',                  it.id,
               'product_id',          it.product_id,
               'product_code',        p.code,
               'product_name',        p.name,
               'category_name',       c.name,
               'weight_value',        it.weight_value,
               'weight_unit',         it.weight_unit,
               'requested_qty',       it.requested_qty,
               'dispatched_qty',      it.dispatched_qty,
               'received_qty',        it.received_qty,
               'return_weight_g',     it.return_weight_g,
               'draft_dispatched_qty',it.draft_dispatched_qty,
               'unit_price',          it.unit_price,
               'subtotal',            it.subtotal,
               'added_by',            it.added_by,
               'is_vendor_procured',  p.is_vendor_procured
             ) ORDER BY c.name, p.code
           )
           FROM stock_request_items it
           INNER JOIN products   p ON p.id = it.product_id
           INNER JOIN categories c ON c.id = p.category_id
           WHERE it.request_id = r.id
         ), '[]'::jsonb) AS items
  FROM stock_requests r
  INNER JOIN shops       s    ON s.id    = r.shop_id
  INNER JOIN inventories i    ON i.id    = r.inventory_id
  LEFT  JOIN users       u    ON u.id    = r.created_by
  LEFT  JOIN users       ua   ON ua.id   = r.approved_by
  LEFT  JOIN users       ud   ON ud.id   = r.dispatched_by
  LEFT  JOIN users       urcv ON urcv.id = r.received_by
  LEFT  JOIN users       uac  ON uac.id  = r.accepted_by
  LEFT  JOIN stock_requests src ON src.id = r.source_request_id
  LEFT  JOIN stock_requests par ON par.id = r.parent_request_id
  WHERE r.id = p_id AND r.is_deleted = false;
$$;
