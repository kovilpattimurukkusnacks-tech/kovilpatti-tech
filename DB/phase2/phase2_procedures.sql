-- ============================================================
-- Kovilpatti Snacks — Phase 2 PROCEDURES (stored functions)
--
-- Run AFTER phase2_init.sql.
-- Idempotent: every function uses CREATE OR REPLACE.
--
-- TIMEZONE POLICY: `editable_until` is computed in the BE in IST (UTC+5:30)
-- and passed in as a `timestamptz`. SQL just stores it. NOW() comparisons
-- are timezone-aware (Postgres compares instants regardless of stored offset).
-- ============================================================
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase2/phase2_procedures.sql
-- ============================================================

BEGIN;

-- ============================================================
-- 0. PREREQUISITE: seq_request_code
-- ============================================================
--   fn_request_next_code below is a LANGUAGE sql function — Postgres
--   validates its body at CREATE time, so seq_request_code MUST already
--   exist or this entire file errors with "relation seq_request_code does
--   not exist".
--
--   The sequence is also created in phase2_init.sql, but we ensure it here
--   too so phase2_procedures.sql is robust to run order (e.g. on an older
--   dev DB whose phase2_init predates the sequence). Idempotent.
--
--   Seeding is safe here because every other function in this file already
--   references the Phase 2 tables — so if this file runs at all, the
--   stock_requests table exists.
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS seq_request_code START 1;

DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT MAX(CAST(substring(code FROM 4) AS bigint)) INTO v_max
  FROM stock_requests
  WHERE code ~ '^REQ[0-9]+$';

  IF v_max IS NULL THEN
    PERFORM setval('seq_request_code', 1, false);   -- empty table → next = 1
  ELSE
    PERFORM setval('seq_request_code', v_max, true); -- has data → next = max+1
  END IF;
END $$;

-- ============================================================
-- 1. CODE GENERATION
-- ============================================================
--   Uses seq_request_code (ensured above) so concurrent fn_request_create
--   calls never collide on the same code — the previous SELECT MAX+1
--   pattern had a race that the UNIQUE(code) constraint papered over with
--   a confusing error.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_request_next_code()
RETURNS varchar
LANGUAGE sql AS $$
  SELECT 'REQ' || lpad(nextval('seq_request_code')::text, 4, '0');
$$;


-- ============================================================
-- 2. SETTINGS
-- ============================================================

CREATE OR REPLACE FUNCTION fn_settings_list()
RETURNS TABLE (
  key         varchar,
  value       varchar,
  description varchar,
  updated_at  timestamptz,
  updated_by  uuid
)
LANGUAGE sql STABLE AS $$
  SELECT key, value, description, updated_at, updated_by
  FROM app_settings
  ORDER BY key;
$$;


CREATE OR REPLACE FUNCTION fn_settings_get(p_key varchar)
RETURNS TABLE (
  key         varchar,
  value       varchar,
  description varchar,
  updated_at  timestamptz,
  updated_by  uuid
)
LANGUAGE sql STABLE AS $$
  SELECT key, value, description, updated_at, updated_by
  FROM app_settings
  WHERE key = p_key;
$$;


