-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Back-order feature: extend fn_request_get + fn_request_list_paged
-- 01-Jul-2026
--
-- Prerequisite: phase2_backorder_schema.sql (adds parent_request_id +
-- expected_arrival_at columns and 'Backorder' enum value).
--
-- Both SP signatures change (new columns in RETURNS TABLE) so each is
-- DROPped first before CREATE. Postgres CREATE OR REPLACE FUNCTION
-- doesn't allow RETURNS TABLE changes; the DROP is required.
--
-- Backward compat notes:
--   • BE Dapper `<StockRequest>` mapper already ignores unknown columns —
--     new columns come through as NULL until the entity is extended
--     (Phase 4). No existing endpoint breaks.
--   • FE reads updated_at / submitted_at etc. unchanged. New fields are
--     opt-in on the FE (Phase 5).
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. fn_request_get — add parent_request_id, parent_request_code,
--    expected_arrival_at, backorder_children (jsonb) at the top level.
--    Add is_vendor_procured on each item inside the items jsonb.
DROP FUNCTION IF EXISTS fn_request_get(uuid);

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
               'id',             it.id,
               'product_id',     it.product_id,
               'product_code',   p.code,
               'product_name',   p.name,
               'category_name',  c.name,
               'weight_value',   it.weight_value,
               'weight_unit',    it.weight_unit,
               'requested_qty',  it.requested_qty,
               'dispatched_qty', it.dispatched_qty,
               'draft_dispatched_qty', it.draft_dispatched_qty,
               'unit_price',     it.unit_price,
               'subtotal',       it.subtotal,
               'added_by',       it.added_by,
               'is_vendor_procured', p.is_vendor_procured
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


-- 2. fn_request_list_paged — add parent_request_id, parent_request_code,
--    expected_arrival_at columns to RETURNS TABLE. Existing filter params
--    unchanged; request_type filter now accepts 'Backorder' as a valid
--    value (the enum was extended in the schema migration).
DROP FUNCTION IF EXISTS fn_request_list_paged(uuid, uuid, request_status, varchar, int, int, date, date, request_type);

CREATE OR REPLACE FUNCTION fn_request_list_paged(
  p_shop_id      uuid           DEFAULT NULL,
  p_inventory_id uuid           DEFAULT NULL,
  p_status       request_status DEFAULT NULL,
  p_search       varchar        DEFAULT NULL,
  p_page         int            DEFAULT 1,
  p_page_size    int            DEFAULT 10,
  p_from_date    date           DEFAULT NULL,
  p_to_date      date           DEFAULT NULL,
  p_request_type request_type   DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  code                  varchar,
  shop_id               uuid,
  shop_code             varchar,
  shop_name             varchar,
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
  expected_arrival_at     timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.code,
         r.shop_id, s.code, s.name,
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
         r.expected_arrival_at
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
  WHERE r.is_deleted = false
    AND r.status     <> 'Draft'
    AND (p_shop_id      IS NULL OR r.shop_id      = p_shop_id)
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND (p_status       IS NULL OR r.status       = p_status)
    AND (p_search       IS NULL OR r.code ILIKE '%' || p_search || '%')
    AND (p_request_type IS NULL OR r.request_type = p_request_type)
    AND (p_from_date IS NULL OR r.submitted_at >= (p_from_date::timestamp AT TIME ZONE 'Asia/Kolkata'))
    AND (p_to_date   IS NULL OR r.submitted_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
  ORDER BY r.submitted_at DESC
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;
