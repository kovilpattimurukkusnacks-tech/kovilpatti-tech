-- ============================================================
-- ONE-SHOT: phase2_list_drafts_special
--
-- Extends fn_request_list_paged + fn_request_count with two new
-- filters (15-Jul-2026):
--
--   1. p_include_drafts + p_user_id — admin's own draft rows surface in
--      the Stock Requests list under a "My Drafts" preset (client ask:
--      draft visibility on the list so back-navigation doesn't feel
--      like work is lost).
--
--   2. p_is_special — is_special filter that drives the new "Special
--      Order" preset chip across admin / shop / inventory list pages.
--      NULL = no filter (default, behaviour unchanged), true = only
--      special requests, false = only non-special.
--
-- All three params default to NULL / false so every existing caller
-- keeps identical behaviour without any code change on the .NET / FE
-- side. Users only ever see their OWN drafts via the include-drafts
-- opt-in — server resolves created_by from the auth claim.
--
-- Also fixes an incidental issue for draft rows: they have no
-- submitted_at (still Draft status), so the existing p_from_date /
-- p_to_date filters would exclude them. The bypass condition
-- (`OR r.status = 'Draft'`) lets drafts through the date bounds when
-- they DO leak into the result set.
--
-- Idempotent — safe to re-run. Signature changes → both SPs are
-- dropped explicitly before CREATE OR REPLACE to avoid overload
-- ambiguity on a partial re-run.
--
-- IMPLEMENTATION NOTE — the SP bodies below are copied VERBATIM from
-- the baseline DB/phase2/phase2_procedures.sql. total_dispatched_qty,
-- total_dispatched_amount and total_adjustment_qty are SUBQUERY-derived
-- (aggregated from stock_request_items), NOT direct columns on
-- stock_requests.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS fn_request_list_paged(uuid, uuid, request_status, varchar, int, int, date, date, request_type);
DROP FUNCTION IF EXISTS fn_request_count      (uuid, uuid, request_status, varchar, date, date, request_type);
-- Also drop the intermediate 11-arg shape from an earlier include-drafts-only
-- run of THIS script (before p_is_special was added) so Postgres doesn't
-- see an ambiguous overload after re-run:
DROP FUNCTION IF EXISTS fn_request_list_paged(uuid, uuid, request_status, varchar, int, int, date, date, request_type, boolean, uuid);
DROP FUNCTION IF EXISTS fn_request_count      (uuid, uuid, request_status, varchar, date, date, request_type, boolean, uuid);

CREATE OR REPLACE FUNCTION fn_request_list_paged(
  p_shop_id        uuid           DEFAULT NULL,
  p_inventory_id   uuid           DEFAULT NULL,
  p_status         request_status DEFAULT NULL,
  p_search         varchar        DEFAULT NULL,
  p_page           int            DEFAULT 1,
  p_page_size      int            DEFAULT 10,
  p_from_date      date           DEFAULT NULL,
  p_to_date        date           DEFAULT NULL,
  p_request_type   request_type   DEFAULT NULL,
  p_include_drafts boolean        DEFAULT false,
  p_user_id        uuid           DEFAULT NULL,
  p_is_special     boolean        DEFAULT NULL
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
  total_adjustment_qty    int,
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
  is_special              boolean,
  special_label           varchar
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
         (SELECT SUM(it.received_qty - COALESCE(it.dispatched_qty, 0))::int
          FROM stock_request_items it
          WHERE it.request_id = r.id AND it.received_qty IS NOT NULL) AS total_adjustment_qty,
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
         r.is_special,
         r.special_label
  FROM stock_requests r
  INNER JOIN shops       s    ON s.id    = r.shop_id
  INNER JOIN inventories i    ON i.id    = r.inventory_id
  LEFT  JOIN users       u    ON u.id    = r.created_by
  LEFT  JOIN users       ua   ON ua.id   = r.approved_by
  LEFT  JOIN users       ud   ON ud.id   = r.dispatched_by
  LEFT  JOIN users       urcv ON urcv.id = r.received_by
  LEFT  JOIN users       uac  ON uac.id  = r.accepted_by
  LEFT  JOIN stock_requests src ON src.id = r.source_request_id
  WHERE r.is_deleted = false
    AND (r.status <> 'Draft'
         OR (p_include_drafts = true AND p_user_id IS NOT NULL AND r.created_by = p_user_id))
    AND (p_shop_id      IS NULL OR r.shop_id      = p_shop_id)
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND (p_status       IS NULL OR r.status       = p_status)
    AND (p_search       IS NULL OR r.code ILIKE '%' || p_search || '%')
    AND (p_request_type IS NULL OR r.request_type = p_request_type)
    AND (p_is_special   IS NULL OR r.is_special   = p_is_special)
    AND (p_from_date IS NULL OR r.submitted_at >= (p_from_date::timestamp AT TIME ZONE 'Asia/Kolkata') OR r.status = 'Draft')
    AND (p_to_date   IS NULL OR r.submitted_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') OR r.status = 'Draft')
  ORDER BY r.submitted_at DESC NULLS FIRST
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;


CREATE OR REPLACE FUNCTION fn_request_count(
  p_shop_id        uuid           DEFAULT NULL,
  p_inventory_id   uuid           DEFAULT NULL,
  p_status         request_status DEFAULT NULL,
  p_search         varchar        DEFAULT NULL,
  p_from_date      date           DEFAULT NULL,
  p_to_date        date           DEFAULT NULL,
  p_request_type   request_type   DEFAULT NULL,
  p_include_drafts boolean        DEFAULT false,
  p_user_id        uuid           DEFAULT NULL,
  p_is_special     boolean        DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)
  FROM stock_requests r
  WHERE r.is_deleted = false
    AND (r.status <> 'Draft'
         OR (p_include_drafts = true AND p_user_id IS NOT NULL AND r.created_by = p_user_id))
    AND (p_shop_id      IS NULL OR r.shop_id      = p_shop_id)
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND (p_status       IS NULL OR r.status       = p_status)
    AND (p_search       IS NULL OR r.code ILIKE '%' || p_search || '%')
    AND (p_request_type IS NULL OR r.request_type = p_request_type)
    AND (p_is_special   IS NULL OR r.is_special   = p_is_special)
    AND (p_from_date IS NULL OR r.submitted_at >= (p_from_date::timestamp AT TIME ZONE 'Asia/Kolkata') OR r.status = 'Draft')
    AND (p_to_date   IS NULL OR r.submitted_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') OR r.status = 'Draft');
$$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- 1. Signature check — both SPs now take 12 / 10 args:
--    SELECT proname, pg_get_function_identity_arguments(oid)
--    FROM pg_proc WHERE proname IN ('fn_request_list_paged','fn_request_count');
--
-- 2. Existing behaviour intact — no change without opt-in:
--    SELECT COUNT(*) FROM fn_request_list_paged(NULL,NULL,NULL,NULL,1,1000);
--
-- 3. Only special orders come back when p_is_special = true:
--    SELECT id, code, is_special FROM fn_request_list_paged(
--      NULL, NULL, NULL, NULL, 1, 1000,
--      NULL, NULL, NULL,
--      false, NULL,
--      true);
--    -- Every row should have is_special = true.
-- ============================================================