CREATE OR REPLACE FUNCTION fn_settings_update(
  p_key     varchar,
  p_value   varchar,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE app_settings
  SET value      = p_value,
      updated_by = p_user_id
  WHERE key = p_key;
  RETURN FOUND;
END
$$;


-- ============================================================
-- 3. STOCK REQUEST — READ (list, count, get-by-id)
-- ============================================================

-- Paginated list with filters. Used by all three role views — shop ("mine"
-- filters by p_shop_id), inventory (filters by p_inventory_id), and admin
-- (no filter required).
-- Return shape gained `total_dispatched_qty`, then `total_dispatched_amount`,
-- and most recently `submitted_by_name` (from users joined on created_by).
-- Each schema change → must DROP before redefining.
DROP FUNCTION IF EXISTS fn_request_list_paged(uuid, uuid, request_status, varchar, int, int);

-- Signature changed (added p_from_date / p_to_date) — drop the old 6-param
-- overload first so re-running on an environment that already has the old
-- version doesn't leave an ambiguous overload behind.
DROP FUNCTION IF EXISTS fn_request_list_paged(uuid, uuid, request_status, varchar, int, int);

-- RETURNS TABLE shape grew (added request_type, source_request_*, accepted_*
-- for the Return Stock feature, 27-May-2026). CREATE OR REPLACE can't change
-- return shape, so the previous 8-arg signature must be dropped before we
-- redefine.
DROP FUNCTION IF EXISTS fn_request_list_paged(uuid, uuid, request_status, varchar, int, int, date, date);
-- Second drop — a follow-up (28-May-2026) added p_request_type for the
-- "Return" chip filter, bumping the signature to 9 args.
DROP FUNCTION IF EXISTS fn_request_list_paged(uuid, uuid, request_status, varchar, int, int, date, date, request_type);

CREATE OR REPLACE FUNCTION fn_request_list_paged(
  p_shop_id      uuid           DEFAULT NULL,
  p_inventory_id uuid           DEFAULT NULL,
  p_status       request_status DEFAULT NULL,
  p_search       varchar        DEFAULT NULL,
  p_page         int            DEFAULT 1,
  p_page_size    int            DEFAULT 10,
  -- Date range filters on submitted_at, interpreted as IST calendar days.
  -- NULL = no bound. p_to_date is inclusive (we add 1 day and use < below).
  p_from_date    date           DEFAULT NULL,
  p_to_date      date           DEFAULT NULL,
  -- Filter by request_type: NULL = both Orders + Returns mixed (current chip
  -- behaviour); 'Return' = the new Return chip; 'Order' = explicit Orders.
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
  source_request_code     varchar
)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.code,
         r.shop_id, s.code, s.name,
         r.inventory_id, i.code, i.name,
         -- Each *_by_name comes from a LEFT JOIN on users.id so a deleted
         -- user simply yields NULL — the request row stays visible.
         u.full_name    AS submitted_by_name,
         ua.full_name   AS approved_by_name,
         ud.full_name   AS dispatched_by_name,
         urcv.full_name AS received_by_name,
         uac.full_name  AS accepted_by_name,
         -- Cast the enum to varchar so Npgsql 8+ (which is stricter about
         -- unmapped custom enum types) can deserialize without needing the
         -- BE to MapEnum<>() the request_status type at the data source.
         r.status::varchar       AS status,
         r.request_type::varchar AS request_type,
         r.total_items, r.total_qty,
         -- NULL until any item on this request has been dispatched.
         -- Explicit casts pin the column type so Npgsql doesn't see a NULL
         -- with DataTypeName '-' (causes InvalidCastException on the BE).
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
         -- Return → linked Order traceability. NULL for Orders and free-form Returns.
         r.source_request_id,
         src.code AS source_request_code
  FROM stock_requests r
  INNER JOIN shops       s    ON s.id    = r.shop_id
  INNER JOIN inventories i    ON i.id    = r.inventory_id
  LEFT  JOIN users       u    ON u.id    = r.created_by
  LEFT  JOIN users       ua   ON ua.id   = r.approved_by
  LEFT  JOIN users       ud   ON ud.id   = r.dispatched_by
  LEFT  JOIN users       urcv ON urcv.id = r.received_by
  LEFT  JOIN users       uac  ON uac.id  = r.accepted_by
  -- Self-join for the linked Order's code (Returns only). Partial index
  -- idx_stock_requests_source_request keeps this lookup cheap.
  LEFT  JOIN stock_requests src ON src.id = r.source_request_id
  WHERE r.is_deleted = false
    AND r.status     <> 'Draft'   -- drafts are private; only fn_request_get_shop_draft surfaces them
    AND (p_shop_id      IS NULL OR r.shop_id      = p_shop_id)
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND (p_status       IS NULL OR r.status       = p_status)
    AND (p_search       IS NULL OR r.code ILIKE '%' || p_search || '%')
    AND (p_request_type IS NULL OR r.request_type = p_request_type)
    -- IST day boundaries: p_from_date's midnight (IST) → UTC instant; upper
    -- bound is p_to_date + 1 day midnight (IST), exclusive, so the whole
    -- p_to_date day is included.
    AND (p_from_date IS NULL OR r.submitted_at >= (p_from_date::timestamp AT TIME ZONE 'Asia/Kolkata'))
    AND (p_to_date   IS NULL OR r.submitted_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
  ORDER BY r.submitted_at DESC
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;


-- Signature changed (added p_from_date / p_to_date) — drop the old 4-param
-- overload first to avoid an ambiguous overload on re-run.
DROP FUNCTION IF EXISTS fn_request_count(uuid, uuid, request_status, varchar);
-- Second drop — follow-up (28-May-2026) added p_request_type for the
-- "Return" chip filter.
DROP FUNCTION IF EXISTS fn_request_count(uuid, uuid, request_status, varchar, date, date);

CREATE OR REPLACE FUNCTION fn_request_count(
  p_shop_id      uuid           DEFAULT NULL,
  p_inventory_id uuid           DEFAULT NULL,
  p_status       request_status DEFAULT NULL,
  p_search       varchar        DEFAULT NULL,
  p_from_date    date           DEFAULT NULL,
  p_to_date      date           DEFAULT NULL,
  p_request_type request_type   DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)
  FROM stock_requests r
  WHERE r.is_deleted = false
    AND r.status     <> 'Draft'   -- match fn_request_list_paged: drafts excluded from list/count
    AND (p_shop_id      IS NULL OR r.shop_id      = p_shop_id)
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND (p_status       IS NULL OR r.status       = p_status)
    AND (p_search       IS NULL OR r.code ILIKE '%' || p_search || '%')
    AND (p_request_type IS NULL OR r.request_type = p_request_type)
    -- Same IST day-boundary filter as fn_request_list_paged so count matches list.
    AND (p_from_date IS NULL OR r.submitted_at >= (p_from_date::timestamp AT TIME ZONE 'Asia/Kolkata'))
    AND (p_to_date   IS NULL OR r.submitted_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'));
$$;


-- Cumulative IN-PROGRESS workload by SKU (product × weight). Used by the godown's
-- "print cumulative" report so the kitchen can prepare one consolidated batch
-- across all requests the godown has approved (= "In-Progress" in the UI).
--
-- Why Approved and not Pending: once a request is Approved, the shop can no
-- longer edit it, so the totals here are stable while the kitchen packs. With
-- Pending we'd show a moving target — a shop adjusting their order would shift
-- the cumulative report mid-pack. Client requested this change after the
-- 26-May-2026 demo. Function name kept for compatibility with existing BE
-- callers; semantic shift documented here.
--
-- Groups by (product_id, weight_value, weight_unit) so a 100g packet and a
-- 50g packet of the same product line stay on separate lines — they are
-- physically different SKUs to pack.
--
-- p_inventory_id NULL → cross-inventory total (admin-only use).
CREATE OR REPLACE FUNCTION fn_request_pending_cumulative(
  p_inventory_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id      uuid,
  product_code    varchar,
  product_name    varchar,
  category_name   varchar,
  type            varchar,
  weight_value    numeric,
  weight_unit     varchar,
  total_qty       bigint,
  request_count   bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id                AS product_id,
    p.code              AS product_code,
    p.name              AS product_name,
    c.name              AS category_name,
    p.type              AS type,
    it.weight_value     AS weight_value,
    it.weight_unit      AS weight_unit,
    SUM(it.requested_qty)::bigint        AS total_qty,
    COUNT(DISTINCT r.id)::bigint         AS request_count
  FROM stock_requests r
  INNER JOIN stock_request_items it ON it.request_id = r.id
  INNER JOIN products            p  ON p.id  = it.product_id
  INNER JOIN categories          c  ON c.id  = p.category_id
  WHERE r.is_deleted = false
    -- Approved (= "In-Progress") only. See function header for why we don't
    -- source from Pending.
    AND r.status = 'Approved'
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
  GROUP BY p.id, p.code, p.name, c.name, p.type, it.weight_value, it.weight_unit
  ORDER BY p.code;
$$;


-- Pending/Approved requests that have at least one item with a saved
-- dispatch draft (draft_dispatched_qty IS NOT NULL). Drives the "Resume
-- dispatch draft" strip on the inventory list page so the user sees
-- exactly which incoming requests they have WIP qtys saved on.
--
-- p_inventory_id NULL → tenant-wide (admin only); otherwise scoped to a
--                       single inventory's queue (forced for Inventory role).
--
-- Return shape mirrors fn_request_list_paged so the BE can reuse the StockRequest
-- entity + MapHeaderToDto mapper. Shape grew with the Return Stock columns
-- (27-May-2026); drop the 1-arg signature first since CREATE OR REPLACE
-- can't change RETURNS TABLE.
--
-- Naturally Order-only: the EXISTS filter on draft_dispatched_qty matches
-- only items on Orders (Returns don't carry a dispatch draft). The new
-- request_type / source_* / accepted_* columns are surfaced anyway for
-- entity-shape compatibility — they'll be 'Order' / NULL on every row here.
DROP FUNCTION IF EXISTS fn_request_list_inventory_dispatch_drafts(uuid);

CREATE OR REPLACE FUNCTION fn_request_list_inventory_dispatch_drafts(
  p_inventory_id uuid DEFAULT NULL
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
  draft_name              varchar,
  pinned_at               timestamptz
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
         r.draft_name,
         r.pinned_at
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
    AND r.status IN ('Pending', 'Approved')
    AND EXISTS (
      SELECT 1 FROM stock_request_items it
      WHERE it.request_id = r.id AND it.draft_dispatched_qty IS NOT NULL
    )
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
  -- Pinned drafts first (pinned_at IS NULL sorts AFTER timestamps because
  -- NULLS LAST). Among pinned drafts, most-recently-pinned at the top.
  -- Among unpinned, most-recently-updated at the top (existing behaviour).
  ORDER BY r.pinned_at DESC NULLS LAST, r.updated_at DESC;
$$;


-- Per-shop request counts for a given status filter, used by the admin and
-- inventory list pages to render shop quick-filter chips with badge counts.
-- Returns one row per shop that has at least 1 matching request — shops with
-- zero requests for the current filter are pruned by the INNER JOIN.
--
-- p_status        NULL → all statuses (mirrors the "All" chip on the UI).
-- p_inventory_id  NULL → tenant-wide (admin only); otherwise scoped to one
--                        inventory's queue (forced for the Inventory role).
-- Signature changed (added p_from_date / p_to_date) — drop the old 2-param
-- overload first to avoid an ambiguous overload on re-run.
DROP FUNCTION IF EXISTS fn_request_count_by_shop(text, uuid);
-- Second drop — follow-up (28-May-2026) added p_request_type for the
-- "Return" chip filter.
DROP FUNCTION IF EXISTS fn_request_count_by_shop(text, uuid, date, date);

CREATE OR REPLACE FUNCTION fn_request_count_by_shop(
  p_status       text DEFAULT NULL,
  p_inventory_id uuid DEFAULT NULL,
  p_from_date    date DEFAULT NULL,
  p_to_date      date DEFAULT NULL,
  p_request_type request_type DEFAULT NULL
)
RETURNS TABLE (
  shop_id       uuid,
  shop_code     varchar,
  shop_name     varchar,
  request_count bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    s.id     AS shop_id,
    s.code   AS shop_code,
    s.name   AS shop_name,
    COUNT(*)::bigint AS request_count
  FROM stock_requests r
  INNER JOIN shops s ON s.id = r.shop_id
  WHERE r.is_deleted = false
    AND s.is_deleted = false
    AND r.status     <> 'Draft'   -- drafts never contribute to the per-shop chip counts
    AND (p_status       IS NULL OR r.status       = p_status::request_status)
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND (p_request_type IS NULL OR r.request_type = p_request_type)
    -- Same IST day-boundary filter so chip counts match the date-filtered grid.
    AND (p_from_date IS NULL OR r.submitted_at >= (p_from_date::timestamp AT TIME ZONE 'Asia/Kolkata'))
    AND (p_to_date   IS NULL OR r.submitted_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
  GROUP BY s.id, s.code, s.name
  ORDER BY s.code;
$$;


-- Single request with all items aggregated as a JSON array (single round-trip).
-- BE deserializes `items` as `List<StockRequestItemDto>`.
-- Return shape gained `total_dispatched_qty` once; then again for Returns
-- (request_type, source_request_*, accepted_*). Drop before redefining since
-- CREATE OR REPLACE can't change return shape.
DROP FUNCTION IF EXISTS fn_request_get(uuid);

CREATE OR REPLACE FUNCTION fn_request_get(p_id uuid)
RETURNS TABLE (
  id                    uuid,
  code                  varchar,
  shop_id               uuid,
  shop_code             varchar,
  shop_name             varchar,
  -- Contact phone surfaced for the thermal print header — every shop has
  -- contact_phone_1 (NOT NULL on the table). contact_phone_2 left out for now.
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
         -- Cast the enum to varchar — Npgsql 8+ rejects unmapped custom
         -- enum types; keeping the cast makes this SP portable across
         -- Npgsql versions without BE registration changes.
         r.status::varchar       AS status,
         r.request_type::varchar AS request_type,
         r.total_items, r.total_qty,
         -- Explicit ::int / ::numeric casts to keep the column types pinned
         -- even when SUM returns NULL (no dispatched items). Without these,
         -- Npgsql throws InvalidCastException reading DataTypeName '-'.
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
         -- Return → linked Order traceability. NULL for Orders and free-form Returns.
         r.source_request_id,
         src.code AS source_request_code,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_object(
               'id',             it.id,
               'product_id',     it.product_id,
               'product_code',   p.code,
               'product_name',   p.name,
               -- Category is read live from the product master (not snapshotted).
               -- If a category is renamed later, old picklists reflect the new
               -- name. Acceptable since categories rarely change post-launch.
               'category_name',  c.name,
               -- Weight comes from the item row (snapshot at request time),
               -- NOT from the live product master. If the product is later
               -- repacked from 100 g → 120 g, history stays at 100 g.
               'weight_value',   it.weight_value,
               'weight_unit',    it.weight_unit,
               'requested_qty',  it.requested_qty,
               'dispatched_qty', it.dispatched_qty,
               -- Inventory user's WIP dispatch qty (NULL when no draft saved).
               -- Used by the dispatch screen to pre-fill the qty inputs so a
               -- saved draft survives navigating away.
               'draft_dispatched_qty', it.draft_dispatched_qty,
               'unit_price',     it.unit_price,
               'subtotal',       it.subtotal
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
  -- Self-join for the linked Order's code (Returns only). Partial index
  -- idx_stock_requests_source_request keeps this lookup cheap.
  LEFT  JOIN stock_requests src ON src.id = r.source_request_id
  WHERE r.id = p_id AND r.is_deleted = false;
$$;


-- ============================================================
-- 4. STOCK REQUEST — WRITE (create, update)
-- ============================================================

-- Create header + all items in one atomic call. BE computes editable_until.
-- p_items is JSON array of: { product_id, requested_qty, unit_price }
--
-- Side effect: a successful submit ALSO consumes any in-flight shop draft.
-- Because Submit's intent is "this is the finalised version of what I was
-- drafting", the draft is hard-deleted in the same transaction — atomic so
-- we can never end up with a submitted Pending plus a stale Draft.
CREATE OR REPLACE FUNCTION fn_request_create(
  p_code           varchar,
  p_shop_id        uuid,
  p_inventory_id   uuid,
  p_editable_until timestamptz,
  p_notes          varchar,
  p_items          jsonb,
  p_user_id        uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id           uuid;
  v_total_items  int := 0;
  v_total_qty    int := 0;
  v_total_amount numeric(12,2) := 0;
  v_item         jsonb;
  v_qty          int;
  v_price        numeric(10,2);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Stock request must include at least one item';
  END IF;

  INSERT INTO stock_requests (
    code, shop_id, inventory_id, status,
    editable_until, notes,
    created_by, updated_by
  ) VALUES (
    p_code, p_shop_id, p_inventory_id, 'Pending',
    p_editable_until, p_notes,
    p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty   := (v_item->>'requested_qty')::int;
    v_price := (v_item->>'unit_price')::numeric(10,2);

    -- Snapshot weight from the current product master.
    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit
    )
    SELECT v_id,
           p.id,
           v_qty,
           v_price,
           p.weight_value,
           p.weight_unit
    FROM   products p
    WHERE  p.id = (v_item->>'product_id')::uuid;

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty   + v_qty;
    v_total_amount := v_total_amount + (v_qty * v_price);
  END LOOP;

  UPDATE stock_requests
  SET total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount
  WHERE id = v_id;

  -- Consume the shop's draft (if any). Items cascade via ON DELETE CASCADE.
  DELETE FROM stock_requests
  WHERE shop_id = p_shop_id
    AND status  = 'Draft'
    AND is_deleted = false;

  RETURN v_id;
END
$$;


-- ============================================================
-- 4a. STOCK REQUEST — SHOP DRAFTS (single live draft per shop)
-- ============================================================
--
-- Drafts live in stock_requests with status='Draft'. The partial unique
-- index uq_stock_requests_one_draft_per_shop guarantees at most one open
-- draft per shop, so all draft operations are keyed on shop_id rather
-- than an opaque draft id.

-- Upsert the shop's draft. If one exists, items + notes are replaced;
-- if not, a fresh draft row is created. Returns the draft's uuid in
-- both cases.
--
-- Drafts are exempt from the daily editing cutoff — editable_until is
-- set to 'infinity' so they never lock. Once submitted (fn_request_create
-- consumes the draft), the new Pending row gets a real editable_until
-- from the BE.
CREATE OR REPLACE FUNCTION fn_request_save_shop_draft(
  p_shop_id      uuid,
  p_inventory_id uuid,
  p_notes        varchar,
  p_items        jsonb,
  p_user_id      uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id           uuid;
  v_total_items  int := 0;
  v_total_qty    int := 0;
  v_total_amount numeric(12,2) := 0;
  v_item         jsonb;
  v_qty          int;
  v_price        numeric(10,2);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Draft must include at least one item';
  END IF;

  -- Existing draft? Update in place; otherwise insert fresh.
  SELECT id INTO v_id
  FROM stock_requests
  WHERE shop_id = p_shop_id AND status = 'Draft' AND is_deleted = false
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO stock_requests (
      code, shop_id, inventory_id, status,
      editable_until, notes,
      created_by, updated_by
    ) VALUES (
      -- Synthetic code distinct from the REQ-NNNN sequence. The `code`
      -- column is varchar(20), so we use the first 8 hex chars of the
      -- shop uuid (≈ 4 billion combinations) for uniqueness without
      -- spilling past the column limit.
      'DRAFT-' || substring(p_shop_id::text, 1, 8),
      p_shop_id, p_inventory_id, 'Draft',
      -- A century in the future is effectively "never" for our app and
      -- avoids Npgsql's strict-by-default rejection of PostgreSQL's
      -- 'infinity' timestamptz value when reading into DateTimeOffset.
      now() + interval '100 years',
      p_notes,
      p_user_id, p_user_id
    ) RETURNING id INTO v_id;
  ELSE
    -- Wipe existing items so the new set fully replaces (same strategy
    -- as fn_request_update — atomic, no orphan items left behind).
    DELETE FROM stock_request_items WHERE request_id = v_id;

    UPDATE stock_requests
    SET inventory_id = p_inventory_id,
        notes        = p_notes,
        updated_by   = p_user_id
        -- updated_at refreshed by trg_stock_requests_updated trigger
    WHERE id = v_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty   := (v_item->>'requested_qty')::int;
    v_price := (v_item->>'unit_price')::numeric(10,2);

    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit
    )
    SELECT v_id, p.id, v_qty, v_price, p.weight_value, p.weight_unit
    FROM   products p
    WHERE  p.id = (v_item->>'product_id')::uuid;

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty   + v_qty;
    v_total_amount := v_total_amount + (v_qty * v_price);
  END LOOP;

  UPDATE stock_requests
  SET total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount
  WHERE id = v_id;

  RETURN v_id;
END
$$;


-- Fetch a shop's current draft (if any). Returns the same shape as
-- fn_request_get so the BE can deserialise into the same DTO. Empty
-- result set when no draft exists.
-- Return shape gained `updated_at` → must DROP before redefining.
DROP FUNCTION IF EXISTS fn_request_get_shop_draft(uuid);

CREATE OR REPLACE FUNCTION fn_request_get_shop_draft(p_shop_id uuid)
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
  status                  varchar,
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
  cancelled_at            timestamptz,
  cancelled_by            uuid,
  items                   jsonb
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT r.id INTO v_id
  FROM stock_requests r
  WHERE r.shop_id = p_shop_id AND r.status = 'Draft' AND r.is_deleted = false
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;   -- empty set
  END IF;

  RETURN QUERY SELECT * FROM fn_request_get(v_id);
END
$$;


-- Discard a shop's draft. Idempotent — returns true if a draft was
-- deleted, false if none existed.
CREATE OR REPLACE FUNCTION fn_request_delete_shop_draft(p_shop_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM stock_requests
  WHERE shop_id = p_shop_id
    AND status  = 'Draft'
    AND is_deleted = false;
  RETURN FOUND;
END
$$;


-- Update items + notes. Allowed on Pending OR Approved requests
-- (admin can amend after approval, before inventory dispatches).
-- Strategy: wipe existing items, re-insert from p_items, recompute aggregates.
-- Atomic — if any item insert fails, the whole transaction rolls back.
--
-- Role + time-window enforcement is done in the BE before calling this;
-- the proc only checks status to prevent late state-change races.
CREATE OR REPLACE FUNCTION fn_request_update(
  p_id      uuid,
  p_notes   varchar,
  p_items   jsonb,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_total_items  int := 0;
  v_total_qty    int := 0;
  v_total_amount numeric(12,2) := 0;
  v_item         jsonb;
  v_qty          int;
  v_price        numeric(10,2);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id AND status IN ('Pending', 'Approved') AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Stock request must include at least one item';
  END IF;

  DELETE FROM stock_request_items WHERE request_id = p_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty   := (v_item->>'requested_qty')::int;
    v_price := (v_item->>'unit_price')::numeric(10,2);

    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit
    )
    SELECT p_id,
           p.id,
           v_qty,
           v_price,
           p.weight_value,
           p.weight_unit
    FROM   products p
    WHERE  p.id = (v_item->>'product_id')::uuid;

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty   + v_qty;
    v_total_amount := v_total_amount + (v_qty * v_price);
  END LOOP;

  UPDATE stock_requests
  SET notes        = p_notes,
      total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount,
      updated_by   = p_user_id
  WHERE id = p_id;

  RETURN true;
END
$$;


-- ============================================================
-- 5. STATUS TRANSITIONS
-- ============================================================

-- Pending → Approved (admin)
CREATE OR REPLACE FUNCTION fn_request_approve(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_requests
  SET status      = 'Approved',
      approved_at = now(),
      approved_by = p_user_id,
      updated_by  = p_user_id
  WHERE id = p_id
    AND status = 'Pending'
    AND is_deleted = false;
  RETURN FOUND;
END
$$;


-- Pending → Rejected (admin). Reason required.
CREATE OR REPLACE FUNCTION fn_request_reject(
  p_id      uuid,
  p_user_id uuid,
  p_reason  varchar
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  UPDATE stock_requests
  SET status           = 'Rejected',
      rejection_reason = p_reason,
      updated_by       = p_user_id
  WHERE id = p_id
    AND status = 'Pending'
    AND is_deleted = false;
  RETURN FOUND;
END
$$;


-- Approved | Rejected | Cancelled → Pending (inventory user, admin)
-- "Undo" the Approve/Reject/Cancel decision before dispatch happens. Clears
-- the corresponding audit fields so the request looks like it was never
-- acted on; the next action writes fresh timestamps.
-- Cancelled → Pending added 01-Jul-2026 (client req: shop users sometimes
-- cancel by mistake; admin needs to recover).
CREATE OR REPLACE FUNCTION fn_request_revoke(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_requests
  SET status           = 'Pending',
      approved_at      = NULL,
      approved_by      = NULL,
      rejection_reason = NULL,
      cancelled_at     = NULL,
      cancelled_by     = NULL,
      updated_by       = p_user_id
  WHERE id = p_id
    AND status IN ('Approved', 'Rejected', 'Cancelled')
    AND is_deleted = false;
  RETURN FOUND;
END
$$;


-- Approved → Dispatched (inventory user)
-- p_dispatched_items is JSON array of: { id (item id), dispatched_qty }
-- Items not present in the array keep their existing dispatched_qty (NULL).
-- The check constraint on the items table guarantees dispatched_qty <= requested_qty.
CREATE OR REPLACE FUNCTION fn_request_dispatch(
  p_id                uuid,
  p_user_id           uuid,
  p_dispatched_items  jsonb
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_item jsonb;
BEGIN
  -- Approval step has been removed from the workflow: shop submits → inventory
  -- dispatches directly. Pending is the new "ready to dispatch" status, but
  -- we still accept Approved so existing historical rows keep working.
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id AND status IN ('Pending', 'Approved') AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  IF p_dispatched_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_dispatched_items) LOOP
      UPDATE stock_request_items
      SET dispatched_qty = (v_item->>'dispatched_qty')::int
      WHERE id = (v_item->>'id')::uuid
        AND request_id = p_id;   -- safety: only touch items belonging to this request
    END LOOP;
  END IF;

  -- Dispatch-draft qtys are now stale — clear them on the whole request so
  -- nothing reads a half-saved draft after the dispatch is finalised. Same
  -- goes for draft_name: it's a label on a live draft only.
  UPDATE stock_request_items
  SET draft_dispatched_qty = NULL
  WHERE request_id = p_id;

  UPDATE stock_requests
  SET status        = 'Dispatched',
      draft_name    = NULL,
      pinned_at     = NULL,
      dispatched_at = now(),
      dispatched_by = p_user_id,
      updated_by    = p_user_id
  WHERE id = p_id;

  RETURN true;
END
$$;


-- Clear all draft_dispatched_qty on a request — the inventory user's
-- "Discard dispatch draft" path. Status stays unchanged. Idempotent —
-- safe to call when there's no draft (no-op + returns true).
CREATE OR REPLACE FUNCTION fn_request_clear_dispatch_draft(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  -- Same dispatchable-state guard as save/finalise. Once a request has
  -- moved past Pending/Approved there's no draft concept anymore.
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id AND status IN ('Pending', 'Approved') AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  UPDATE stock_request_items
  SET draft_dispatched_qty = NULL
  WHERE request_id = p_id;

  -- Discarding the draft also drops the godown's free-text label AND the
  -- pinned-at flag (both only make sense alongside a live draft).
  UPDATE stock_requests
  SET draft_name = NULL,
      pinned_at  = NULL,
      updated_by = p_user_id
      -- updated_at refreshed by trg_stock_requests_updated trigger
  WHERE id = p_id;

  RETURN true;
END
$$;


-- Save inventory user's work-in-progress dispatch qtys WITHOUT finalising.
-- p_items is JSON array of { id, dispatched_qty } — the dispatched_qty field
-- name is reused so the FE can post the same payload shape to either this
-- SP or fn_request_dispatch. We write into draft_dispatched_qty instead.
--
-- The request status is left unchanged (still Pending). Inventory can call
-- this any number of times before clicking "Mark as Dispatched", which
-- routes through fn_request_dispatch and clears the draft.
CREATE OR REPLACE FUNCTION fn_request_save_dispatch_draft(
  p_id      uuid,
  p_user_id uuid,
  p_items   jsonb
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_item jsonb;
BEGIN
  -- Only valid while the request is still in the dispatchable window.
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id AND status IN ('Pending', 'Approved') AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  IF p_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      UPDATE stock_request_items
      SET draft_dispatched_qty = (v_item->>'dispatched_qty')::int
      WHERE id = (v_item->>'id')::uuid
        AND request_id = p_id;
    END LOOP;
  END IF;

  UPDATE stock_requests
  SET updated_by = p_user_id
      -- updated_at refreshed by trg_stock_requests_updated trigger
  WHERE id = p_id;

  RETURN true;
END
$$;


-- Pin / unpin a dispatch draft so it sorts to the top of the resume strip.
-- Same Pending/Approved guard as the other draft SPs — pinning a finalised
-- request is meaningless. Pass TRUE to pin (sets pinned_at = now()), FALSE
-- to unpin (clears pinned_at). Idempotent — pinning an already-pinned
-- draft just bumps its pin timestamp (which moves it to the top of the
-- pinned group; useful when the dispatcher wants to re-prioritise).
CREATE OR REPLACE FUNCTION fn_request_pin_dispatch_draft(
  p_id      uuid,
  p_user_id uuid,
  p_pinned  boolean
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id AND status IN ('Pending', 'Approved') AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  UPDATE stock_requests
  SET pinned_at  = CASE WHEN p_pinned THEN now() ELSE NULL END,
      updated_by = p_user_id
      -- updated_at refreshed by trg_stock_requests_updated trigger
  WHERE id = p_id;

  RETURN true;
END
$$;


-- Set / clear the godown's free-text label on a saved dispatch draft.
-- Separate from fn_request_save_dispatch_draft so the two concerns don't
-- collide: qty auto-saves shouldn't clobber a manually-set name, and the
-- rename UI shouldn't have to ship the full qty payload just to change a
-- label. Pass NULL to clear (or any string up to 60 chars to set).
-- Same Pending/Approved guard as save — naming a finalised request is
-- meaningless.
CREATE OR REPLACE FUNCTION fn_request_rename_dispatch_draft(
  p_id      uuid,
  p_user_id uuid,
  p_name    text     -- NULL to clear; BE has already trimmed + null-empty'd
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id AND status IN ('Pending', 'Approved') AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  UPDATE stock_requests
  SET draft_name = p_name,
      updated_by = p_user_id
      -- updated_at refreshed by trg_stock_requests_updated trigger
  WHERE id = p_id;

  RETURN true;
END
$$;


-- Dispatched → Received (shop user)
CREATE OR REPLACE FUNCTION fn_request_receive(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_requests
  SET status      = 'Received',
      received_at = now(),
      received_by = p_user_id,
      updated_by  = p_user_id
  WHERE id = p_id
    AND status = 'Dispatched'
    AND is_deleted = false;
  RETURN FOUND;
END
$$;


-- Cancel from Pending or Approved (either shop user or admin, role-gated in BE)
CREATE OR REPLACE FUNCTION fn_request_cancel(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_requests
  SET status        = 'Cancelled',
      cancelled_at  = now(),
      cancelled_by  = p_user_id,
      updated_by    = p_user_id
  WHERE id = p_id
    AND status IN ('Pending', 'Approved')
    AND is_deleted = false;
  RETURN FOUND;
END
$$;


-- ============================================================
-- 8. RETURN STOCK (Phase 2 feature, 27-May-2026)
-- ============================================================
--   Returns are stock_requests rows with request_type = 'Return'. They
--   share the same table + items table + most lifecycle SPs as Orders.
--   Lifecycle: Pending → Accepted (terminal) + Rejected, Cancelled.
--   No Approve / Dispatch / Receive states — only one physical movement.
--
--   Accounts (Phase 3) reads source_request_id + each item's unit_price
--   snapshot to post a reverse ledger entry against the linked Order.
-- ============================================================

-- Create a Return — shop user is sending goods back to the godown. Optional
-- p_source_request_id links the Return to the Order it reverses; if NULL the
-- Return is "free-form" (rare; accounts uses current MRP as fallback).
--
-- Mirrors fn_request_create's shape (item array, code, totals roll-up), but:
--   • Forces request_type = 'Return'.
--   • Sets editable_until to far-future (Returns aren't subject to the daily
--     cutoff; the shop can edit/cancel as long as status = 'Pending').
--   • Persists the optional source_request_id (chk_source_only_for_returns
--     guarantees it's NULL on Orders).
CREATE OR REPLACE FUNCTION fn_request_create_return(
  p_code               varchar,
  p_shop_id            uuid,
  p_inventory_id       uuid,
  p_source_request_id  uuid,    -- NULL = free-form return
  p_notes              varchar,
  p_items              jsonb,
  p_user_id            uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id           uuid;
  v_total_items  int := 0;
  v_total_qty    int := 0;
  v_total_amount numeric(12,2) := 0;
  v_item         jsonb;
  v_qty          int;
  v_price        numeric(10,2);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Return must include at least one item';
  END IF;

  -- editable_until: 100-year horizon. Returns don't have a daily cutoff —
  -- the same column is reused so we don't need a NULL-allowed schema change.
  INSERT INTO stock_requests (
    code, shop_id, inventory_id, status, request_type,
    source_request_id, editable_until, notes,
    created_by, updated_by
  ) VALUES (
    p_code, p_shop_id, p_inventory_id, 'Pending', 'Return',
    p_source_request_id, now() + interval '100 years', p_notes,
    p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty   := (v_item->>'requested_qty')::int;
    v_price := (v_item->>'unit_price')::numeric(10,2);

    -- Same item shape as Orders: requested_qty = "what shop says it's
    -- returning". Snapshot weight from the current product master so the
    -- Return's audit row doesn't drift if the product is later repacked.
    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit
    )
    SELECT v_id,
           p.id,
           v_qty,
           v_price,
           p.weight_value,
           p.weight_unit
    FROM   products p
    WHERE  p.id = (v_item->>'product_id')::uuid;

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty   + v_qty;
    v_total_amount := v_total_amount + (v_qty * v_price);
  END LOOP;

  UPDATE stock_requests
  SET total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount
  WHERE id = v_id;

  RETURN v_id;
END
$$;


-- Accept a Pending Return — inventory closes it out. Items JSON is the same
-- shape as fn_request_dispatch's payload: { id, dispatched_qty } per item,
-- where dispatched_qty is overloaded to mean "qty the godown actually accepted"
-- on a Return (partial accept allowed — godown may receive less than the shop
-- claimed they were returning).
--
-- Status flips Pending → Accepted, accepted_at / accepted_by are set. The SP
-- guards on status = 'Pending' AND request_type = 'Return' so this cannot be
-- accidentally called on an Order.
CREATE OR REPLACE FUNCTION fn_request_accept_return(
  p_id      uuid,
  p_user_id uuid,
  p_items   jsonb     -- array of { id, dispatched_qty }
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_item jsonb;
BEGIN
  -- Guard: only Pending Returns are accept-able.
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id
      AND request_type = 'Return'
      AND status       = 'Pending'
      AND is_deleted   = false
  ) THEN
    RETURN false;
  END IF;

  -- Per-item accepted qty (reuses dispatched_qty column).
  IF p_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      UPDATE stock_request_items
      SET dispatched_qty = (v_item->>'dispatched_qty')::int
      WHERE id = (v_item->>'id')::uuid
        AND request_id = p_id;
    END LOOP;
  END IF;

  -- Flip status + audit. updated_at trigger refreshes itself.
  UPDATE stock_requests
  SET status      = 'Accepted',
      accepted_at = now(),
      accepted_by = p_user_id,
      updated_by  = p_user_id
  WHERE id = p_id;

  RETURN true;
END
$$;


-- ============================================================
-- Admin post-completion dispatched_qty edit (client #9, 28-May-2026)
-- ------------------------------------------------------------
-- Admin can amend an item's delivered qty after the request is Received
-- (Orders) or Accepted (Returns) — e.g. correcting a counting error a few
-- days after the fact. Phase 3 accounts uses the audit trail to post a
-- reconciliation entry whenever the qty drifts.
--
-- Guards:
--   • Request status must be in ('Received','Accepted') and not soft-deleted.
--   • new_qty must be >= 0 OR NULL (NULL means "clear the dispatched value").
--     No upper cap — matches the existing dispatch flow which already lets
--     inventory deliver more than requested.
--   • Insert a NEW audit row regardless of whether old/new differ on the
--     surface — the table CHECK guards against no-op rows so callers don't
--     pollute the trail. Returns false when guards fail.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_request_item_edit_dispatched_qty(
  p_item_id   uuid,
  p_new_qty   int,
  p_reason    varchar,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_request_id   uuid;
  v_status       request_status;
  v_old_qty      int;
BEGIN
  -- Bound check first — accept NULL (clear) or non-negative ints.
  IF p_new_qty IS NOT NULL AND p_new_qty < 0 THEN
    RETURN false;
  END IF;

  -- Resolve the parent request + current qty in one shot so we can validate
  -- status and capture the "before" value for the audit row.
  SELECT i.request_id, r.status, i.dispatched_qty
    INTO v_request_id, v_status, v_old_qty
  FROM stock_request_items i
  JOIN stock_requests      r ON r.id = i.request_id
  WHERE i.id = p_item_id
    AND r.is_deleted = false;

  IF v_request_id IS NULL THEN
    RETURN false;  -- item not found, or its parent request is soft-deleted
  END IF;

  IF v_status NOT IN ('Received', 'Accepted') THEN
    RETURN false;  -- only post-completion edits allowed
  END IF;

  -- No-op guard — don't write an audit row when nothing changed. The table
  -- CHECK would reject it anyway, but failing silently here is friendlier.
  IF v_old_qty IS NOT DISTINCT FROM p_new_qty THEN
    RETURN true;
  END IF;

  UPDATE stock_request_items
  SET dispatched_qty = p_new_qty
  WHERE id = p_item_id;

  INSERT INTO stock_request_qty_audits
    (request_item_id, request_id, old_qty, new_qty, reason, edited_by)
  VALUES
    (p_item_id, v_request_id, v_old_qty, p_new_qty,
     NULLIF(btrim(COALESCE(p_reason, '')), ''),
     p_user_id);

  -- Bump the parent so the FE detail page picks up the change via the
  -- existing updated_at-driven cache invalidation.
  UPDATE stock_requests
  SET updated_by = p_user_id
  WHERE id = v_request_id;

  RETURN true;
END
$$;


COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- SELECT fn_request_next_code();                          -- expect 'REQ0001' on empty table
-- SELECT * FROM fn_settings_list();                       -- one row: request_lock_cutoff = '09:00'
-- SELECT * FROM fn_request_list_paged(NULL,NULL,NULL,NULL,1,10);  -- empty until rows exist
-- SELECT fn_request_count(NULL,NULL,NULL,NULL);          -- 0 initially
-- ============================================================
