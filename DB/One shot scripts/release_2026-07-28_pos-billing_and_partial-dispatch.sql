-- ============================================================
-- Kovilpatti Snacks — CONSOLIDATED DEPLOY (one script)
-- Everything since last deploy: partial-weight dispatch +
-- all Phase-4 billing features. Idempotent — safe to re-run.
--
-- Prereq: base schema already deployed (phase1/2/3/4 init +
-- phase4_billing_init.sql + phase4_billing_procedures.sql).
-- Supabase: paste + Run.  psql: -v ON_ERROR_STOP=1 -f this.
-- ============================================================


-- ############################################################
-- >>> One shot scripts/partial_weight_dispatch.sql
-- ############################################################

-- ============================================================
-- 25-Jul-2026 — Partial-weight dispatch capability (Order side)
-- ============================================================
-- Adds fields + helpers so the godown can dispatch a partial-weight pack
-- (e.g. 3 kg from a 5 kg SKU) instead of an integer packet count. Every
-- rollup — request detail, list, Accounts KPIs — recomputes via the new
-- effective-pack-qty helpers.
--
-- DEPLOY ORDER (UAT / PROD):
--   1. Run THIS one-shot   → ALTER TABLE + 3 helper SQL functions
--   2. Run phase2_procedures.sql  → dispatch/receive/get/list SPs use the helpers
--   3. Run phase3_procedures.sql  → Accounts SPs (summary/trend/by-shop/…) use them
--   4. Run phase4_shop_inventory_procedures.sql → opening-balance bootstrap uses them
--
-- Files 2-4 are all CREATE OR REPLACE so they're safe to re-run any
-- number of times. Only THIS one-shot mutates data schema.
--
-- Idempotent: every ALTER is guarded with a NOT EXISTS check so re-running
-- on a DB that already picked up the migration is a no-op.
-- ============================================================

BEGIN;

-- ── 1. New columns on stock_request_items ────────────────────
--
-- Order-side partial-weight dispatch (dispatched_weight_g) + shop's
-- receive-time correction of same (received_weight_g) + WIP draft
-- companion (draft_dispatched_weight_g). All nullable — NULL keeps
-- rows in packet-count mode (existing behaviour, no data migration
-- needed).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_request_items' AND column_name = 'dispatched_weight_g'
  ) THEN
    ALTER TABLE stock_request_items ADD COLUMN dispatched_weight_g numeric(10,3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_request_items' AND column_name = 'received_weight_g'
  ) THEN
    ALTER TABLE stock_request_items ADD COLUMN received_weight_g numeric(10,3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_request_items' AND column_name = 'draft_dispatched_weight_g'
  ) THEN
    ALTER TABLE stock_request_items ADD COLUMN draft_dispatched_weight_g numeric(10,3);
  END IF;
END $$;


-- ── 2. Bounds + XOR check constraints ────────────────────────
--
-- Positive-only when set (0-weight dispatch is meaningless — use
-- dispatched_qty=0 for "explicitly nothing shipped"). Mutual-exclusion
-- with the packet-count counterpart per leg (dispatch / receive / draft).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_dispatched_weight_g_bounds'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_dispatched_weight_g_bounds
        CHECK (dispatched_weight_g IS NULL OR dispatched_weight_g > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_received_weight_g_bounds'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_received_weight_g_bounds
        CHECK (received_weight_g IS NULL OR received_weight_g > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_draft_dispatched_weight_g_bounds'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_draft_dispatched_weight_g_bounds
        CHECK (draft_dispatched_weight_g IS NULL OR draft_dispatched_weight_g > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_dispatched_qty_xor_weight'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_dispatched_qty_xor_weight
        CHECK (dispatched_qty IS NULL OR dispatched_weight_g IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_received_qty_xor_weight'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_received_qty_xor_weight
        CHECK (received_qty IS NULL OR received_weight_g IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_draft_dispatched_qty_xor_weight'
  ) THEN
    ALTER TABLE stock_request_items
      ADD CONSTRAINT chk_draft_dispatched_qty_xor_weight
        CHECK (draft_dispatched_qty IS NULL OR draft_dispatched_weight_g IS NULL);
  END IF;
END $$;


-- ── 3. Effective-pack-qty helpers ────────────────────────────
--
-- Converts (qty, weight_g) → effective packet-equivalent count. Used
-- across every rollup so partial-weight rows contribute proportionally.
-- Priority per leg: weight_g populated → weight_g / pack_g ; qty
-- populated → qty::numeric ; neither → NULL.

CREATE OR REPLACE FUNCTION fn_effective_pack_qty(
  p_qty          int,
  p_weight_g     numeric,
  p_weight_value numeric,
  p_weight_unit  varchar
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_weight_g IS NOT NULL AND p_weight_value IS NOT NULL AND p_weight_value > 0 THEN
      p_weight_g / (p_weight_value * CASE p_weight_unit WHEN 'kg' THEN 1000 ELSE 1 END)
    WHEN p_qty IS NOT NULL THEN
      p_qty::numeric
    ELSE
      NULL
  END;
$$;

-- Order-side effective qty — received leg wins over dispatched, falls
-- back to requested.
CREATE OR REPLACE FUNCTION fn_order_effective_qty(
  p_received_qty        int,
  p_received_weight_g   numeric,
  p_dispatched_qty      int,
  p_dispatched_weight_g numeric,
  p_requested_qty       int,
  p_weight_value        numeric,
  p_weight_unit         varchar
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    fn_effective_pack_qty(p_received_qty,   p_received_weight_g,   p_weight_value, p_weight_unit),
    fn_effective_pack_qty(p_dispatched_qty, p_dispatched_weight_g, p_weight_value, p_weight_unit),
    p_requested_qty::numeric
  );
$$;

-- Return-side effective qty — return_weight_g partial (if present) beats
-- dispatched_qty (accepted-qty on Returns), falls back to requested.
-- Also fixes an existing gap: partial-weight Returns (02-Jul-2026 feature)
-- were never rolled into Accounts.
CREATE OR REPLACE FUNCTION fn_return_effective_qty(
  p_dispatched_qty  int,
  p_return_weight_g numeric,
  p_requested_qty   int,
  p_weight_value    numeric,
  p_weight_unit     varchar
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    fn_effective_pack_qty(p_dispatched_qty, p_return_weight_g, p_weight_value, p_weight_unit),
    p_requested_qty::numeric
  );
$$;

COMMIT;

-- ── 4. Follow-up ──────────────────────────────────────────────
-- Now run these files in order:
--   \i phase2/phase2_procedures.sql
--   \i phase3/phase3_procedures.sql
--   \i phase4/phase4_shop_inventory_procedures.sql
-- All three use CREATE OR REPLACE — safe on any existing install.


-- ############################################################
-- >>> phase2/phase2_procedures.sql
-- ############################################################

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
-- 1a. LINE-LEVEL EFFECTIVE PACK-QTY HELPER
-- ============================================================
--   Converts a (qty, weight_g) pair into an "effective packet-equivalent
--   count" — used across every rollup so partial-weight dispatch rows
--   contribute proportionally to sums, avg costs, and value math.
--
--   Priority per leg:
--     • weight_g populated (partial mode) → weight_g / pack_g
--     • qty populated (packet mode)       → qty::numeric
--     • neither                           → NULL (caller COALESCEs to
--                                           the next leg down)
--
--   pack_g = weight_value × (1000 if unit='kg' else 1). Non-weight products
--   (unit not g/kg) can only reach the qty branch — partial mode is UI-
--   gated to weight_unit IN ('g','kg') on the FE, and the XOR CHECK on
--   stock_request_items guarantees at most one field is set per line.
--
--   Used by every dispatch/receive/get/accounts SP below.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_effective_pack_qty(
  p_qty          int,
  p_weight_g     numeric,
  p_weight_value numeric,
  p_weight_unit  varchar
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_weight_g IS NOT NULL AND p_weight_value IS NOT NULL AND p_weight_value > 0 THEN
      p_weight_g / (p_weight_value * CASE p_weight_unit WHEN 'kg' THEN 1000 ELSE 1 END)
    WHEN p_qty IS NOT NULL THEN
      p_qty::numeric
    ELSE
      NULL
  END;
$$;

-- Effective Order-side qty for one line — received leg wins over
-- dispatched leg, falls back to requested. Used everywhere an Order-line
-- rollup needs the "what actually landed with the shop" number.
CREATE OR REPLACE FUNCTION fn_order_effective_qty(
  p_received_qty        int,
  p_received_weight_g   numeric,
  p_dispatched_qty      int,
  p_dispatched_weight_g numeric,
  p_requested_qty       int,
  p_weight_value        numeric,
  p_weight_unit         varchar
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    fn_effective_pack_qty(p_received_qty,   p_received_weight_g,   p_weight_value, p_weight_unit),
    fn_effective_pack_qty(p_dispatched_qty, p_dispatched_weight_g, p_weight_value, p_weight_unit),
    p_requested_qty::numeric
  );
$$;

-- Effective Return-side qty for one line — return_weight_g partial (if
-- present) beats dispatched_qty (which stores the accepted packet count
-- on Returns), falls back to requested. Fixes an existing gap: partial-
-- weight Returns (02-Jul-2026 feature) were never rolled into Accounts.
CREATE OR REPLACE FUNCTION fn_return_effective_qty(
  p_dispatched_qty  int,
  p_return_weight_g numeric,
  p_requested_qty   int,
  p_weight_value    numeric,
  p_weight_unit     varchar
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    fn_effective_pack_qty(p_dispatched_qty, p_return_weight_g, p_weight_value, p_weight_unit),
    p_requested_qty::numeric
  );
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
-- 06-Jul-2026 — RETURNS TABLE shape swapped parent_request_*/expected_arrival_at
-- for is_special/special_label as part of the Special Request rework. Signature
-- (arg list) unchanged, but return-shape drift → drop the pre-rework shape.
-- Idempotent on a fresh DB (nothing to drop).
--
-- 15-Jul-2026: signature gained p_include_drafts + p_user_id so admin's
-- own draft rows can be surfaced in the list (via a "My Drafts" preset).
-- Drafts stay HIDDEN by default (p_include_drafts=false) — same behaviour
-- for every existing caller. Only when include-drafts is true AND the
-- caller passes their user id are draft rows created by that user
-- included. Shape unchanged → CREATE OR REPLACE handles both branches.
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
  p_request_type request_type   DEFAULT NULL,
  -- 15-Jul-2026: when true AND p_user_id is non-null, ALSO include
  -- status='Draft' rows created_by that user. Powers the admin "My Drafts"
  -- filter so an admin who saved a draft can see + resume it from the
  -- list. Default false → identical behaviour to existing callers.
  p_include_drafts boolean      DEFAULT false,
  p_user_id        uuid         DEFAULT NULL,
  -- 15-Jul-2026: is_special filter — NULL = no filter (default,
  -- behaviour unchanged), true = only Special Requests, false = only
  -- non-special. Drives the "Special Order" preset chip across admin /
  -- shop / inventory list pages.
  p_is_special     boolean      DEFAULT NULL
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
  -- Signed adjustment total: Σ(received_qty − dispatched_qty) across
  -- items where the shop reported a value. NULL when no items have
  -- received_qty set (no discrepancies at all — request confirmed as
  -- dispatched). 0 when reported but the +/− across lines nets to zero.
  -- Powers the "Adjustment Qty" column on the request list tables.
  -- 03-Jul-2026.
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
  -- Special Request flags (06-Jul-2026). is_special is set by the shop on
  -- the review/submit step; special_label is the user-supplied name (e.g.
  -- "Diwali stock 2026"). Both NULL/false on normal orders.
  is_special              boolean,
  special_label           varchar
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
         -- 25-Jul-2026: sums effective-pack qty so partial-weight rows
         -- contribute their fractional-equivalent, rounded to int for
         -- BE-side backward compat (audit table + entity still int-typed).
         (SELECT ROUND(COALESCE(SUM(
            fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit)
          ), 0))::int
          FROM stock_request_items it
          WHERE it.request_id = r.id) AS total_dispatched_qty,
         -- Signed adjustment total. Σ(received − dispatched) across items
         -- with received_qty set. NULL when no items reported discrepancy;
         -- 0 when reported but net-zero; ±N when short (−) or over (+).
         -- 03-Jul-2026.
         -- 25-Jul-2026: adjustment aggregate honours partial-weight rows —
         -- effective received-pack minus effective dispatched-pack, per row
         -- where the shop actually reported (qty OR weight). Rounded int
         -- (audit column stays int-typed).
         (SELECT ROUND(SUM(
            COALESCE(fn_effective_pack_qty(it.received_qty,   it.received_weight_g,   it.weight_value, it.weight_unit), 0)
          - COALESCE(fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit), 0)
          ))::int
          FROM stock_request_items it
          WHERE it.request_id = r.id
            AND (it.received_qty IS NOT NULL OR it.received_weight_g IS NOT NULL)) AS total_adjustment_qty,
         r.total_amount,
         -- 25-Jul-2026: uses effective-pack helper so partial-weight rows
         -- contribute their fractional value ((weight_g/pack_g) × price).
         (SELECT SUM(
            COALESCE(
              fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit),
              0
            ) * it.unit_price
          )::numeric(12,2)
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
         -- Special Request flags. is_special = shop declared this a special
         -- (vendor procurement). special_label = shop-supplied name.
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
  -- Self-join for the linked Order's code (Returns only). Partial index
  -- idx_stock_requests_source_request keeps this lookup cheap.
  LEFT  JOIN stock_requests src ON src.id = r.source_request_id
  WHERE r.is_deleted = false
    -- Drafts hidden by default. When p_include_drafts is true AND the caller
    -- passes their user id, drafts created by that user leak through — the
    -- exact opt-in for the admin "My Drafts" filter (15-Jul-2026). Users
    -- never see other users' drafts (draft rows belong to the person who
    -- last saved them).
    AND (r.status <> 'Draft'
         OR (p_include_drafts = true AND p_user_id IS NOT NULL AND r.created_by = p_user_id))
    AND (p_shop_id      IS NULL OR r.shop_id      = p_shop_id)
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND (p_status       IS NULL OR r.status       = p_status)
    AND (p_search       IS NULL OR r.code ILIKE '%' || p_search || '%')
    AND (p_request_type IS NULL OR r.request_type = p_request_type)
    -- 15-Jul-2026: is_special filter — NULL leaves everything through,
    -- true keeps only special requests, false keeps only non-special.
    AND (p_is_special   IS NULL OR r.is_special   = p_is_special)
    -- IST day boundaries: p_from_date's midnight (IST) → UTC instant; upper
    -- bound is p_to_date + 1 day midnight (IST), exclusive, so the whole
    -- p_to_date day is included. Drafts don't have submitted_at (still Draft
    -- status) so the date filter below excludes them — the include-drafts
    -- caller compensates by lifting the date filter FE-side (my-drafts view
    -- is not date-scoped).
    AND (p_from_date IS NULL OR r.submitted_at >= (p_from_date::timestamp AT TIME ZONE 'Asia/Kolkata') OR r.status = 'Draft')
    AND (p_to_date   IS NULL OR r.submitted_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') OR r.status = 'Draft')
  ORDER BY r.submitted_at DESC NULLS FIRST
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;


-- Signature changed (added p_from_date / p_to_date) — drop the old 4-param
-- overload first to avoid an ambiguous overload on re-run.
DROP FUNCTION IF EXISTS fn_request_count(uuid, uuid, request_status, varchar);
-- Second drop — follow-up (28-May-2026) added p_request_type for the
-- "Return" chip filter.
DROP FUNCTION IF EXISTS fn_request_count(uuid, uuid, request_status, varchar, date, date);
-- Third drop — 15-Jul-2026 adds p_include_drafts + p_user_id to match
-- fn_request_list_paged so total count reflects the same "My Drafts"
-- opt-in filter.
DROP FUNCTION IF EXISTS fn_request_count(uuid, uuid, request_status, varchar, date, date, request_type);

CREATE OR REPLACE FUNCTION fn_request_count(
  p_shop_id      uuid           DEFAULT NULL,
  p_inventory_id uuid           DEFAULT NULL,
  p_status       request_status DEFAULT NULL,
  p_search       varchar        DEFAULT NULL,
  p_from_date    date           DEFAULT NULL,
  p_to_date      date           DEFAULT NULL,
  p_request_type request_type   DEFAULT NULL,
  -- 15-Jul-2026: mirror fn_request_list_paged so total-row count matches
  -- the list output when the "My Drafts" preset is active.
  p_include_drafts boolean      DEFAULT false,
  p_user_id        uuid         DEFAULT NULL,
  -- 15-Jul-2026: mirror fn_request_list_paged's is_special filter so the
  -- pagination row-count matches the visible list under the "Special
  -- Order" preset.
  p_is_special     boolean      DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)
  FROM stock_requests r
  WHERE r.is_deleted = false
    -- Match fn_request_list_paged: drafts hidden unless the caller opts in
    -- AND owns the draft rows via created_by.
    AND (r.status <> 'Draft'
         OR (p_include_drafts = true AND p_user_id IS NOT NULL AND r.created_by = p_user_id))
    AND (p_shop_id      IS NULL OR r.shop_id      = p_shop_id)
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND (p_status       IS NULL OR r.status       = p_status)
    AND (p_search       IS NULL OR r.code ILIKE '%' || p_search || '%')
    AND (p_request_type IS NULL OR r.request_type = p_request_type)
    AND (p_is_special   IS NULL OR r.is_special   = p_is_special)
    -- Same IST day-boundary filter as fn_request_list_paged so count matches list.
    -- Draft rows have no submitted_at yet — bypass the date bounds so they
    -- always show under the "My Drafts" preset regardless of date filter.
    AND (p_from_date IS NULL OR r.submitted_at >= (p_from_date::timestamp AT TIME ZONE 'Asia/Kolkata') OR r.status = 'Draft')
    AND (p_to_date   IS NULL OR r.submitted_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') OR r.status = 'Draft');
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
-- p_request_ids  NULL / empty → every Approved request in the scope.
--                populated → aggregate only those request IDs (still
--                gated to Approved + inventory scope so the caller can't
--                sneak in a request outside their inventory). Powers the
--                Cumulative-print selection dialog (02-Jul-2026).
-- 06-Jul-2026 (client req): split total_qty into order_qty + special_qty so
-- the cumulative print can flag any SKU whose qty carries a Special Request
-- contribution (amber "SP" pill on the line). total_qty is kept as the sum
-- of both — the kitchen still packs one number per SKU. The Special-flag
-- lives on stock_requests.is_special (formerly the retired Backorder enum);
-- semantics unchanged from the kitchen's POV: "some of this batch is a
-- special-order vendor procurement, not stock we already had".
--
-- Return-signature drift → drop every prior shape (both the pre-split shape
-- and the interim backorder_qty-named shape) before CREATE OR REPLACE.
DROP FUNCTION IF EXISTS fn_request_pending_cumulative(uuid, uuid[]);

CREATE OR REPLACE FUNCTION fn_request_pending_cumulative(
  p_inventory_id uuid   DEFAULT NULL,
  p_request_ids  uuid[] DEFAULT NULL
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
  order_qty       bigint,
  special_qty     bigint,
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
    SUM(it.requested_qty)::bigint                                                        AS total_qty,
    SUM(CASE WHEN r.is_special THEN 0 ELSE it.requested_qty END)::bigint                 AS order_qty,
    SUM(CASE WHEN r.is_special THEN it.requested_qty ELSE 0 END)::bigint                 AS special_qty,
    COUNT(DISTINCT r.id)::bigint                                                         AS request_count
  FROM stock_requests r
  INNER JOIN stock_request_items it ON it.request_id = r.id
  INNER JOIN products            p  ON p.id  = it.product_id
  INNER JOIN categories          c  ON c.id  = p.category_id
  WHERE r.is_deleted = false
    -- Approved (= "In-Progress") only. See function header for why we don't
    -- source from Pending.
    AND r.status = 'Approved'
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND (p_request_ids  IS NULL OR cardinality(p_request_ids) = 0
         OR r.id = ANY(p_request_ids))
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
         -- 25-Jul-2026: sums effective-pack qty so partial-weight rows
         -- contribute their fractional-equivalent, rounded to int for
         -- BE-side backward compat (audit table + entity still int-typed).
         (SELECT ROUND(COALESCE(SUM(
            fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit)
          ), 0))::int
          FROM stock_request_items it
          WHERE it.request_id = r.id) AS total_dispatched_qty,
         r.total_amount,
         -- 25-Jul-2026: uses effective-pack helper so partial-weight rows
         -- contribute their fractional value ((weight_g/pack_g) × price).
         (SELECT SUM(
            COALESCE(
              fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit),
              0
            ) * it.unit_price
          )::numeric(12,2)
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

-- Signature changed 01-Jul-2026 — added parent_request_id, parent_request_code,
-- expected_arrival_at, backorder_children. 06-Jul-2026 — swapped those for
-- is_special / special_label as part of the Special Request rework. Extra
-- DROP left in place so re-runs on any historical DB shape land cleanly.
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
  -- Signed adjustment total: Σ(received − dispatched) across items where
  -- the shop reported a value. NULL when no receipt discrepancies at all,
  -- 0 when net-zero, ±N otherwise. 03-Jul-2026.
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
  -- Special Request flags (06-Jul-2026). See fn_request_list_paged for
  -- semantics. Both NULL/false on normal orders.
  is_special              boolean,
  special_label           varchar,
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
         -- 25-Jul-2026: sums effective-pack qty so partial-weight rows
         -- contribute their fractional-equivalent, rounded to int for
         -- BE-side backward compat (audit table + entity still int-typed).
         (SELECT ROUND(COALESCE(SUM(
            fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit)
          ), 0))::int
          FROM stock_request_items it
          WHERE it.request_id = r.id) AS total_dispatched_qty,
         -- Signed adjustment aggregate (03-Jul-2026). Matches
         -- fn_request_list_paged so both list + detail expose it.
         -- 25-Jul-2026: adjustment aggregate honours partial-weight rows —
         -- effective received-pack minus effective dispatched-pack, per row
         -- where the shop actually reported (qty OR weight). Rounded int
         -- (audit column stays int-typed).
         (SELECT ROUND(SUM(
            COALESCE(fn_effective_pack_qty(it.received_qty,   it.received_weight_g,   it.weight_value, it.weight_unit), 0)
          - COALESCE(fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit), 0)
          ))::int
          FROM stock_request_items it
          WHERE it.request_id = r.id
            AND (it.received_qty IS NOT NULL OR it.received_weight_g IS NOT NULL)) AS total_adjustment_qty,
         r.total_amount,
         -- 25-Jul-2026: uses effective-pack helper so partial-weight rows
         -- contribute their fractional value ((weight_g/pack_g) × price).
         (SELECT SUM(
            COALESCE(
              fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit),
              0
            ) * it.unit_price
          )::numeric(12,2)
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
         -- Special Request flags (06-Jul-2026).
         r.is_special,
         r.special_label,
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
               -- Shop's actual count at receive time (02-Jul-2026). NULL
               -- means "no discrepancy noted" (received == dispatched);
               -- non-NULL means the shop entered a different number.
               'received_qty',   it.received_qty,
               -- Return-only partial-weight claim in grams (02-Jul-2026).
               -- Null on Orders + full-pack Returns.
               'return_weight_g', it.return_weight_g,
               -- 25-Jul-2026: partial-weight dispatch companions. Non-NULL
               -- means the godown shipped a partial pack instead of full
               -- packets (dispatched_weight_g), and/or the shop's receive-
               -- time correction of that partial (received_weight_g). XOR
               -- with the qty fields — never both on the same leg.
               'dispatched_weight_g', it.dispatched_weight_g,
               'received_weight_g',   it.received_weight_g,
               -- Inventory user's WIP dispatch qty (NULL when no draft saved).
               -- Used by the dispatch screen to pre-fill the qty inputs so a
               -- saved draft survives navigating away.
               'draft_dispatched_qty', it.draft_dispatched_qty,
               -- 25-Jul-2026: partial-weight companion to draft_dispatched_qty.
               'draft_dispatched_weight_g', it.draft_dispatched_weight_g,
               'unit_price',     it.unit_price,
               'subtotal',       it.subtotal,
               -- 'Shop' | 'Inventory' — flags items the godown appended
               -- post-approval so shop / admin / picklist can render the
               -- (inv) tag alongside the product name.
               'added_by',       it.added_by
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
-- 06-Jul-2026: signature gained p_is_special + p_special_label for the
-- Special Request rework. Prior 7-arg shape dropped so re-runs on any DB
-- state install the new signature cleanly.
DROP FUNCTION IF EXISTS fn_request_create(varchar, uuid, uuid, timestamptz, varchar, jsonb, uuid);

CREATE OR REPLACE FUNCTION fn_request_create(
  p_code           varchar,
  p_shop_id        uuid,
  p_inventory_id   uuid,
  p_editable_until timestamptz,
  p_notes          varchar,
  p_items          jsonb,
  p_user_id        uuid,
  -- Special Request flags. p_is_special defaults to false so pre-rework
  -- callers still work; the FE explicitly passes both values when the shop
  -- toggles "Mark as Special Request" on the review/submit step.
  p_is_special     boolean  DEFAULT false,
  p_special_label  varchar  DEFAULT NULL
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
    is_special, special_label,
    created_by, updated_by
  ) VALUES (
    p_code, p_shop_id, p_inventory_id, 'Pending',
    p_editable_until, p_notes,
    COALESCE(p_is_special, false),
    -- Label only stored when actually special (chk_special_label_only_when_special).
    CASE WHEN COALESCE(p_is_special, false) THEN NULLIF(TRIM(p_special_label), '') ELSE NULL END,
    p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty   := (v_item->>'requested_qty')::int;
    v_price := (v_item->>'unit_price')::numeric(10,2);

    -- Snapshot weight + purchase price from the current product master.
    -- purchase_price_snapshot freezes the cost basis exactly like
    -- unit_price freezes MRP — accounts cost math never re-reads products.
    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit, purchase_price_snapshot
    )
    SELECT v_id,
           p.id,
           v_qty,
           v_price,
           p.weight_value,
           p.weight_unit,
           p.purchase_price
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

  -- Consume the caller's draft on that shop (if any). Items cascade via
  -- ON DELETE CASCADE. 08-Jul-2026: scoped by created_by too so admin's
  -- submit doesn't wipe Shop A user's own draft (or vice versa).
  DELETE FROM stock_requests
  WHERE shop_id    = p_shop_id
    AND created_by = p_user_id
    AND status     = 'Draft'
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
  -- 08-Jul-2026: scoped by (shop_id, created_by=p_user_id) so admin's
  -- draft for Shop A doesn't collide with Shop A user's own draft.
  -- Matches the uq_stock_requests_one_draft_per_shop_user partial index.
  SELECT id INTO v_id
  FROM stock_requests
  WHERE shop_id = p_shop_id
    AND created_by = p_user_id
    AND status = 'Draft'
    AND is_deleted = false
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
      weight_value, weight_unit, purchase_price_snapshot
    )
    SELECT v_id, p.id, v_qty, v_price, p.weight_value, p.weight_unit, p.purchase_price
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
-- 08-Jul-2026: signature gained p_user_id so admin's draft on Shop A
-- and Shop A user's own draft are addressed independently. Prior
-- 1-arg shape dropped so both DB states re-apply cleanly.
-- 22-Jul-2026: return shape realigned to fn_request_get after the
-- latter picked up shop_contact_phone / accepted_* / request_type /
-- total_adjustment_qty / source_request_* / is_special / special_label
-- over time. Prior narrower shape caused "structure of query does not
-- match function result type" 500s whenever a draft actually existed
-- (empty-draft path skipped the SELECT * so it went unnoticed).
DROP FUNCTION IF EXISTS fn_request_get_shop_draft(uuid);
DROP FUNCTION IF EXISTS fn_request_get_shop_draft(uuid, uuid);

CREATE OR REPLACE FUNCTION fn_request_get_shop_draft(p_shop_id uuid, p_user_id uuid)
RETURNS TABLE (
  id                      uuid,
  code                    varchar,
  shop_id                 uuid,
  shop_code               varchar,
  shop_name               varchar,
  shop_contact_phone      varchar,
  inventory_id            uuid,
  inventory_code          varchar,
  inventory_name          varchar,
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
  special_label           varchar,
  items                   jsonb
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT r.id INTO v_id
  FROM stock_requests r
  WHERE r.shop_id = p_shop_id
    AND r.created_by = p_user_id
    AND r.status = 'Draft'
    AND r.is_deleted = false
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;   -- empty set
  END IF;

  RETURN QUERY SELECT * FROM fn_request_get(v_id);
END
$$;


-- Discard a shop's draft. Idempotent — returns true if a draft was
-- deleted, false if none existed.
-- 08-Jul-2026: signature gained p_user_id so a shop user can't
-- accidentally delete an admin's parallel draft on the same shop
-- (and vice versa). Prior 1-arg shape dropped explicitly.
DROP FUNCTION IF EXISTS fn_request_delete_shop_draft(uuid);
DROP FUNCTION IF EXISTS fn_request_delete_shop_draft(uuid, uuid);

CREATE OR REPLACE FUNCTION fn_request_delete_shop_draft(p_shop_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM stock_requests
  WHERE shop_id = p_shop_id
    AND created_by = p_user_id
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

  -- 01-Jul-2026: only wipe SHOP-added items. Inv-added items (godown
  -- appended post-approval via fn_request_inventory_add_items) are
  -- preserved so the shop's edit doesn't blow away what the godown
  -- planned to dispatch. To remove an inv item, godown uses the
  -- inv-remove endpoint.
  DELETE FROM stock_request_items
  WHERE request_id = p_id AND added_by = 'Shop';

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty   := (v_item->>'requested_qty')::int;
    v_price := (v_item->>'unit_price')::numeric(10,2);

    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit, purchase_price_snapshot
    )
    SELECT p_id,
           p.id,
           v_qty,
           v_price,
           p.weight_value,
           p.weight_unit,
           p.purchase_price
    FROM   products p
    WHERE  p.id = (v_item->>'product_id')::uuid;

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty   + v_qty;
    v_total_amount := v_total_amount + (v_qty * v_price);
  END LOOP;

  -- Fold in any preserved inv-added items so the header aggregates
  -- reflect the full item set (shop + inv), not just what the shop
  -- just re-submitted.
  SELECT
    v_total_items  + COALESCE(COUNT(*), 0)::int,
    v_total_qty    + COALESCE(SUM(requested_qty), 0)::int,
    v_total_amount + COALESCE(SUM(subtotal), 0)::numeric(12,2)
  INTO v_total_items, v_total_qty, v_total_amount
  FROM stock_request_items
  WHERE request_id = p_id AND added_by = 'Inventory';

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

-- Pending | On-Hold → Approved (admin / inventory)
-- On-Hold accepted as a from-state (18-Jul-2026): inventory approves a held
-- request directly once the late special stock arrives. Clears the hold audit
-- fields so an approved request no longer looks held.
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
      on_hold_at  = NULL,
      on_hold_by  = NULL,
      updated_by  = p_user_id
  WHERE id = p_id
    AND status IN ('Pending', 'On-Hold')
    AND is_deleted = false;
  RETURN FOUND;
END
$$;


-- Pending | Approved → On-Hold (inventory user)
-- Parks the WHOLE Order when it contains a late-arriving special item, instead
-- of approving now. Held requests drop out of the cumulative kitchen print
-- (Approved-only) until re-approved. Orders only — the request_type guard
-- leaves the Return (Pending → Accepted) lifecycle untouched.
CREATE OR REPLACE FUNCTION fn_request_hold(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_requests
  SET status     = 'On-Hold',
      on_hold_at = now(),
      on_hold_by = p_user_id,
      updated_by = p_user_id
  WHERE id = p_id
    AND status IN ('Pending', 'Approved')
    AND request_type = 'Order'
    AND is_deleted = false;
  RETURN FOUND;
END
$$;


-- Pending | On-Hold → Rejected (admin). Reason required.
-- On-Hold accepted 18-Jul-2026 so a held request can be rejected outright
-- (e.g. the special item is no longer available).
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
      on_hold_at       = NULL,
      on_hold_by       = NULL,
      updated_by       = p_user_id
  WHERE id = p_id
    AND status IN ('Pending', 'On-Hold')
    AND is_deleted = false;
  RETURN FOUND;
END
$$;


-- Approved | Rejected | Cancelled | On-Hold → Pending (inventory user, admin)
-- "Undo" the Approve/Reject/Cancel/Hold decision before dispatch happens.
-- Clears the corresponding audit fields so the request looks like it was
-- never acted on; the next action writes fresh timestamps.
-- Cancelled → Pending added 01-Jul-2026 (client req: shop users sometimes
-- cancel by mistake; admin needs to recover).
-- On-Hold → Pending added 18-Jul-2026 (un-hold without approving).
CREATE OR REPLACE FUNCTION fn_request_revoke(
  p_id      uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_did_revoke boolean;
BEGIN
  UPDATE stock_requests
  SET status           = 'Pending',
      approved_at      = NULL,
      approved_by      = NULL,
      rejection_reason = NULL,
      cancelled_at     = NULL,
      cancelled_by     = NULL,
      on_hold_at       = NULL,
      on_hold_by       = NULL,
      draft_name       = NULL,     -- draft label was tied to Approved state
      pinned_at        = NULL,     -- pinning a Pending request is meaningless
      updated_by       = p_user_id
  WHERE id = p_id
    AND status IN ('Approved', 'Rejected', 'Cancelled', 'On-Hold')
    AND is_deleted = false;
  v_did_revoke := FOUND;

  -- Also clear per-item dispatch drafts. The auto-fill that happens on
  -- Approve seeds draft_dispatched_qty with requested_qty; keeping those
  -- around after a revoke leaves the request "Pending" but still showing
  -- a Draft chip + pre-filled dispatch qtys, which contradicts the
  -- pre-approval state. Only touches rows for the affected request; safe
  -- when there's nothing to clear.
  IF v_did_revoke THEN
    UPDATE stock_request_items
    SET    draft_dispatched_qty = NULL
    WHERE  request_id = p_id
      AND  draft_dispatched_qty IS NOT NULL;
  END IF;

  RETURN v_did_revoke;
END
$$;


-- Inventory user appends items to an already-Approved (or still-Pending)
-- request (01-Jul-2026 client req). Use case: last-minute customer bumps
-- a bigger qty just before dispatch — godown adds items directly instead
-- of asking the shop to re-submit. Each new row is tagged
-- added_by = 'Inventory' so downstream views can badge them.
--
-- Contract:
--   • p_items = JSON array of { product_id, requested_qty }
--   • Only allowed when status IN ('Pending', 'Approved') AND is_deleted = false.
--   • Products already in the request raise 'duplicate_product' — godown
--     should use the dispatch-qty flow to send more of a shop-included
--     product; this SP is for ADDING lines that don't exist yet.
--   • Snapshots products.mrp / weight_value / weight_unit at insert time
--     (same rule as fn_request_create for consistent history).
--   • Recalculates request totals so the header aggregates stay in sync.
CREATE OR REPLACE FUNCTION fn_request_inventory_add_items(
  p_id      uuid,
  p_user_id uuid,
  p_items   jsonb
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_item    jsonb;
  v_pid     uuid;
  v_qty     int;
  v_price   numeric(10,2);
  v_pp      numeric(10,2);
  v_wv      numeric(10,3);
  v_wu      varchar(5);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id
      AND status IN ('Pending', 'Approved')
      AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    -- Nothing to do; treat as no-op success so a stray empty POST doesn't
    -- surface a false error.
    RETURN true;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'requested_qty')::int;

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'requested_qty must be positive (got %)', v_qty;
    END IF;

    -- Snapshot price + weight + purchase price from the current products row.
    SELECT mrp, weight_value, weight_unit, purchase_price
    INTO v_price, v_wv, v_wu, v_pp
    FROM products
    WHERE id = v_pid AND is_deleted = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product not found: %', v_pid;
    END IF;

    -- Enforce uniqueness at the app layer with a friendlier error than
    -- the raw uq_stock_request_items violation.
    IF EXISTS (
      SELECT 1 FROM stock_request_items
      WHERE request_id = p_id AND product_id = v_pid
    ) THEN
      RAISE EXCEPTION 'duplicate_product: % is already in this request', v_pid
        USING ERRCODE = 'unique_violation';
    END IF;

    -- draft_dispatched_qty seeded with the typed qty (11-Jul-2026): the
    -- godown adds a product because they intend to SHIP that many — making
    -- them retype the same number in the Disp Qty column was double entry.
    -- Shop-added lines still start blank; only inv-added rows pre-fill.
    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit, added_by, draft_dispatched_qty,
      purchase_price_snapshot
    ) VALUES (
      p_id, v_pid, v_qty, v_price, v_wv, v_wu, 'Inventory', v_qty, v_pp
    );
  END LOOP;

  -- Refresh header aggregates so total_items / total_qty / total_amount
  -- reflect the newly appended lines.
  UPDATE stock_requests r
  SET total_items = (SELECT COUNT(*)::int FROM stock_request_items WHERE request_id = r.id),
      total_qty   = (SELECT COALESCE(SUM(requested_qty), 0)::int FROM stock_request_items WHERE request_id = r.id),
      total_amount = (SELECT COALESCE(SUM(subtotal), 0)::numeric(12,2) FROM stock_request_items WHERE request_id = r.id),
      updated_by  = p_user_id
  WHERE id = p_id;

  RETURN true;
END
$$;


-- Remove a single inv-tagged line the godown appended by mistake. Won't
-- touch shop-added items — those are still edited by the shop's own
-- endpoint. Same Pending/Approved guard as add.
CREATE OR REPLACE FUNCTION fn_request_inventory_remove_item(
  p_id       uuid,
  p_item_id  uuid,
  p_user_id  uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stock_requests
    WHERE id = p_id
      AND status IN ('Pending', 'Approved')
      AND is_deleted = false
  ) THEN
    RETURN false;
  END IF;

  -- Delete only if the row belongs to this request AND was added by
  -- inventory. Shop-added items are protected — inventory can't wipe
  -- what the shop asked for; use the dispatch-qty=0 flow instead.
  DELETE FROM stock_request_items
  WHERE id         = p_item_id
    AND request_id = p_id
    AND added_by   = 'Inventory';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE stock_requests r
  SET total_items = (SELECT COUNT(*)::int FROM stock_request_items WHERE request_id = r.id),
      total_qty   = (SELECT COALESCE(SUM(requested_qty), 0)::int FROM stock_request_items WHERE request_id = r.id),
      total_amount = (SELECT COALESCE(SUM(subtotal), 0)::numeric(12,2) FROM stock_request_items WHERE request_id = r.id),
      updated_by  = p_user_id
  WHERE id = p_id;

  RETURN true;
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
      -- 25-Jul-2026: dispatched_qty and dispatched_weight_g are mutually
      -- exclusive per line. Read whichever is present; the CHECK constraint
      -- on the table guarantees we can't accidentally set both. Non-partial
      -- callers omit dispatched_weight_g entirely (defaults to NULL).
      UPDATE stock_request_items
      SET dispatched_qty      = (v_item->>'dispatched_qty')::int,
          dispatched_weight_g = (v_item->>'dispatched_weight_g')::numeric
      WHERE id = (v_item->>'id')::uuid
        AND request_id = p_id;   -- safety: only touch items belonging to this request
    END LOOP;
  END IF;

  -- Dispatch-draft qtys/weights are now stale — clear them on the whole
  -- request so nothing reads a half-saved draft after the dispatch is
  -- finalised. Same goes for draft_name: it's a label on a live draft only.
  UPDATE stock_request_items
  SET draft_dispatched_qty      = NULL,
      draft_dispatched_weight_g = NULL
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
  SET draft_dispatched_qty      = NULL,
      draft_dispatched_weight_g = NULL
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
      -- 25-Jul-2026: draft mirrors the finalised-dispatch XOR shape. The
      -- FE posts EITHER dispatched_qty (packet mode) OR
      -- dispatched_weight_g (partial mode) per line; the other stays NULL.
      UPDATE stock_request_items
      SET draft_dispatched_qty      = (v_item->>'dispatched_qty')::int,
          draft_dispatched_weight_g = (v_item->>'dispatched_weight_g')::numeric
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
--
-- p_items (02-Jul-2026 client req): OPTIONAL JSON array of
--   [{ id: uuid, received_qty: int }] — shop's actual count at receive
--   time. Only rows the shop typed a number for appear; matching lines
--   (received == dispatched) stay out of the payload and their
--   received_qty column stays NULL ("no discrepancy noted"). When
--   p_items is NULL / empty, this reduces to the previous one-click
--   confirm behaviour — every line is treated as "as-dispatched".
--
-- Signature changed → drop the old 2-arg shape first (CREATE OR REPLACE
-- can't extend the arg list).
DROP FUNCTION IF EXISTS fn_request_receive(uuid, uuid);

CREATE OR REPLACE FUNCTION fn_request_receive(
  p_id      uuid,
  p_user_id uuid,
  p_items   jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_flipped boolean;
  v_receipt record;   -- 10-Jul-2026: per-line receipt loop for shop_inventory wiring
BEGIN
  UPDATE stock_requests
  SET status      = 'Received',
      received_at = now(),
      received_by = p_user_id,
      updated_by  = p_user_id
  WHERE id = p_id
    AND status = 'Dispatched'
    AND is_deleted = false;
  v_flipped := FOUND;

  -- Per-item received_qty / received_weight_g write. Only fires when the
  -- shop actually sent an items payload (partial receipt with discrepancies).
  -- Guarded by v_flipped so a no-op receive attempt on a non-Dispatched
  -- row can't silently mutate items.
  --
  -- 25-Jul-2026: received_weight_g companion for partial dispatches. Shop
  -- got 3.5 kg but counted only 3.4 kg → shop enters received_weight_g=3400.
  -- Exactly one of {received_qty, received_weight_g} is expected per item
  -- (XOR CHECK on the table enforces).
  IF v_flipped AND p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    UPDATE stock_request_items it
    SET    received_qty      = (e.value->>'received_qty')::int,
           received_weight_g = (e.value->>'received_weight_g')::numeric
    FROM   jsonb_array_elements(p_items) AS e(value)
    WHERE  it.id = (e.value->>'id')::uuid
      AND  it.request_id = p_id
      AND  ((e.value->>'received_qty') IS NOT NULL
            OR (e.value->>'received_weight_g') IS NOT NULL);

    -- Audit trail (03-Jul-2026, expanded 25-Jul-2026 for partial-weight):
    -- one row per shop-reported mismatch. old_qty = effective dispatched
    -- pack qty (rounded int — audit table schema pre-dates partial mode),
    -- new_qty = effective received pack qty. Accounts SPs use the numeric
    -- formula directly for MRP math; this table is display-only.
    INSERT INTO stock_request_qty_audits (
      request_item_id, request_id, old_qty, new_qty, reason, edited_by
    )
    SELECT it.id,
           p_id,
           ROUND(COALESCE(
             fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit),
             0
           ))::int,
           ROUND(COALESCE(
             fn_effective_pack_qty(it.received_qty,   it.received_weight_g,   it.weight_value, it.weight_unit),
             0
           ))::int,
           CASE
             WHEN COALESCE(fn_effective_pack_qty(it.received_qty, it.received_weight_g, it.weight_value, it.weight_unit), 0)
                < COALESCE(fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit), 0)
             THEN 'Shop confirm-receipt short'
             WHEN COALESCE(fn_effective_pack_qty(it.received_qty, it.received_weight_g, it.weight_value, it.weight_unit), 0)
                > COALESCE(fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit), 0)
             THEN 'Shop confirm-receipt over'
             ELSE 'Shop confirm-receipt'
           END,
           p_user_id
    FROM   stock_request_items it
    JOIN   jsonb_array_elements(p_items) AS e(value)
           ON it.id = (e.value->>'id')::uuid
    WHERE  it.request_id = p_id
      AND  ((e.value->>'received_qty') IS NOT NULL
            OR (e.value->>'received_weight_g') IS NOT NULL)
      -- Only audit when the received leg actually differs from dispatched
      -- (effective-pack terms). Prevents a "no change" confirm from
      -- spamming the audit log.
      AND  COALESCE(fn_effective_pack_qty(it.received_qty,   it.received_weight_g,   it.weight_value, it.weight_unit), -1)
        IS DISTINCT FROM
           COALESCE(fn_effective_pack_qty(it.dispatched_qty, it.dispatched_weight_g, it.weight_value, it.weight_unit), -1);
  END IF;

  -- Phase 4 wiring (10-Jul-2026): every confirmed receipt updates the
  -- shop's on-hand ledger. Only fires on a real Dispatched→Received
  -- flip (v_flipped) — a duplicate call after the flip finds status
  -- != 'Dispatched' → v_flipped=false → skips this block, so we can't
  -- double-post inventory movements. Qty comes from the effective-pack
  -- helper so partial-weight dispatch/receive contributes its fractional
  -- packet-equivalent to shop_inventory (numeric qty_delta accepts it).
  -- Rows where effective qty is 0 or NULL are skipped — would fail
  -- shop_inventory_movements' qty_delta <> 0 constraint.
  -- See fn_shop_inventory_apply_movement (phase4) for row-locking,
  -- avg_cost recompute, and negative-guard details.
  IF v_flipped THEN
    FOR v_receipt IN
      SELECT sri.product_id,
             COALESCE(
               fn_effective_pack_qty(sri.received_qty,   sri.received_weight_g,   sri.weight_value, sri.weight_unit),
               fn_effective_pack_qty(sri.dispatched_qty, sri.dispatched_weight_g, sri.weight_value, sri.weight_unit),
               0
             )::numeric AS qty,
             COALESCE(p.purchase_price, 0)::numeric AS unit_cost,
             sr.shop_id,
             sr.code AS request_code
      FROM stock_request_items sri
      INNER JOIN stock_requests sr ON sr.id = sri.request_id
      INNER JOIN products       p  ON p.id = sri.product_id
      WHERE sri.request_id = p_id
        AND COALESCE(
              fn_effective_pack_qty(sri.received_qty,   sri.received_weight_g,   sri.weight_value, sri.weight_unit),
              fn_effective_pack_qty(sri.dispatched_qty, sri.dispatched_weight_g, sri.weight_value, sri.weight_unit),
              0
            ) > 0
    LOOP
      PERFORM fn_shop_inventory_apply_movement(
        v_receipt.shop_id,
        v_receipt.product_id,
        'Receipt',
        v_receipt.qty,
        v_receipt.unit_cost,
        'StockRequest',
        p_id,
        'Received via ' || v_receipt.request_code,
        p_user_id
      );
    END LOOP;
  END IF;

  RETURN v_flipped;
END
$$;


-- Cancel from Pending, Approved or On-Hold (shop user or admin, role-gated in BE)
-- On-Hold added 18-Jul-2026 so a held request can be cancelled outright.
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
      on_hold_at    = NULL,
      on_hold_by    = NULL,
      updated_by    = p_user_id
  WHERE id = p_id
    AND status IN ('Pending', 'Approved', 'On-Hold')
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
  v_ret_wg       numeric(10,3);
  v_wv           numeric(10,3);
  v_wu           varchar(5);
  v_pack_g       numeric(10,3);
  v_line_credit  numeric(12,2);
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
    v_qty     := (v_item->>'requested_qty')::int;
    v_price   := (v_item->>'unit_price')::numeric(10,2);
    v_ret_wg  := NULLIF(v_item->>'return_weight_g', '')::numeric(10,3);

    -- Snapshot product pack weight — needed both for the item row (audit
    -- consistency) and for the credit calc when return_weight_g is set.
    SELECT p.weight_value, p.weight_unit
      INTO v_wv, v_wu
    FROM   products p
    WHERE  p.id = (v_item->>'product_id')::uuid;

    IF v_ret_wg IS NOT NULL THEN
      -- Partial-weight return (02-Jul-2026): only allowed on g/kg SKUs.
      -- BE-side validation should have already rejected other units, but
      -- guard here too so a bad payload can't slip through.
      IF v_wu IS NULL OR v_wu NOT IN ('g', 'kg') THEN
        RAISE EXCEPTION 'Partial-weight return only allowed on g/kg SKUs (product % has unit %)',
          (v_item->>'product_id'), COALESCE(v_wu, '<null>');
      END IF;
      v_pack_g := v_wv * CASE v_wu WHEN 'kg' THEN 1000 ELSE 1 END;
      IF v_pack_g <= 0 THEN
        RAISE EXCEPTION 'Product % has invalid pack weight (%)', (v_item->>'product_id'), v_pack_g;
      END IF;
      IF v_ret_wg > v_pack_g * v_qty THEN
        RAISE EXCEPTION 'return_weight_g (%) exceeds available pack weight (% × % = %) for product %',
          v_ret_wg, v_qty, v_pack_g, v_pack_g * v_qty, (v_item->>'product_id');
      END IF;
      -- Prorated credit: (weight claimed / total pack weight across N packs) × line MRP.
      v_line_credit := ROUND((v_ret_wg / v_pack_g) * v_price, 2);
    ELSE
      v_line_credit := v_qty * v_price;
    END IF;

    INSERT INTO stock_request_items (
      request_id, product_id, requested_qty, unit_price,
      weight_value, weight_unit, return_weight_g, purchase_price_snapshot
    )
    SELECT v_id,
           p.id,
           v_qty,
           v_price,
           p.weight_value,
           p.weight_unit,
           v_ret_wg,
           p.purchase_price
    FROM   products p
    WHERE  p.id = (v_item->>'product_id')::uuid;

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty   + v_qty;
    v_total_amount := v_total_amount + v_line_credit;
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

  -- 25-Jul-2026: admin post-completion edits stay packet-count-only —
  -- explicitly clear any partial-weight dispatch that was on the row so
  -- the XOR CHECK (chk_dispatched_qty_xor_weight) doesn't fail. Semantics:
  -- admin's edit REPLACES whatever the godown originally recorded, in
  -- packet-count terms.
  UPDATE stock_request_items
  SET dispatched_qty      = p_new_qty,
      dispatched_weight_g = NULL
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
-- SPECIAL REQUEST (06-Jul-2026) — replaces the godown-initiated Backorder
-- carve-off. Shop marks the whole request as Special on review/submit;
-- the flag rides on stock_requests.is_special. Persistent sticky banner
-- across shop/inv/admin lists every active-unreceived special.
-- ============================================================

-- Drop the retired Backorder carve-off SP if a prior build installed it.
-- Function is dead in the new model — shop declares specialness up-front
-- so there's nothing for the godown to carve.
DROP FUNCTION IF EXISTS fn_request_move_to_backorder(uuid, uuid[], uuid, timestamptz);
DROP FUNCTION IF EXISTS fn_request_move_to_backorder(uuid, jsonb, uuid, timestamptz);

-- Drop the retired outstanding-backorders SP. Replaced by
-- fn_request_list_active_specials below (different filter — is_special
-- flag instead of request_type='Backorder', wider status window since
-- a Special stays visible through Approved + Dispatched too, not just
-- Pending).
DROP FUNCTION IF EXISTS fn_request_list_outstanding_backorders(uuid, uuid[]);

-- Set the flag / label on an existing request. Shop-only, and only while
-- the request is still Pending — once the inventory approves, the flag
-- freezes so the downstream (dispatch / receipt / accounts) sees a
-- stable value. p_special_label NULL when the toggle is turned off.
--
-- BE calls this from PATCH /requests/{id}/special. Returns true when the
-- row was updated, false when the id doesn't match a Pending shop request
-- (BE surfaces 404 / 409 accordingly).
CREATE OR REPLACE FUNCTION fn_request_set_special(
  p_id            uuid,
  p_is_special    boolean,
  p_special_label varchar,
  p_user_id       uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_requests
  SET is_special    = COALESCE(p_is_special, false),
      -- Label only survives when the row is actually special — keeps the
      -- check constraint happy (chk_special_label_only_when_special) and
      -- clears any leftover label when the shop toggles Special off.
      special_label = CASE WHEN COALESCE(p_is_special, false)
                           THEN NULLIF(TRIM(p_special_label), '')
                           ELSE NULL END,
      updated_by    = p_user_id,
      updated_at    = now()
  WHERE id = p_id
    AND is_deleted = false
    AND status     = 'Pending';   -- freeze the flag once approved

  RETURN FOUND;
END;
$$;

-- Every un-received Special request in scope — powers the sticky top
-- banner across shop / inventory / admin. Wider status window than the
-- retired outstanding-backorders SP: a Special stays visible through
-- Pending + Approved + Dispatched, disappearing only when the shop
-- confirms Received (client's chosen closure gate).
--
-- Scope:
--   • p_shop_id      → shop user's own shop (forced by BE).
--   • p_inventory_id → inventory user's own inventory (forced by BE).
--   • Both NULL      → admin tenant-wide.
CREATE OR REPLACE FUNCTION fn_request_list_active_specials(
  p_shop_id      uuid  DEFAULT NULL,
  p_inventory_id uuid  DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  code                  varchar,
  special_label         varchar,
  shop_id               uuid,
  shop_code             varchar,
  shop_name             varchar,
  inventory_id          uuid,
  inventory_name        varchar,
  status                varchar,
  total_items           int,
  total_qty             int,
  total_amount          numeric,
  submitted_at          timestamptz,
  days_since_submitted  int
)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.code, r.special_label,
         r.shop_id, s.code, s.name,
         r.inventory_id, i.name,
         r.status::varchar,
         r.total_items, r.total_qty, r.total_amount,
         r.submitted_at,
         GREATEST(0, (CURRENT_DATE - r.submitted_at::date))::int AS days_since_submitted
  FROM   stock_requests r
  INNER JOIN shops       s ON s.id = r.shop_id
  INNER JOIN inventories i ON i.id = r.inventory_id
  WHERE  r.is_deleted = false
    AND  r.is_special = true
    -- On-Hold added 18-Jul-2026: a held special is still "open" and, since
    -- it's waiting on late stock, is exactly what the godown needs to chase.
    AND  r.status IN ('Pending', 'Approved', 'Dispatched', 'On-Hold')
    AND  (p_shop_id      IS NULL OR r.shop_id      = p_shop_id)
    AND  (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
  ORDER BY r.submitted_at ASC;   -- oldest first — those need attention most
$$;


-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- SELECT fn_request_next_code();                          -- expect 'REQ0001' on empty table
-- SELECT * FROM fn_settings_list();                       -- one row: request_lock_cutoff = '09:00'
-- SELECT * FROM fn_request_list_paged(NULL,NULL,NULL,NULL,1,10);  -- empty until rows exist
-- SELECT fn_request_count(NULL,NULL,NULL,NULL);          -- 0 initially
-- SELECT * FROM fn_request_list_outstanding_backorders(NULL,NULL);  -- 0 rows until a move happens
-- ============================================================


-- ############################################################
-- >>> phase3/phase3_procedures.sql
-- ############################################################

-- ============================================================
-- Kovilpatti Snacks — Phase 3 PROCEDURES (reporting stored functions)
--
-- Run AFTER phase1 + phase2 procedures.
-- Idempotent: every function uses CREATE OR REPLACE (with DROP first when
-- the RETURNS TABLE shape might evolve across edits).
--
-- READ-ONLY GUARANTEE: every fn_accounts_* body is SELECT/WITH/RETURN QUERY
-- only — no INSERT/UPDATE/DELETE/MERGE. The spec requires this; CI greps
-- this file for those keywords inside fn_accounts_* bodies.
--
-- TIMEZONE POLICY: each function accepts IST calendar dates (p_from, p_to)
-- and internally builds a half-open UTC range
--    [p_from 00:00 IST, (p_to + 1) 00:00 IST)
-- via   `(p_from::timestamp AT TIME ZONE 'Asia/Kolkata')`
-- so a row finalised at 23:59 IST on the last day of the range is included
-- and a row finalised at 00:00 IST on the next day is excluded.
--
-- ANCHOR DATE:
--   • Orders:  received_at  (status = 'Received')
--   • Returns: accepted_at  (status = 'Accepted')
-- All other statuses are excluded from the main reports. Dispatched-not-yet-
-- received Orders are surfaced separately by fn_accounts_in_transit.
--
-- ADJUSTMENTS (qty audits): anchored on edited_at (cash-basis). Each audit
-- row's monetary impact uses the line's UNIT_PRICE SNAPSHOT (not the
-- product's current MRP) so historical deltas are stable.
--
-- CATEGORIES (id = int, nested): p_cat_ids is int[]. When non-empty the
-- function expands each id to "self + all descendants" via a recursive CTE
-- before filtering products. NULL or empty array = no category filter.
-- ============================================================
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase3/phase3_procedures.sql
-- ============================================================

BEGIN;

-- ============================================================
-- 1. fn_accounts_summary
--    Single-row KPI aggregate for the top of the dashboard.
-- ============================================================
DROP FUNCTION IF EXISTS fn_accounts_summary(date, date, uuid[], uuid[], int[]);

CREATE OR REPLACE FUNCTION fn_accounts_summary(
  p_from        date,
  p_to          date,
  p_shop_ids    uuid[]  DEFAULT NULL,
  p_inv_ids     uuid[]  DEFAULT NULL,
  p_cat_ids     int[]   DEFAULT NULL
)
RETURNS TABLE (
  requested_amount         numeric,
  dispatched_amount        numeric,
  dispatched_request_count bigint,
  returns_amount           numeric,
  returns_request_count    bigint,
  net_amount               numeric,
  active_shop_count        bigint,
  adjustments_amount       numeric,
  adjustments_count        bigint,
  -- 12-Jul-2026: Purchased (at Cost) KPI — net dispatched cost at the
  -- line's purchase_price_snapshot (Orders Σ cost − Returns Σ cost).
  purchase_amount          numeric
)
LANGUAGE sql STABLE AS $$
  WITH
  -- IST → UTC half-open range used by every anchor comparison below.
  range AS (
    SELECT (p_from::timestamp        AT TIME ZONE 'Asia/Kolkata') AS lo,
           ((p_to + 1)::timestamp    AT TIME ZONE 'Asia/Kolkata') AS hi
  ),
  -- Closure of any selected category ids: self + all descendants.
  -- Empty / NULL filter => NULL (signals "no filter" downstream).
  cat_closure AS (
    SELECT array_agg(id)::int[] AS ids
    FROM (
      WITH RECURSIVE walk AS (
        SELECT c.id FROM categories c
         WHERE c.is_deleted = false AND c.id = ANY(p_cat_ids)
        UNION
        SELECT c.id FROM categories c
        JOIN   walk w ON c.parent_id = w.id
         WHERE c.is_deleted = false
      )
      SELECT id FROM walk
    ) t
    WHERE p_cat_ids IS NOT NULL AND cardinality(p_cat_ids) > 0
    -- Emit a row ONLY when ids were actually collected. Without this,
    -- array_agg over an empty input still returns one (NULL) row, so the
    -- downstream `NOT EXISTS (SELECT 1 FROM cat_closure)` "no filter" guard
    -- would always be false and silently filter out every request.
    HAVING count(*) > 0
  ),
  -- Requests that match the (shop / inventory / category-via-items) filter
  -- and are in a terminal state contributing to the books.
  finalised AS (
    SELECT r.id, r.request_type, r.status, r.shop_id, r.total_amount,
           COALESCE(r.received_at, r.accepted_at) AS anchor_at
    FROM stock_requests r, range g
    WHERE r.is_deleted = false
      AND (
            (r.request_type = 'Order'  AND r.status = 'Received' AND r.received_at >= g.lo AND r.received_at < g.hi)
         OR (r.request_type = 'Return' AND r.status = 'Accepted' AND r.accepted_at >= g.lo AND r.accepted_at < g.hi)
      )
      AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
      AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
      AND (
            NOT EXISTS (SELECT 1 FROM cat_closure)
            OR EXISTS (
              SELECT 1
              FROM   stock_request_items it
              JOIN   products p ON p.id = it.product_id
              WHERE  it.request_id = r.id
                AND  p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
            )
          )
  ),
  -- Qty audits anchored on edited_at, same shop/inventory/category filter
  -- applied through the parent request + line item + product.
  adjustments AS (
    SELECT a.id, a.request_id, a.request_item_id,
           a.old_qty, a.new_qty, it.unit_price,
           (COALESCE(a.new_qty,0) - COALESCE(a.old_qty,0)) * it.unit_price AS delta_amount
    FROM stock_request_qty_audits a
    JOIN stock_request_items       it ON it.id = a.request_item_id
    JOIN stock_requests            r  ON r.id  = a.request_id
    JOIN products                  p  ON p.id  = it.product_id
    , range g
    WHERE a.edited_at >= g.lo AND a.edited_at < g.hi
      AND r.is_deleted = false
      AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
      AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
      AND (
            NOT EXISTS (SELECT 1 FROM cat_closure)
            OR p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
          )
  ),
  -- Live item-level money. NOT r.total_amount — that column is frozen at
  -- submit time as Σ requested_qty × unit_price, so it can't show the
  -- requested-vs-dispatched gap and never moves on a post-completion qty
  -- edit. These sums use the items' current qtys (same convention as
  -- fn_accounts_by_category / fn_accounts_top_products), so an admin edit
  -- moves Dispatched — and therefore Net — immediately. The category filter
  -- applies per item, matching those breakdowns.
  item_sums AS (
    SELECT
      COALESCE(SUM(CASE WHEN f.request_type = 'Order'
                        THEN it.requested_qty * it.unit_price END), 0)                            AS requested_amount,
      -- Order-side money uses received_qty first (shop's reported count
       -- at receive time), falling back to dispatched_qty, then requested_qty.
       -- 03-Jul-2026: keeps accounts + shop's declared receipt in sync so a
       -- reported short-receipt reduces the ledger by exactly the missing
       -- amount without an admin qty-edit round-trip.
      COALESCE(SUM(CASE WHEN f.request_type = 'Order'
                        THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price END), 0) AS dispatched_amount,
      COALESCE(SUM(CASE WHEN f.request_type = 'Return'
                        THEN fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price END), 0) AS returns_amount,
      -- Cost side at the line's frozen purchase_price_snapshot (COALESCE to
      -- 0 when the product had no purchase price at insert).
      COALESCE(SUM(CASE WHEN f.request_type = 'Order'
                        THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * COALESCE(it.purchase_price_snapshot, 0) END), 0) AS dispatched_cost,
      COALESCE(SUM(CASE WHEN f.request_type = 'Return'
                        THEN fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * COALESCE(it.purchase_price_snapshot, 0) END), 0) AS returns_cost
    FROM finalised f
    JOIN stock_request_items it ON it.request_id = f.id
    LEFT JOIN products        p ON p.id          = it.product_id
    WHERE (
      NOT EXISTS (SELECT 1 FROM cat_closure)
      OR p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
    )
  )
  SELECT
    (SELECT s.requested_amount  FROM item_sums s)::numeric(14,2)                                             AS requested_amount,
    (SELECT s.dispatched_amount FROM item_sums s)::numeric(14,2)                                             AS dispatched_amount,
    COALESCE(COUNT(*) FILTER (WHERE f.request_type = 'Order'), 0)::bigint                                    AS dispatched_request_count,
    (SELECT s.returns_amount    FROM item_sums s)::numeric(14,2)                                             AS returns_amount,
    COALESCE(COUNT(*) FILTER (WHERE f.request_type = 'Return'), 0)::bigint                                   AS returns_request_count,
    -- Net = live Dispatched − live Returns. Adjustments are NOT added: the
    -- live dispatched figure already reflects every qty edit, so folding the
    -- audit deltas in again would double-count them.
    (SELECT s.dispatched_amount - s.returns_amount FROM item_sums s)::numeric(14,2)                          AS net_amount,
    COALESCE(COUNT(DISTINCT f.shop_id), 0)::bigint                                                           AS active_shop_count,
    (SELECT COALESCE(SUM(delta_amount), 0)::numeric(14,2) FROM adjustments)                                  AS adjustments_amount,
    (SELECT COALESCE(COUNT(*), 0)::bigint                FROM adjustments)                                   AS adjustments_count,
    -- Purchased (at Cost) = net dispatched cost.
    (SELECT s.dispatched_cost - s.returns_cost FROM item_sums s)::numeric(14,2)                              AS purchase_amount
  FROM finalised f;
$$;


-- ============================================================
-- 2. fn_accounts_trend
--    Per-bucket aggregate for the trend chart. Buckets are IST calendar
--    day/week/month. Empty buckets appear with zeroes via generate_series.
-- ============================================================
DROP FUNCTION IF EXISTS fn_accounts_trend(date, date, varchar, uuid[], uuid[], int[]);

CREATE OR REPLACE FUNCTION fn_accounts_trend(
  p_from        date,
  p_to          date,
  p_grouping    varchar,
  p_shop_ids    uuid[]  DEFAULT NULL,
  p_inv_ids     uuid[]  DEFAULT NULL,
  p_cat_ids     int[]   DEFAULT NULL
)
RETURNS TABLE (
  bucket_start       date,
  dispatched_amount  numeric,
  returns_amount     numeric,
  net_amount         numeric,
  -- 12-Jul-2026: Purchased (at Cost) per bucket — net dispatched cost at
  -- the line's purchase_price_snapshot (Orders cost − Returns cost).
  purchase_amount    numeric,
  -- 12-Jul-2026 (client): MRP value the shops asked for but did NOT get —
  -- per-line GREATEST(requested − sent, 0) × unit_price over Orders, so an
  -- over-dispatch on one line can't cancel a shortage on another.
  shortfall_amount   numeric
)
LANGUAGE sql STABLE AS $$
  WITH
  range AS (
    SELECT (p_from::timestamp     AT TIME ZONE 'Asia/Kolkata') AS lo,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS hi
  ),
  cat_closure AS (
    SELECT array_agg(id)::int[] AS ids
    FROM (
      WITH RECURSIVE walk AS (
        SELECT c.id FROM categories c
         WHERE c.is_deleted = false AND c.id = ANY(p_cat_ids)
        UNION
        SELECT c.id FROM categories c
        JOIN   walk w ON c.parent_id = w.id
         WHERE c.is_deleted = false
      )
      SELECT id FROM walk
    ) t
    WHERE p_cat_ids IS NOT NULL AND cardinality(p_cat_ids) > 0
    -- Emit a row ONLY when ids were actually collected. Without this,
    -- array_agg over an empty input still returns one (NULL) row, so the
    -- downstream `NOT EXISTS (SELECT 1 FROM cat_closure)` "no filter" guard
    -- would always be false and silently filter out every request.
    HAVING count(*) > 0
  ),
  -- All matching finalised rows tagged with their IST bucket-start date.
  -- p_grouping is one of 'day','week','month' — caller-validated at the BE.
  finalised AS (
    SELECT r.id, r.request_type, r.total_amount,
           (date_trunc(p_grouping,
              (COALESCE(r.received_at, r.accepted_at) AT TIME ZONE 'Asia/Kolkata')
           ))::date AS bucket_start,
           -- Per-request cost at the line's frozen purchase_price_snapshot,
           -- same qty COALESCE chains as fn_accounts_summary (Orders use the
           -- received→dispatched→requested chain; Returns reuse
           -- dispatched_qty as accepted-qty).
           (SELECT COALESCE(SUM(
              CASE WHEN r.request_type = 'Order'
                   THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit)
                   ELSE fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit)
              END * COALESCE(it.purchase_price_snapshot, 0)), 0)
            FROM stock_request_items it
            WHERE it.request_id = r.id) AS cost_amount,
           -- Undelivered ask (Orders only): what the shop requested minus
           -- what actually went (received → dispatched → requested chain),
           -- floored at 0 per line, valued at the MRP snapshot.
           (SELECT COALESCE(SUM(
              GREATEST(it.requested_qty
                       - fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit), 0)
              * it.unit_price), 0)
            FROM stock_request_items it
            WHERE it.request_id = r.id
              AND r.request_type = 'Order') AS shortfall_amount
    FROM stock_requests r, range g
    WHERE r.is_deleted = false
      AND (
            (r.request_type = 'Order'  AND r.status = 'Received' AND r.received_at >= g.lo AND r.received_at < g.hi)
         OR (r.request_type = 'Return' AND r.status = 'Accepted' AND r.accepted_at >= g.lo AND r.accepted_at < g.hi)
      )
      AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
      AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
      AND (
            NOT EXISTS (SELECT 1 FROM cat_closure)
            OR EXISTS (
              SELECT 1
              FROM   stock_request_items it
              JOIN   products p ON p.id = it.product_id
              WHERE  it.request_id = r.id
                AND  p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
            )
          )
  ),
  -- Full bucket series so empty buckets appear with zero (no gaps).
  -- Generated in IST so the buckets line up with the finalised rows.
  series AS (
    SELECT (date_trunc(p_grouping, gs))::date AS bucket_start
    FROM generate_series(
      date_trunc(p_grouping, p_from::timestamp),
      date_trunc(p_grouping, p_to::timestamp),
      ('1 ' || p_grouping)::interval
    ) gs
  )
  SELECT
    s.bucket_start,
    COALESCE(SUM(CASE WHEN f.request_type = 'Order'  THEN f.total_amount END), 0)::numeric(14,2) AS dispatched_amount,
    COALESCE(SUM(CASE WHEN f.request_type = 'Return' THEN f.total_amount END), 0)::numeric(14,2) AS returns_amount,
    (
      COALESCE(SUM(CASE WHEN f.request_type = 'Order'  THEN f.total_amount END), 0)
    - COALESCE(SUM(CASE WHEN f.request_type = 'Return' THEN f.total_amount END), 0)
    )::numeric(14,2) AS net_amount,
    (
      COALESCE(SUM(CASE WHEN f.request_type = 'Order'  THEN f.cost_amount END), 0)
    - COALESCE(SUM(CASE WHEN f.request_type = 'Return' THEN f.cost_amount END), 0)
    )::numeric(14,2) AS purchase_amount,
    COALESCE(SUM(CASE WHEN f.request_type = 'Order' THEN f.shortfall_amount END), 0)::numeric(14,2) AS shortfall_amount
  FROM series s
  LEFT JOIN finalised f ON f.bucket_start = s.bucket_start
  GROUP BY s.bucket_start
  ORDER BY s.bucket_start;
$$;


-- ============================================================
-- 3. fn_accounts_by_shop
--    Per-shop breakdown. dispatched_qty falls back to requested_qty when
--    dispatched_qty IS NULL (matches spec wording).
-- ============================================================
-- Old signature (pre-profit/loss columns) — drop both variants safely so
-- a re-run after the 17-Jun-2026 addendum doesn't error on the return-type
-- change. The new signature appends purchase_amount + profit + loss.
DROP FUNCTION IF EXISTS fn_accounts_by_shop(date, date, uuid[], uuid[], int[]);

CREATE OR REPLACE FUNCTION fn_accounts_by_shop(
  p_from        date,
  p_to          date,
  p_shop_ids    uuid[]  DEFAULT NULL,
  p_inv_ids     uuid[]  DEFAULT NULL,
  p_cat_ids     int[]   DEFAULT NULL
)
RETURNS TABLE (
  shop_id               uuid,
  shop_code             varchar,
  shop_name             varchar,
  order_request_count   bigint,
  return_request_count  bigint,
  requested_qty         bigint,
  dispatched_qty        bigint,
  returned_qty          bigint,
  requested_amount      numeric,
  dispatched_amount     numeric,
  returns_amount        numeric,
  adjustments_amount    numeric,
  net_amount            numeric,
  -- 17-Jun-2026 (client #12): cost-side metrics for the Excel export.
  -- purchase_amount = net dispatched cost at current products.purchase_price
  --                   (Orders Σ dispatched × cost − Returns Σ returned × cost).
  -- profit / loss are mutually exclusive (one is always 0) — the standard
  -- Indian retail P&L pair: net_amount - purchase_amount > 0 → profit,
  -- otherwise the absolute gap goes into loss.
  purchase_amount       numeric,
  profit                numeric,
  loss                  numeric
)
LANGUAGE sql STABLE AS $$
  WITH
  range AS (
    SELECT (p_from::timestamp     AT TIME ZONE 'Asia/Kolkata') AS lo,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS hi
  ),
  cat_closure AS (
    SELECT array_agg(id)::int[] AS ids
    FROM (
      WITH RECURSIVE walk AS (
        SELECT c.id FROM categories c
         WHERE c.is_deleted = false AND c.id = ANY(p_cat_ids)
        UNION
        SELECT c.id FROM categories c
        JOIN   walk w ON c.parent_id = w.id
         WHERE c.is_deleted = false
      )
      SELECT id FROM walk
    ) t
    WHERE p_cat_ids IS NOT NULL AND cardinality(p_cat_ids) > 0
    -- Emit a row ONLY when ids were actually collected. Without this,
    -- array_agg over an empty input still returns one (NULL) row, so the
    -- downstream `NOT EXISTS (SELECT 1 FROM cat_closure)` "no filter" guard
    -- would always be false and silently filter out every request.
    HAVING count(*) > 0
  ),
  -- Order rows in range (per-shop dispatched qty sum is computed from items
  -- to honour the COALESCE(dispatched_qty, requested_qty) rule).
  order_rows AS (
    SELECT r.id, r.shop_id, r.total_amount
    FROM stock_requests r, range g
    WHERE r.is_deleted = false
      AND r.request_type = 'Order'
      AND r.status       = 'Received'
      AND r.received_at >= g.lo AND r.received_at < g.hi
      AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
      AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
      AND (
            NOT EXISTS (SELECT 1 FROM cat_closure)
            OR EXISTS (
              SELECT 1
              FROM   stock_request_items it
              JOIN   products p ON p.id = it.product_id
              WHERE  it.request_id = r.id
                AND  p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
            )
          )
  ),
  return_rows AS (
    SELECT r.id, r.shop_id, r.total_amount
    FROM stock_requests r, range g
    WHERE r.is_deleted = false
      AND r.request_type = 'Return'
      AND r.status       = 'Accepted'
      AND r.accepted_at >= g.lo AND r.accepted_at < g.hi
      AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
      AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
      AND (
            NOT EXISTS (SELECT 1 FROM cat_closure)
            OR EXISTS (
              SELECT 1
              FROM   stock_request_items it
              JOIN   products p ON p.id = it.product_id
              WHERE  it.request_id = r.id
                AND  p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
            )
          )
  ),
  -- Live item-level sums per shop. NOT r.total_amount — that column is
  -- frozen at submit time (Σ requested_qty × unit_price); the items' current
  -- qtys make Requested vs Dispatched comparable and let a post-completion
  -- qty edit move the row immediately. Category filter applies per item,
  -- matching fn_accounts_by_category.
  order_sums AS (
    SELECT o.shop_id,
           SUM(it.requested_qty)::bigint                                                                    AS requested_qty,
           -- received_qty first (shop's reported count), then dispatched, then requested.
           -- 03-Jul-2026: keeps the shop's declared receipt discrepancy in the ledger.
           SUM(fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit))::bigint                      AS dispatched_qty,
           SUM(it.requested_qty * it.unit_price)                                                            AS requested_amount,
           SUM(fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price)              AS dispatched_amount,
           -- Cost side of dispatched goods at the line's frozen
           -- purchase_price_snapshot (12-Jul-2026 — replaces the live
           -- products.purchase_price so a later price edit can't shift
           -- historical figures). COALESCE handles lines whose product had
           -- no purchase price at insert (treat as 0 cost).
           SUM(fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * COALESCE(it.purchase_price_snapshot, 0)) AS dispatched_cost
    FROM order_rows o
    JOIN stock_request_items it ON it.request_id = o.id
    LEFT JOIN products p        ON p.id  = it.product_id
    WHERE (
      NOT EXISTS (SELECT 1 FROM cat_closure)
      OR p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
    )
    GROUP BY o.shop_id
  ),
  -- dispatched_qty is reused as accepted-qty on Returns (Phase 2 convention).
  return_sums AS (
    SELECT rr.shop_id,
           SUM(fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit))::bigint                         AS returned_qty,
           SUM(fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price)                 AS returns_amount,
           -- Cost recovered when stock comes back via a Return — subtracted
           -- from dispatched_cost in the final SELECT to get net cost.
           SUM(fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * COALESCE(it.purchase_price_snapshot, 0)) AS returns_cost
    FROM return_rows rr
    JOIN stock_request_items it ON it.request_id = rr.id
    LEFT JOIN products p        ON p.id  = it.product_id
    WHERE (
      NOT EXISTS (SELECT 1 FROM cat_closure)
      OR p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
    )
    GROUP BY rr.shop_id
  ),
  -- Informational per-shop edit total — same edited_at anchor + filters as
  -- fn_accounts_summary's adjustments CTE so Σ(by-shop) = KPI Adjustments.
  -- NOT folded into net_amount: the live dispatched/returns sums above
  -- already reflect every qty edit.
  shop_adjustments AS (
    SELECT r.shop_id,
           SUM((COALESCE(a.new_qty,0) - COALESCE(a.old_qty,0)) * it.unit_price)   AS adjustments_amount
    FROM stock_request_qty_audits a
    JOIN stock_request_items       it ON it.id = a.request_item_id
    JOIN stock_requests            r  ON r.id  = a.request_id
    JOIN products                  p  ON p.id  = it.product_id
    , range g
    WHERE a.edited_at >= g.lo AND a.edited_at < g.hi
      AND r.is_deleted = false
      AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
      AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
      AND (
            NOT EXISTS (SELECT 1 FROM cat_closure)
            OR p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
          )
    GROUP BY r.shop_id
  )
  SELECT
    s.id   AS shop_id,
    s.code AS shop_code,
    s.name AS shop_name,
    COALESCE((SELECT COUNT(*) FROM order_rows  o WHERE o.shop_id = s.id), 0)::bigint                  AS order_request_count,
    COALESCE((SELECT COUNT(*) FROM return_rows rr WHERE rr.shop_id = s.id), 0)::bigint                AS return_request_count,
    COALESCE((SELECT os.requested_qty      FROM order_sums  os WHERE os.shop_id = s.id), 0)::bigint   AS requested_qty,
    COALESCE((SELECT os.dispatched_qty     FROM order_sums  os WHERE os.shop_id = s.id), 0)::bigint   AS dispatched_qty,
    COALESCE((SELECT rs.returned_qty       FROM return_sums rs WHERE rs.shop_id = s.id), 0)::bigint   AS returned_qty,
    COALESCE((SELECT os.requested_amount   FROM order_sums  os WHERE os.shop_id = s.id), 0)::numeric(14,2) AS requested_amount,
    COALESCE((SELECT os.dispatched_amount  FROM order_sums  os WHERE os.shop_id = s.id), 0)::numeric(14,2) AS dispatched_amount,
    COALESCE((SELECT rs.returns_amount     FROM return_sums rs WHERE rs.shop_id = s.id), 0)::numeric(14,2) AS returns_amount,
    COALESCE((SELECT sa.adjustments_amount FROM shop_adjustments sa WHERE sa.shop_id = s.id), 0)::numeric(14,2) AS adjustments_amount,
    (
      COALESCE((SELECT os.dispatched_amount FROM order_sums  os WHERE os.shop_id = s.id), 0)
    - COALESCE((SELECT rs.returns_amount    FROM return_sums rs WHERE rs.shop_id = s.id), 0)
    )::numeric(14,2) AS net_amount,
    -- Net cost of goods that left the godown for this shop in the range
    -- (dispatched cost minus returned cost). Pair with net_amount above
    -- to derive Profit / Loss.
    (
      COALESCE((SELECT os.dispatched_cost FROM order_sums  os WHERE os.shop_id = s.id), 0)
    - COALESCE((SELECT rs.returns_cost    FROM return_sums rs WHERE rs.shop_id = s.id), 0)
    )::numeric(14,2) AS purchase_amount,
    -- P&L pair (Indian retail convention). Exactly one of profit / loss is
    -- non-zero per row; the other is 0. Computed inline so the SP stays a
    -- single-SELECT shape — easier to read than a wrapping subquery.
    GREATEST(
      0,
      COALESCE((SELECT os.dispatched_amount FROM order_sums  os WHERE os.shop_id = s.id), 0)
    - COALESCE((SELECT rs.returns_amount    FROM return_sums rs WHERE rs.shop_id = s.id), 0)
    - COALESCE((SELECT os.dispatched_cost   FROM order_sums  os WHERE os.shop_id = s.id), 0)
    + COALESCE((SELECT rs.returns_cost      FROM return_sums rs WHERE rs.shop_id = s.id), 0)
    )::numeric(14,2) AS profit,
    GREATEST(
      0,
      COALESCE((SELECT os.dispatched_cost   FROM order_sums  os WHERE os.shop_id = s.id), 0)
    - COALESCE((SELECT rs.returns_cost      FROM return_sums rs WHERE rs.shop_id = s.id), 0)
    - COALESCE((SELECT os.dispatched_amount FROM order_sums  os WHERE os.shop_id = s.id), 0)
    + COALESCE((SELECT rs.returns_amount    FROM return_sums rs WHERE rs.shop_id = s.id), 0)
    )::numeric(14,2) AS loss
  FROM shops s
  WHERE s.is_deleted = false
    AND (
         EXISTS (SELECT 1 FROM order_rows  o WHERE o.shop_id = s.id)
      OR EXISTS (SELECT 1 FROM return_rows rr WHERE rr.shop_id = s.id)
      -- A shop whose only activity in range is a qty edit on an older
      -- request must still appear, or Σ(by-shop adjustments) ≠ KPI.
      OR EXISTS (SELECT 1 FROM shop_adjustments sa WHERE sa.shop_id = s.id)
    )
  -- Alphabetical — matches the grid's default sort and the CSV row order.
  ORDER BY s.name, s.code;
$$;


-- ============================================================
-- 4. fn_accounts_by_category
--    Per-leaf-category breakdown (one row per category referenced by the
--    filtered requests). category_path uses the same ' > ' separator as
--    fn_category_tree so the FE doesn't need to rebuild it.
-- ============================================================
-- Old signatures dropped so the return-type changes land. Two prior shapes
-- exist depending on environment: the original (id/path/qty/amount only)
-- and the 17-Jun-2026 add of purchase/profit/loss. New 19-Jun-2026 shape
-- adds per-dimension aggregates for view-mode (client #13).
DROP FUNCTION IF EXISTS fn_accounts_by_category(date, date, uuid[], uuid[], int[]);

CREATE OR REPLACE FUNCTION fn_accounts_by_category(
  p_from        date,
  p_to          date,
  p_shop_ids    uuid[]  DEFAULT NULL,
  p_inv_ids     uuid[]  DEFAULT NULL,
  p_cat_ids     int[]   DEFAULT NULL
)
RETURNS TABLE (
  category_id    int,
  category_path  varchar,
  -- Net (Orders − Returns) — kept for the default "All" view.
  quantity       bigint,
  amount         numeric,
  purchase_amount numeric,
  profit          numeric,
  loss            numeric,
  -- 19-Jun-2026 (client #13): per-dimension aggregates so the FE view-mode
  -- (Requested / Dispatched / Returns) can render single-dim breakdowns
  -- without a refetch. All values are positive (no signed-amount tricks).
  requested_qty       bigint,
  dispatched_qty      bigint,
  returns_qty         bigint,
  requested_amount    numeric,
  dispatched_amount   numeric,
  returns_amount      numeric
)
LANGUAGE sql STABLE AS $$
  WITH
  range AS (
    SELECT (p_from::timestamp     AT TIME ZONE 'Asia/Kolkata') AS lo,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS hi
  ),
  cat_closure AS (
    SELECT array_agg(id)::int[] AS ids
    FROM (
      WITH RECURSIVE walk AS (
        SELECT c.id FROM categories c
         WHERE c.is_deleted = false AND c.id = ANY(p_cat_ids)
        UNION
        SELECT c.id FROM categories c
        JOIN   walk w ON c.parent_id = w.id
         WHERE c.is_deleted = false
      )
      SELECT id FROM walk
    ) t
    WHERE p_cat_ids IS NOT NULL AND cardinality(p_cat_ids) > 0
    -- Emit a row ONLY when ids were actually collected. Without this,
    -- array_agg over an empty input still returns one (NULL) row, so the
    -- downstream `NOT EXISTS (SELECT 1 FROM cat_closure)` "no filter" guard
    -- would always be false and silently filter out every request.
    HAVING count(*) > 0
  ),
  -- Per-category tree (id → root-rooted path) for the path column.
  tree AS (
    SELECT * FROM fn_category_tree()
  ),
  -- Items belonging to finalised requests. We carry BOTH signed values
  -- (for the Net row in 'All' view) AND per-dimension positive aggregates
  -- (for the Requested / Dispatched / Returns view lenses). The dimension
  -- semantics:
  --   • Requested  — Orders only, using it.requested_qty (initial ask).
  --   • Dispatched — Orders only, using COALESCE(dispatched_qty, requested_qty).
  --   • Returns    — Returns only, using COALESCE(dispatched_qty, requested_qty)
  --                  (which is the accepted-qty per the Phase 2 convention).
  -- signed_cost feeds the existing profit / loss columns.
  contrib AS (
    SELECT
      p.category_id,
      -- 03-Jul-2026: Order-side uses received_qty first (shop's reported
      -- count) so a declared receipt discrepancy flows through category
      -- rollups. Return path unchanged — Returns have no received_qty.
      CASE WHEN r.request_type = 'Order'
           THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit)
           ELSE -fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit)
      END                                                                                     AS signed_qty,
      CASE WHEN r.request_type = 'Order'
           THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price
           ELSE -fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price
      END                                                                                     AS signed_amount,
      -- Cost priced at the line's frozen purchase_price_snapshot
      -- (12-Jul-2026 — replaces the live products.purchase_price).
      CASE WHEN r.request_type = 'Order'
           THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * COALESCE(it.purchase_price_snapshot, 0)
           ELSE -fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * COALESCE(it.purchase_price_snapshot, 0)
      END                                                                                     AS signed_cost,
      -- Per-dimension positive aggregates (added 19-Jun-2026, client #13).
      CASE WHEN r.request_type = 'Order'  THEN it.requested_qty ELSE 0 END                    AS req_qty,
      CASE WHEN r.request_type = 'Order'  THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) ELSE 0 END AS disp_qty,
      CASE WHEN r.request_type = 'Return' THEN fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) ELSE 0 END AS ret_qty,
      CASE WHEN r.request_type = 'Order'  THEN it.requested_qty * it.unit_price ELSE 0 END    AS req_amt,
      CASE WHEN r.request_type = 'Order'  THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price ELSE 0 END AS disp_amt,
      CASE WHEN r.request_type = 'Return' THEN fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price ELSE 0 END AS ret_amt
    FROM stock_requests r
    JOIN stock_request_items it ON it.request_id = r.id
    JOIN products            p  ON p.id          = it.product_id
    , range g
    WHERE r.is_deleted = false
      AND (
            (r.request_type = 'Order'  AND r.status = 'Received' AND r.received_at >= g.lo AND r.received_at < g.hi)
         OR (r.request_type = 'Return' AND r.status = 'Accepted' AND r.accepted_at >= g.lo AND r.accepted_at < g.hi)
      )
      AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
      AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
      AND (
            NOT EXISTS (SELECT 1 FROM cat_closure)
            OR p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
          )
  )
  SELECT
    c.category_id                                              AS category_id,
    t.path                                                     AS category_path,
    SUM(c.signed_qty)::bigint                                  AS quantity,
    SUM(c.signed_amount)::numeric(14,2)                        AS amount,
    SUM(c.signed_cost)::numeric(14,2)                          AS purchase_amount,
    -- P&L pair — exactly one is non-zero per row.
    GREATEST(0, SUM(c.signed_amount) - SUM(c.signed_cost))::numeric(14,2) AS profit,
    GREATEST(0, SUM(c.signed_cost)   - SUM(c.signed_amount))::numeric(14,2) AS loss,
    -- Per-dimension positive aggregates.
    SUM(c.req_qty)::bigint                                     AS requested_qty,
    SUM(c.disp_qty)::bigint                                    AS dispatched_qty,
    SUM(c.ret_qty)::bigint                                     AS returns_qty,
    SUM(c.req_amt)::numeric(14,2)                              AS requested_amount,
    SUM(c.disp_amt)::numeric(14,2)                             AS dispatched_amount,
    SUM(c.ret_amt)::numeric(14,2)                              AS returns_amount
  FROM contrib c
  JOIN tree t ON t.id = c.category_id
  GROUP BY c.category_id, t.path
  ORDER BY amount DESC, t.path;
$$;


-- ============================================================
-- 5. fn_accounts_top_products
--    Top-N products by net amount (Orders − Returns) in the range.
-- ============================================================
-- 19-Jun-2026 (client #13): adds per-dimension positive aggregates so the
-- FE view-mode lens can render Requested / Dispatched / Returns slices.
DROP FUNCTION IF EXISTS fn_accounts_top_products(date, date, uuid[], uuid[], int[], int);

CREATE OR REPLACE FUNCTION fn_accounts_top_products(
  p_from        date,
  p_to          date,
  p_shop_ids    uuid[]  DEFAULT NULL,
  p_inv_ids     uuid[]  DEFAULT NULL,
  p_cat_ids     int[]   DEFAULT NULL,
  p_limit       int     DEFAULT 10
)
RETURNS TABLE (
  product_id    uuid,
  product_code  varchar,
  product_name  varchar,
  weight_value  numeric,
  weight_unit   varchar,
  -- Net (Orders − Returns) — used by 'All' view ranking.
  quantity      bigint,
  amount        numeric,
  -- Per-dimension positive aggregates (added 19-Jun-2026 client #13).
  requested_qty       bigint,
  dispatched_qty      bigint,
  returns_qty         bigint,
  requested_amount    numeric,
  dispatched_amount   numeric,
  returns_amount      numeric
)
LANGUAGE sql STABLE AS $$
  WITH
  range AS (
    SELECT (p_from::timestamp     AT TIME ZONE 'Asia/Kolkata') AS lo,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS hi
  ),
  cat_closure AS (
    SELECT array_agg(id)::int[] AS ids
    FROM (
      WITH RECURSIVE walk AS (
        SELECT c.id FROM categories c
         WHERE c.is_deleted = false AND c.id = ANY(p_cat_ids)
        UNION
        SELECT c.id FROM categories c
        JOIN   walk w ON c.parent_id = w.id
         WHERE c.is_deleted = false
      )
      SELECT id FROM walk
    ) t
    WHERE p_cat_ids IS NOT NULL AND cardinality(p_cat_ids) > 0
    -- Emit a row ONLY when ids were actually collected. Without this,
    -- array_agg over an empty input still returns one (NULL) row, so the
    -- downstream `NOT EXISTS (SELECT 1 FROM cat_closure)` "no filter" guard
    -- would always be false and silently filter out every request.
    HAVING count(*) > 0
  ),
  contrib AS (
    SELECT
      p.id            AS product_id,
      p.code          AS product_code,
      p.name          AS product_name,
      p.weight_value,
      p.weight_unit,
      -- Signed (existing — for the Net columns in 'All' view).
      -- 03-Jul-2026: Order-side uses received_qty first when the shop has
      -- reported a receipt discrepancy. Return path unchanged.
      CASE WHEN r.request_type = 'Order'
           THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit)
           ELSE -fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit)
      END AS signed_qty,
      CASE WHEN r.request_type = 'Order'
           THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price
           ELSE -fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price
      END AS signed_amount,
      -- Per-dimension positive aggregates (added 19-Jun-2026, client #13).
      CASE WHEN r.request_type = 'Order'  THEN it.requested_qty ELSE 0 END                    AS req_qty,
      CASE WHEN r.request_type = 'Order'  THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) ELSE 0 END AS disp_qty,
      CASE WHEN r.request_type = 'Return' THEN fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) ELSE 0 END AS ret_qty,
      CASE WHEN r.request_type = 'Order'  THEN it.requested_qty * it.unit_price ELSE 0 END    AS req_amt,
      CASE WHEN r.request_type = 'Order'  THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price ELSE 0 END AS disp_amt,
      CASE WHEN r.request_type = 'Return' THEN fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price ELSE 0 END AS ret_amt
    FROM stock_requests r
    JOIN stock_request_items it ON it.request_id = r.id
    JOIN products            p  ON p.id          = it.product_id
    , range g
    WHERE r.is_deleted = false
      AND (
            (r.request_type = 'Order'  AND r.status = 'Received' AND r.received_at >= g.lo AND r.received_at < g.hi)
         OR (r.request_type = 'Return' AND r.status = 'Accepted' AND r.accepted_at >= g.lo AND r.accepted_at < g.hi)
      )
      AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
      AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
      AND (
            NOT EXISTS (SELECT 1 FROM cat_closure)
            OR p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
          )
  )
  SELECT
    product_id, product_code, product_name, weight_value, weight_unit,
    SUM(signed_qty)::bigint           AS quantity,
    SUM(signed_amount)::numeric(14,2) AS amount,
    SUM(req_qty)::bigint              AS requested_qty,
    SUM(disp_qty)::bigint             AS dispatched_qty,
    SUM(ret_qty)::bigint              AS returns_qty,
    SUM(req_amt)::numeric(14,2)       AS requested_amount,
    SUM(disp_amt)::numeric(14,2)      AS dispatched_amount,
    SUM(ret_amt)::numeric(14,2)       AS returns_amount
  FROM contrib
  GROUP BY product_id, product_code, product_name, weight_value, weight_unit
  -- ORDER BY net amount stays the default. FE re-sorts client-side when
  -- a non-'All' view is active (avoids a second SP roundtrip).
  ORDER BY amount DESC, product_code
  LIMIT GREATEST(COALESCE(p_limit, 10), 1);
$$;


-- ============================================================
-- 6. fn_accounts_adjustments
--    Audit-log rows (qty edits) anchored on edited_at, with derived
--    delta_qty / delta_amount (uses the line's UNIT_PRICE snapshot, not the
--    current product MRP — so the historical delta is stable).
-- ============================================================
-- 19-Jun-2026 (client #13): adds request_type column so the FE Accounts
-- view-mode lens can filter audits by Order / Return slice.
-- 06-Jul-2026: also projects is_special + special_label from the parent
-- request so the FE can flag audit rows tied to Special Requests (amber
-- chip next to the request code, matches the visual language used across
-- shop / inv / admin list + detail pages). RETURNS shape change → the
-- prior DROP guards below stay + a new one drops the pre-special shape.
DROP FUNCTION IF EXISTS fn_accounts_adjustments(date, date, uuid[], uuid[], int[]);

CREATE OR REPLACE FUNCTION fn_accounts_adjustments(
  p_from        date,
  p_to          date,
  p_shop_ids    uuid[]  DEFAULT NULL,
  p_inv_ids     uuid[]  DEFAULT NULL,
  p_cat_ids     int[]   DEFAULT NULL
)
RETURNS TABLE (
  audit_id        uuid,
  edited_at       timestamptz,
  request_id      uuid,
  request_code    varchar,
  -- Request shape — 'Order' or 'Return'. Lets the FE filter audits by view.
  request_type    varchar,
  -- Shop-declared Special Request flag + user-supplied label. Both projected
  -- from stock_requests (join already present). NULL/false on normal orders.
  is_special      boolean,
  special_label   varchar,
  shop_id         uuid,
  shop_name       varchar,
  product_id      uuid,
  product_name    varchar,
  weight_value    numeric,
  weight_unit     varchar,
  old_qty         int,
  new_qty         int,
  delta_qty       int,
  unit_price      numeric,
  delta_amount    numeric,
  reason          varchar,
  edited_by_id    uuid,
  edited_by_name  varchar
)
LANGUAGE sql STABLE AS $$
  WITH
  range AS (
    SELECT (p_from::timestamp     AT TIME ZONE 'Asia/Kolkata') AS lo,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS hi
  ),
  cat_closure AS (
    SELECT array_agg(id)::int[] AS ids
    FROM (
      WITH RECURSIVE walk AS (
        SELECT c.id FROM categories c
         WHERE c.is_deleted = false AND c.id = ANY(p_cat_ids)
        UNION
        SELECT c.id FROM categories c
        JOIN   walk w ON c.parent_id = w.id
         WHERE c.is_deleted = false
      )
      SELECT id FROM walk
    ) t
    WHERE p_cat_ids IS NOT NULL AND cardinality(p_cat_ids) > 0
    -- Emit a row ONLY when ids were actually collected. Without this,
    -- array_agg over an empty input still returns one (NULL) row, so the
    -- downstream `NOT EXISTS (SELECT 1 FROM cat_closure)` "no filter" guard
    -- would always be false and silently filter out every request.
    HAVING count(*) > 0
  )
  SELECT
    a.id                                                           AS audit_id,
    a.edited_at,
    a.request_id,
    r.code                                                         AS request_code,
    r.request_type                                                 AS request_type,
    r.is_special,
    r.special_label,
    r.shop_id,
    s.name                                                         AS shop_name,
    p.id                                                           AS product_id,
    p.name                                                         AS product_name,
    it.weight_value,
    it.weight_unit,
    a.old_qty,
    a.new_qty,
    (COALESCE(a.new_qty,0) - COALESCE(a.old_qty,0))                AS delta_qty,
    it.unit_price,
    ((COALESCE(a.new_qty,0) - COALESCE(a.old_qty,0)) * it.unit_price)::numeric(14,2) AS delta_amount,
    a.reason,
    a.edited_by                                                    AS edited_by_id,
    u.full_name                                                    AS edited_by_name
  FROM stock_request_qty_audits a
  JOIN stock_request_items it ON it.id = a.request_item_id
  JOIN stock_requests       r  ON r.id  = a.request_id
  JOIN shops                s  ON s.id  = r.shop_id
  JOIN products             p  ON p.id  = it.product_id
  LEFT JOIN users           u  ON u.id  = a.edited_by
  , range g
  WHERE r.is_deleted = false
    AND a.edited_at >= g.lo AND a.edited_at < g.hi
    AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
    AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
    AND (
          NOT EXISTS (SELECT 1 FROM cat_closure)
          OR p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
        )
  ORDER BY a.edited_at DESC;
$$;


-- ============================================================
-- 7. fn_accounts_in_transit
--    Single-row summary of Orders that have been dispatched but not yet
--    received. INDEPENDENT of the date range — the strip is always "right
--    now" — but honours the shop / inventory filters so an admin viewing a
--    single shop sees only that shop's stuck dispatches.
-- ============================================================
-- 06-Jul-2026: RETURNS gained special_count + special_amount so the
-- InTransit strip can surface "of the N in transit, K are Special
-- Requests (₹X)". Shape change → drop before re-create.
DROP FUNCTION IF EXISTS fn_accounts_in_transit(uuid[], uuid[]);

CREATE OR REPLACE FUNCTION fn_accounts_in_transit(
  p_shop_ids    uuid[]  DEFAULT NULL,
  p_inv_ids     uuid[]  DEFAULT NULL
)
RETURNS TABLE (
  request_count        bigint,
  total_amount         numeric,
  oldest_dispatched_at timestamptz,
  -- Subset of the above that are shop-declared Special Requests. Never
  -- exceeds request_count; equals 0 when the tenant has none in transit.
  special_count        bigint,
  special_amount       numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::bigint                                                       AS request_count,
    COALESCE(SUM(r.total_amount), 0)::numeric(14,2)                        AS total_amount,
    MIN(r.dispatched_at)                                                   AS oldest_dispatched_at,
    COUNT(*) FILTER (WHERE r.is_special)::bigint                           AS special_count,
    COALESCE(SUM(r.total_amount) FILTER (WHERE r.is_special), 0)::numeric(14,2) AS special_amount
  FROM stock_requests r
  WHERE r.is_deleted   = false
    AND r.request_type = 'Order'
    AND r.status       = 'Dispatched'
    AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
    AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids));
$$;


-- ============================================================
-- 8. fn_accounts_utilities_breakdown
--    Per-shop-per-category operating expenses (Rent / Electricity / Water /
--    Staff Salary / …) logged via the Shop Utilities screen. Powers the
--    Net Profit KPI + Utilities columns in the admin Accounts view.
--
--    Filter surface deliberately narrower than the other fn_accounts_*
--    reports:
--    • p_shop_ids applies (utilities are per-shop).
--    • p_inv_ids  — utilities aren't tied to a godown → not a parameter.
--    • p_cat_ids  — refers to *product* categories on the other reports;
--      the utility taxonomy (Rent/Water/…) is different and free-text.
--      Applying the product-category filter would meaninglessly zero out
--      utilities → not a parameter.
--
--    Date semantics: expense_date is a plain `date` (IST calendar day). No
--    IST-to-UTC conversion needed — the FE picks IST dates, we compare
--    directly. Range is inclusive on both ends [p_from, p_to] to match the
--    plain-date semantics (unlike the timestamptz half-open range used by
--    fn_accounts_summary).
--
--    Row shape: one row per (shop, category) with a total + count. Shops
--    with zero utilities in the range are absent (FE assumes 0). Empty
--    result set is normal — return_query no-op works.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_accounts_utilities_breakdown(
  p_from     date,
  p_to       date,
  p_shop_ids uuid[]  DEFAULT NULL
)
RETURNS TABLE (
  shop_id       uuid,
  shop_code     varchar,
  shop_name     varchar,
  category      varchar,
  amount        numeric,
  expense_count bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    e.shop_id,
    s.code                            AS shop_code,
    s.name                            AS shop_name,
    e.category,
    SUM(e.amount)::numeric(14,2)      AS amount,
    COUNT(*)::bigint                  AS expense_count
  FROM shop_utility_expenses e
  JOIN shops s ON s.id = e.shop_id
  WHERE e.is_deleted   = false
    AND s.is_deleted   = false
    AND e.expense_date >= p_from
    AND e.expense_date <= p_to
    AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR e.shop_id = ANY(p_shop_ids))
  GROUP BY e.shop_id, s.code, s.name, e.category
  ORDER BY s.name, e.category;
$$;


COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- SELECT * FROM fn_accounts_summary    ('2026-05-01','2026-05-31', NULL, NULL, NULL);
-- SELECT * FROM fn_accounts_trend      ('2026-05-25','2026-05-31', 'day',  NULL, NULL, NULL);
-- SELECT * FROM fn_accounts_by_shop    ('2026-05-01','2026-05-31', NULL, NULL, NULL);
-- SELECT * FROM fn_accounts_by_category('2026-05-01','2026-05-31', NULL, NULL, NULL);
-- SELECT * FROM fn_accounts_top_products('2026-05-01','2026-05-31', NULL, NULL, NULL, 10);
-- SELECT * FROM fn_accounts_adjustments('2026-05-01','2026-05-31', NULL, NULL, NULL);
-- SELECT * FROM fn_accounts_in_transit (NULL, NULL);
-- SELECT * FROM fn_accounts_utilities_breakdown('2026-07-01','2026-07-31', NULL);
-- ============================================================


-- ############################################################
-- >>> phase4/phase4_shop_inventory_procedures.sql
-- ############################################################

-- ============================================================
-- Kovilpatti Snacks — Phase 4 · SHOP INVENTORY · PROCEDURES (SPs)
--
-- Companion to phase4_shop_inventory_init.sql. Contains all SPs for
-- the shop-inventory slice: core writer + named wrappers + opening
-- seed + read APIs + stock-take flow.
--
-- Run AFTER phase4_shop_inventory_init.sql. All functions use
-- CREATE OR REPLACE — safe to reload after edits without dropping.
-- ============================================================
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase4/phase4_shop_inventory_procedures.sql
-- ============================================================


-- ------------------------------------------------------------
-- 0. Core movement writer (internal helper)
--
-- Every change to shop_inventory.on_hand goes through here. It:
--   1. Ensures the (shop, product) row exists (creates a zero row if not).
--   2. Locks the row FOR UPDATE — prevents two cashiers from overselling
--      the same last packet in a race.
--   3. Rejects negative on_hand outcomes with a clear message that carries
--      the current state, so overselling surfaces as a 400 at the API
--      boundary rather than a silent negative row.
--   4. Recomputes avg_cost via weighted-average — ONLY on Receipt / Opening
--      movements that carry a unit_cost. Sales / Returns / Adjustments
--      preserve avg_cost so P&L stays honest.
--   5. Writes the ledger row with qty_after set to the new on_hand.
--
-- Callers: the named wrappers below (Receipt/Sale/Return/Refund/Adjustment)
-- + the stock-take submit flow + the bill / stock-request flows once those
-- SPs land in later Phase 4 slices.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_shop_inventory_apply_movement(
  p_shop_id       uuid,
  p_product_id    uuid,
  p_movement_type varchar,
  p_qty_delta     numeric,
  p_unit_cost     numeric DEFAULT NULL,
  p_ref_type      varchar DEFAULT 'ManualAdjustment',
  p_ref_id        uuid    DEFAULT NULL,
  p_note          text    DEFAULT NULL,
  p_created_by    uuid    DEFAULT NULL
)
RETURNS uuid  -- id of the movement row written
LANGUAGE plpgsql AS $$
DECLARE
  v_current_on_hand   numeric(12,3);
  v_current_avg_cost  numeric(10,2);
  v_new_on_hand       numeric(12,3);
  v_new_avg_cost      numeric(10,2);
  v_movement_id       uuid;
BEGIN
  INSERT INTO shop_inventory(shop_id, product_id, on_hand, avg_cost, updated_at)
  VALUES (p_shop_id, p_product_id, 0, 0, now())
  ON CONFLICT (shop_id, product_id) DO NOTHING;

  SELECT on_hand, avg_cost
  INTO v_current_on_hand, v_current_avg_cost
  FROM shop_inventory
  WHERE shop_id = p_shop_id AND product_id = p_product_id
  FOR UPDATE;

  v_new_on_hand := v_current_on_hand + p_qty_delta;

  IF v_new_on_hand < 0 THEN
    RAISE EXCEPTION 'shop_inventory would go negative: shop=% product=% current=% delta=%',
      p_shop_id, p_product_id, v_current_on_hand, p_qty_delta
      USING ERRCODE = 'check_violation';
  END IF;

  IF (p_movement_type IN ('Receipt', 'Opening'))
     AND p_unit_cost IS NOT NULL
     AND p_qty_delta > 0
     AND v_new_on_hand > 0 THEN
    v_new_avg_cost := (
      (v_current_on_hand * v_current_avg_cost) + (p_qty_delta * p_unit_cost)
    ) / v_new_on_hand;
  ELSE
    v_new_avg_cost := v_current_avg_cost;
  END IF;

  UPDATE shop_inventory
  SET on_hand          = v_new_on_hand,
      avg_cost         = v_new_avg_cost,
      last_movement_at = now(),
      updated_at       = now()
  WHERE shop_id = p_shop_id AND product_id = p_product_id;

  INSERT INTO shop_inventory_movements (
    shop_id, product_id, movement_type, qty_delta, qty_after,
    unit_cost, ref_type, ref_id, note, created_by
  )
  VALUES (
    p_shop_id, p_product_id, p_movement_type, p_qty_delta, v_new_on_hand,
    p_unit_cost, p_ref_type, p_ref_id, p_note, p_created_by
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;


-- ------------------------------------------------------------
-- 1. Named movement wrappers
--
-- Thin wrappers around fn_shop_inventory_apply_movement for the five
-- common cases. Callers can also invoke the core writer directly if
-- they need a movement_type / ref_type combo the wrappers don't cover.
-- ------------------------------------------------------------

-- Goods coming IN to the shop from a godown dispatch.
-- Called from the stock-request receive flow (once wired).
CREATE OR REPLACE FUNCTION fn_shop_inventory_receipt(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_qty         numeric,
  p_unit_cost   numeric,
  p_ref_type    varchar,   -- typically 'StockRequest'
  p_ref_id      uuid,
  p_note        text  DEFAULT NULL,
  p_created_by  uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE sql AS $$
  SELECT fn_shop_inventory_apply_movement(
    p_shop_id, p_product_id, 'Receipt', abs(p_qty), p_unit_cost,
    p_ref_type, p_ref_id, p_note, p_created_by
  );
$$;

-- Sale to a walk-in customer. Called from fn_bill_create per line item
-- (once the bills SP lands). qty passed positive; wrapper negates.
CREATE OR REPLACE FUNCTION fn_shop_inventory_sale(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_qty         numeric,
  p_ref_id      uuid,       -- bill_id
  p_note        text  DEFAULT NULL,
  p_created_by  uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE sql AS $$
  SELECT fn_shop_inventory_apply_movement(
    p_shop_id, p_product_id, 'Sale', -abs(p_qty), NULL,
    'Bill', p_ref_id, p_note, p_created_by
  );
$$;

-- Return — direction depends on caller:
--   • Customer returning to shop → positive qty (on_hand goes UP)
--   • Shop returning to godown  → negative qty (on_hand goes DOWN)
-- Caller passes the signed qty explicitly.
CREATE OR REPLACE FUNCTION fn_shop_inventory_return(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_qty_delta   numeric,    -- signed by caller
  p_ref_type    varchar,    -- 'StockRequest' (shop→godown) | 'BillReturn' (customer→shop)
  p_ref_id      uuid,
  p_note        text  DEFAULT NULL,
  p_created_by  uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE sql AS $$
  SELECT fn_shop_inventory_apply_movement(
    p_shop_id, p_product_id, 'Return', p_qty_delta, NULL,
    p_ref_type, p_ref_id, p_note, p_created_by
  );
$$;

-- Bill cancellation — reverses a Sale by putting goods back on the shelf.
-- Called from fn_bill_cancel (once the bills SP lands).
CREATE OR REPLACE FUNCTION fn_shop_inventory_refund(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_qty         numeric,
  p_ref_id      uuid,       -- bill_id being reversed
  p_note        text  DEFAULT NULL,
  p_created_by  uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE sql AS $$
  SELECT fn_shop_inventory_apply_movement(
    p_shop_id, p_product_id, 'Refund', abs(p_qty), NULL,
    'Bill', p_ref_id, p_note, p_created_by
  );
$$;

-- Manual admin correction (damaged, expired, mis-count found outside a
-- formal stock-take). qty_delta signed by caller.
CREATE OR REPLACE FUNCTION fn_shop_inventory_manual_adjustment(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_qty_delta   numeric,
  p_reason      text,
  p_created_by  uuid
) RETURNS uuid
LANGUAGE sql AS $$
  SELECT fn_shop_inventory_apply_movement(
    p_shop_id, p_product_id, 'Adjustment', p_qty_delta, NULL,
    'ManualAdjustment', NULL, p_reason, p_created_by
  );
$$;


-- ------------------------------------------------------------
-- 2. Opening seed
--
-- Rolls up historical stock_request_items.received_qty per (shop, product)
-- and writes one Opening movement + populates initial on_hand + avg_cost.
--
-- Pass NULL to seed ALL shops; pass a specific shop_id to scope.
-- Idempotent — skips pairs that already have an Opening row.
--
-- Only movements where the shop actually received goods count
-- (stock_requests.status IN ('Received', 'Dispatched')).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_shop_inventory_seed_opening(
  p_shop_id uuid DEFAULT NULL
)
RETURNS TABLE (
  shop_id    uuid,
  product_id uuid,
  seeded_qty numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_row             record;
  v_purchase_price  numeric(10,2);
BEGIN
  -- 25-Jul-2026: sums effective received pack qty (packet-count OR
  -- partial-weight fractional) so opening balances include partial
  -- dispatches too. Fractional numeric flows fine into shop_inventory.on_hand.
  FOR v_row IN
    SELECT
      sr.shop_id     AS s_id,
      sri.product_id AS p_id,
      SUM(COALESCE(
        fn_effective_pack_qty(sri.received_qty, sri.received_weight_g, sri.weight_value, sri.weight_unit),
        0
      ))::numeric AS total_received
    FROM stock_request_items sri
    INNER JOIN stock_requests sr ON sr.id = sri.request_id
    WHERE sr.status IN ('Received', 'Dispatched')
      AND (p_shop_id IS NULL OR sr.shop_id = p_shop_id)
      AND COALESCE(
            fn_effective_pack_qty(sri.received_qty, sri.received_weight_g, sri.weight_value, sri.weight_unit),
            0
          ) > 0
    GROUP BY sr.shop_id, sri.product_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM shop_inventory_movements
      WHERE shop_inventory_movements.shop_id = v_row.s_id
        AND shop_inventory_movements.product_id = v_row.p_id
        AND movement_type = 'Opening'
    ) THEN
      CONTINUE;
    END IF;

    SELECT purchase_price INTO v_purchase_price
    FROM products WHERE id = v_row.p_id;

    PERFORM fn_shop_inventory_apply_movement(
      v_row.s_id, v_row.p_id,
      'Opening', v_row.total_received,
      COALESCE(v_purchase_price, 0),
      'Opening', NULL,
      'Initial seed from historical dispatch receipts',
      NULL
    );

    shop_id    := v_row.s_id;
    product_id := v_row.p_id;
    seeded_qty := v_row.total_received;
    RETURN NEXT;
  END LOOP;
END;
$$;


-- ------------------------------------------------------------
-- 3. Read APIs (public — surface as endpoints)
-- ------------------------------------------------------------

-- Standing on-hand for a shop with optional tokenised search over
-- product code + name. Same predicate as fn_product_list — see
-- phase1_product_tokenized_search.sql for rationale (handles
-- "nat.kam" / "nat kam" / "017 kam" / etc).
CREATE OR REPLACE FUNCTION fn_shop_inventory_on_hand(
  p_shop_id     uuid,
  p_search      varchar DEFAULT NULL,
  p_page        int     DEFAULT 1,
  p_page_size   int     DEFAULT 25
)
RETURNS TABLE (
  product_id        uuid,
  product_code      text,
  product_name      varchar,
  category_name     varchar,
  weight_value      numeric,
  weight_unit       varchar,
  mrp               numeric,
  on_hand           numeric,
  avg_cost          numeric,
  stock_value       numeric,
  last_movement_at  timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id, p.code, p.name, c.name AS category_name,
    p.weight_value, p.weight_unit, p.mrp,
    si.on_hand, si.avg_cost,
    (si.on_hand * si.avg_cost)::numeric(14,2) AS stock_value,
    si.last_movement_at
  FROM shop_inventory si
  INNER JOIN products   p ON p.id = si.product_id
  INNER JOIN categories c ON c.id = p.category_id
  WHERE si.shop_id = p_shop_id
    AND p.is_deleted = false
    AND (p_search IS NULL OR trim(p_search) = ''
         OR NOT EXISTS (
           SELECT 1
           FROM regexp_split_to_table(lower(trim(p_search)), '[^a-z0-9]+') AS tok
           WHERE tok <> ''
             AND strpos(lower(p.code || ' ' || p.name), tok) = 0
         ))
  ORDER BY p.code
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;

-- Total row count matching the same filter — pagination needs both.
CREATE OR REPLACE FUNCTION fn_shop_inventory_on_hand_count(
  p_shop_id uuid,
  p_search  varchar DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)
  FROM shop_inventory si
  INNER JOIN products p ON p.id = si.product_id
  WHERE si.shop_id = p_shop_id
    AND p.is_deleted = false
    AND (p_search IS NULL OR trim(p_search) = ''
         OR NOT EXISTS (
           SELECT 1
           FROM regexp_split_to_table(lower(trim(p_search)), '[^a-z0-9]+') AS tok
           WHERE tok <> ''
             AND strpos(lower(p.code || ' ' || p.name), tok) = 0
         ));
$$;

-- Single (shop, product) row lookup.
CREATE OR REPLACE FUNCTION fn_shop_inventory_get(
  p_shop_id    uuid,
  p_product_id uuid
)
RETURNS TABLE (
  shop_id           uuid,
  product_id        uuid,
  product_code      text,
  product_name      varchar,
  on_hand           numeric,
  avg_cost          numeric,
  stock_value       numeric,
  last_movement_at  timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    si.shop_id, si.product_id,
    p.code, p.name,
    si.on_hand, si.avg_cost,
    (si.on_hand * si.avg_cost)::numeric(14,2) AS stock_value,
    si.last_movement_at
  FROM shop_inventory si
  INNER JOIN products p ON p.id = si.product_id
  WHERE si.shop_id = p_shop_id AND si.product_id = p_product_id
  LIMIT 1;
$$;

-- Reorder-suggestion feed.
-- Also joins to fn_category_list() so each row carries the breadcrumb
-- path ("1KG Snacks > Chips 300") + leaf name — dashboard renders these
-- in bold so the shop user immediately sees WHERE the low item sits.
--
-- Return-shape changed 10-Jul-2026 (added category_id/name/path) — drop
-- the old shape first because CREATE OR REPLACE can't alter RETURNS.
DROP FUNCTION IF EXISTS fn_shop_inventory_low_stock(uuid, numeric);

CREATE OR REPLACE FUNCTION fn_shop_inventory_low_stock(
  p_shop_id   uuid,
  p_threshold numeric DEFAULT 5
)
RETURNS TABLE (
  product_id    uuid,
  product_code  text,
  product_name  varchar,
  on_hand       numeric,
  mrp           numeric,
  category_id   int,
  category_name varchar,
  category_path varchar
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, si.on_hand, p.mrp,
         c.id, c.name, c.path
  FROM shop_inventory si
  INNER JOIN products      p ON p.id = si.product_id
  LEFT  JOIN fn_category_list() c ON c.id = p.category_id
  WHERE si.shop_id = p_shop_id
    AND p.is_deleted = false
    AND p.active = true
    AND si.on_hand < p_threshold
  ORDER BY si.on_hand ASC, p.code;
$$;

-- Balance-sheet inventory value = SUM(on_hand × avg_cost).
CREATE OR REPLACE FUNCTION fn_shop_inventory_valuation(
  p_shop_id uuid
)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(on_hand * avg_cost), 0)::numeric(14,2)
  FROM shop_inventory
  WHERE shop_id = p_shop_id;
$$;

-- Movement audit trail — full ledger with product + actor names joined.
CREATE OR REPLACE FUNCTION fn_shop_inventory_movements(
  p_shop_id    uuid,
  p_product_id uuid    DEFAULT NULL,
  p_from       date    DEFAULT NULL,
  p_to         date    DEFAULT NULL,
  p_page       int     DEFAULT 1,
  p_page_size  int     DEFAULT 50
)
RETURNS TABLE (
  id               uuid,
  product_id       uuid,
  product_code     text,
  product_name     varchar,
  movement_type    varchar,
  qty_delta        numeric,
  qty_after        numeric,
  unit_cost        numeric,
  ref_type         varchar,
  ref_id           uuid,
  note             text,
  created_at       timestamptz,
  created_by       uuid,
  created_by_name  varchar
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.id, m.product_id, p.code, p.name,
    m.movement_type, m.qty_delta, m.qty_after,
    m.unit_cost, m.ref_type, m.ref_id, m.note,
    m.created_at, m.created_by, u.full_name
  FROM shop_inventory_movements m
  INNER JOIN products p ON p.id = m.product_id
  LEFT  JOIN users    u ON u.id = m.created_by
  WHERE m.shop_id = p_shop_id
    AND (p_product_id IS NULL OR m.product_id = p_product_id)
    AND (p_from IS NULL OR m.created_at >= p_from::timestamptz)
    AND (p_to   IS NULL OR m.created_at <  (p_to + interval '1 day')::timestamptz)
  ORDER BY m.created_at DESC
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;

-- Slim "browse everything" read for the dashboard's category-tree view.
-- Returns every product with an inventory row for this shop, keyed by
-- category_id so the FE can group + roll up qty through the category
-- tree (via the existing categories hook). NO pagination — the tree
-- fundamentally shows the whole catalog at once. Response is intentionally
-- narrow (no avg_cost / weight / etc.) so the payload stays small even
-- when the catalog grows to several hundred SKUs.
CREATE OR REPLACE FUNCTION fn_shop_inventory_tree(p_shop_id uuid)
RETURNS TABLE (
  product_id    uuid,
  product_code  text,
  product_name  varchar,
  category_id   int,
  on_hand       numeric,
  mrp           numeric
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, si.on_hand, p.mrp
  FROM shop_inventory si
  INNER JOIN products p ON p.id = si.product_id
  WHERE si.shop_id = p_shop_id
    AND p.is_deleted = false
  ORDER BY p.category_id, p.code;
$$;


-- Movement summary bucketed by movement_type for a period.
CREATE OR REPLACE FUNCTION fn_shop_inventory_movement_summary(
  p_shop_id uuid,
  p_from    date,
  p_to      date
)
RETURNS TABLE (
  movement_type  varchar,
  total_qty      numeric,
  total_lines    bigint,
  total_value    numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.movement_type,
    SUM(m.qty_delta)::numeric AS total_qty,
    COUNT(*)                  AS total_lines,
    COALESCE(SUM(m.qty_delta * m.unit_cost), 0)::numeric(14,2) AS total_value
  FROM shop_inventory_movements m
  WHERE m.shop_id = p_shop_id
    AND m.created_at >= p_from::timestamptz
    AND m.created_at <  (p_to + interval '1 day')::timestamptz
  GROUP BY m.movement_type
  ORDER BY m.movement_type;
$$;


-- ------------------------------------------------------------
-- 4. Stock-take SPs
-- ------------------------------------------------------------

-- Start a Draft session. Snapshots every product currently in
-- shop_inventory with counted_qty = system_qty (so user adjusts what's
-- off, not re-enters everything).
CREATE OR REPLACE FUNCTION fn_stock_take_start(
  p_shop_id    uuid,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM shop_stock_takes
    WHERE shop_id = p_shop_id AND status = 'Draft' AND is_deleted = false
  ) THEN
    RAISE EXCEPTION 'A draft stock-take is already open for this shop'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO shop_stock_takes (shop_id, created_by)
  VALUES (p_shop_id, p_created_by)
  RETURNING id INTO v_id;

  INSERT INTO shop_stock_take_items (stock_take_id, product_id, system_qty, counted_qty)
  SELECT v_id, si.product_id, si.on_hand, si.on_hand
  FROM shop_inventory si
  WHERE si.shop_id = p_shop_id;

  RETURN v_id;
END;
$$;

-- Upsert one counted-qty line. If the product wasn't in the initial
-- snapshot (received AFTER Start), system_qty is fetched fresh
-- (0 if never received).
CREATE OR REPLACE FUNCTION fn_stock_take_upsert_line(
  p_stock_take_id uuid,
  p_product_id    uuid,
  p_counted_qty   numeric,
  p_note          text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_shop_id    uuid;
  v_status     varchar;
  v_system_qty numeric;
BEGIN
  SELECT shop_id, status INTO v_shop_id, v_status
  FROM shop_stock_takes WHERE id = p_stock_take_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Stock-take % not found', p_stock_take_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'Draft' THEN
    RAISE EXCEPTION 'Cannot edit a % stock-take', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT on_hand INTO v_system_qty
  FROM shop_inventory
  WHERE shop_id = v_shop_id AND product_id = p_product_id;
  v_system_qty := COALESCE(v_system_qty, 0);

  INSERT INTO shop_stock_take_items (
    stock_take_id, product_id, system_qty, counted_qty, note
  )
  VALUES (p_stock_take_id, p_product_id, v_system_qty, p_counted_qty, p_note)
  ON CONFLICT (stock_take_id, product_id) DO UPDATE
    SET counted_qty = EXCLUDED.counted_qty,
        note        = EXCLUDED.note;
END;
$$;

-- Session detail — header + items joined. LEFT JOIN + NULLS LAST so a
-- freshly-started take with 0 lines still returns 1 row (header info).
CREATE OR REPLACE FUNCTION fn_stock_take_get(p_id uuid)
RETURNS TABLE (
  id            uuid,
  code          varchar,
  shop_id       uuid,
  status        varchar,
  started_at    timestamptz,
  submitted_at  timestamptz,
  notes         text,
  product_id    uuid,
  product_code  text,
  product_name  varchar,
  system_qty    numeric,
  counted_qty   numeric,
  qty_diff      numeric,
  item_note     text
)
LANGUAGE sql STABLE AS $$
  SELECT
    t.id, t.code, t.shop_id, t.status, t.started_at, t.submitted_at, t.notes,
    i.product_id, p.code, p.name,
    i.system_qty, i.counted_qty, i.qty_diff, i.note
  FROM shop_stock_takes t
  LEFT JOIN shop_stock_take_items i ON i.stock_take_id = t.id
  LEFT JOIN products p ON p.id = i.product_id
  WHERE t.id = p_id
  ORDER BY p.code NULLS LAST;
$$;

-- History list per shop with rollups: how many lines counted, how many
-- had a non-zero diff, and net diff qty (sanity signal — huge net means
-- someone counted wrong or there's genuine shrinkage).
CREATE OR REPLACE FUNCTION fn_stock_take_list(
  p_shop_id   uuid,
  p_status    varchar DEFAULT NULL,
  p_from      date    DEFAULT NULL,
  p_to        date    DEFAULT NULL,
  p_page      int     DEFAULT 1,
  p_page_size int     DEFAULT 25
)
RETURNS TABLE (
  id            uuid,
  code          varchar,
  status        varchar,
  started_at    timestamptz,
  submitted_at  timestamptz,
  item_count    bigint,
  diff_count    bigint,
  net_diff_qty  numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    t.id, t.code, t.status, t.started_at, t.submitted_at,
    COUNT(i.id) FILTER (WHERE i.qty_diff IS NOT NULL) AS item_count,
    COUNT(i.id) FILTER (WHERE i.qty_diff <> 0)        AS diff_count,
    COALESCE(SUM(i.qty_diff), 0)::numeric             AS net_diff_qty
  FROM shop_stock_takes t
  LEFT JOIN shop_stock_take_items i ON i.stock_take_id = t.id
  WHERE t.shop_id = p_shop_id
    AND t.is_deleted = false
    AND (p_status IS NULL OR t.status = p_status)
    AND (p_from IS NULL OR t.started_at >= p_from::timestamptz)
    AND (p_to   IS NULL OR t.started_at <  (p_to + interval '1 day')::timestamptz)
  GROUP BY t.id
  ORDER BY t.started_at DESC
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;

-- Commit the count → writes one Adjustment movement per non-zero diff
-- and marks the session Submitted. Returns count of movements written
-- so caller can show "N stock corrections applied".
CREATE OR REPLACE FUNCTION fn_stock_take_submit(
  p_id           uuid,
  p_submitted_by uuid
)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_shop_id  uuid;
  v_status   varchar;
  v_count    bigint := 0;
  v_row      record;
BEGIN
  SELECT shop_id, status INTO v_shop_id, v_status
  FROM shop_stock_takes WHERE id = p_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Stock-take % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'Draft' THEN
    RAISE EXCEPTION 'Cannot submit a % stock-take', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_row IN
    SELECT product_id, qty_diff
    FROM shop_stock_take_items
    WHERE stock_take_id = p_id AND qty_diff <> 0
  LOOP
    PERFORM fn_shop_inventory_apply_movement(
      v_shop_id, v_row.product_id,
      'Adjustment', v_row.qty_diff, NULL,
      'StockTake', p_id,
      'Stock-take reconciliation',
      p_submitted_by
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE shop_stock_takes
  SET status       = 'Submitted',
      submitted_at = now(),
      updated_at   = now(),
      updated_by   = p_submitted_by
  WHERE id = p_id;

  RETURN v_count;
END;
$$;

-- Cancel a Draft session — no movements written; reason appended to notes.
CREATE OR REPLACE FUNCTION fn_stock_take_cancel(
  p_id           uuid,
  p_reason       text,
  p_cancelled_by uuid
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_status varchar;
BEGIN
  SELECT status INTO v_status
  FROM shop_stock_takes WHERE id = p_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Stock-take % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status = 'Submitted' THEN
    RAISE EXCEPTION 'Cannot cancel a submitted stock-take'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE shop_stock_takes
  SET status     = 'Cancelled',
      notes      = COALESCE(notes || E'\n', '') || 'Cancelled: ' || p_reason,
      updated_at = now(),
      updated_by = p_cancelled_by
  WHERE id = p_id;
END;
$$;


-- ============================================================
-- OPTIONAL — run the opening seed after this file commits.
-- Uncomment the appropriate line, paste into the SQL editor.
-- Safe to re-run — idempotent (skips pairs already opened).
--
--   SELECT * FROM fn_shop_inventory_seed_opening(NULL);
--   SELECT * FROM fn_shop_inventory_seed_opening('<shop-uuid-here>'::uuid);
-- ============================================================


-- ============================================================
-- QUICK VERIFY (paste each block after running both files;
-- adjust UUIDs to real shops / products / users in your dev DB)
-- ============================================================
--
-- Confirm SPs landed:
--   SELECT proname FROM pg_proc
--    WHERE proname LIKE 'fn_shop_inventory%' OR proname LIKE 'fn_stock_take%'
--    ORDER BY proname;
--
-- Record a receipt (godown → shop delivered 20 units @ ₹15):
--   SELECT fn_shop_inventory_receipt(
--     '<shop-uuid>'::uuid, '<product-uuid>'::uuid,
--     20, 15.00, 'StockRequest', NULL, 'test receipt', NULL);
--
-- Peek at on-hand:
--   SELECT * FROM fn_shop_inventory_on_hand('<shop-uuid>'::uuid, NULL, 1, 25);
--
-- Peek at the ledger:
--   SELECT * FROM fn_shop_inventory_movements('<shop-uuid>'::uuid, NULL, NULL, NULL, 1, 20);
--
-- Ring up a sale (bill uuid is fake for the test):
--   SELECT fn_shop_inventory_sale(
--     '<shop-uuid>'::uuid, '<product-uuid>'::uuid,
--     3, gen_random_uuid(), 'test sale', NULL);
--
-- Try to oversell — should raise check_violation:
--   SELECT fn_shop_inventory_sale(
--     '<shop-uuid>'::uuid, '<product-uuid>'::uuid,
--     9999, gen_random_uuid(), NULL, NULL);
--
-- Stock-take round-trip:
--   SELECT fn_stock_take_start('<shop-uuid>'::uuid, '<user-uuid>'::uuid);
--   SELECT fn_stock_take_upsert_line('<stock-take-id>'::uuid, '<product-uuid>'::uuid, 15, 'counted');
--   SELECT * FROM fn_stock_take_get('<stock-take-id>'::uuid);
--   SELECT fn_stock_take_submit('<stock-take-id>'::uuid, '<user-uuid>'::uuid);
--   SELECT * FROM fn_shop_inventory_movements('<shop-uuid>'::uuid, NULL, NULL, NULL, 1, 20);
--
-- Balance-sheet value + low stock:
--   SELECT fn_shop_inventory_valuation('<shop-uuid>'::uuid);
--   SELECT * FROM fn_shop_inventory_low_stock('<shop-uuid>'::uuid, 5);
-- ============================================================


-- ############################################################
-- >>> One shot scripts/phase4_bill_returns_migration.sql
-- ############################################################

-- ============================================================
-- Kovilpatti Snacks — Phase 4b · BILL RETURNS · MIGRATION
--
-- Feature #1 (Return Bill) from DB/planned/phase4_billing_full_scope.md.
-- Agreed scope (22-Jul-2026):
--   • Refund modes: Cash | UPI only  (customer/credit balance from
--     feature #4 is NOT built yet — no "add to credit" / store-credit)
--   • Partial AND full returns (pick items + qty, capped at billed −
--     already-returned)
--   • No return-window enforcement
--   • No thermal print
--
-- Idempotent one-shot for an existing dev/UAT deploy. Safe to re-run:
-- CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE throughout. The same
-- DDL/SPs are baked into DB/phase4/phase4_billing_init.sql +
-- phase4_billing_procedures.sql for fresh deploys.
--
-- Run AFTER: phase4_billing_init.sql + phase4_billing_procedures.sql.
-- ------------------------------------------------------------
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f "DB/One shot scripts/phase4_bill_returns_migration.sql"
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. bill_returns — return header. One row per return event; a bill
--    can have several partial returns over time (each is its own row,
--    linked by source_bill_id — same trace pattern as
--    stock_requests.source_request_id for Phase 3 accounts).
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS bill_return_code_seq START 1;

CREATE TABLE IF NOT EXISTS bill_returns (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code             varchar(20)   NOT NULL DEFAULT 'RET' || lpad(nextval('bill_return_code_seq')::text, 4, '0'),
  source_bill_id   uuid          NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  shop_id          uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  -- Cash back or UPI reverse. Credit/store-credit deferred to feature #4.
  refund_mode      varchar(10)   NOT NULL,
  -- Category + free-text note (doc: damaged / wrong item / changed mind / other).
  reason_type      varchar(20)   NOT NULL,
  reason_note      varchar(500)  NULL,
  -- Cached aggregates, kept in sync by fn_bill_return_create (same
  -- pattern as bills.total_items/total_qty/total_amount).
  total_items      int           NOT NULL DEFAULT 0,
  total_qty        int           NOT NULL DEFAULT 0,
  total_amount     numeric(12,2) NOT NULL DEFAULT 0,
  is_deleted       boolean       NOT NULL DEFAULT false,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  created_by       uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  updated_by       uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_bill_returns_code UNIQUE (code),
  CONSTRAINT chk_bill_returns_refund_mode CHECK (refund_mode IN ('Cash','UPI')),
  CONSTRAINT chk_bill_returns_reason_type
    CHECK (reason_type IN ('Damaged','WrongItem','ChangedMind','Other')),
  CONSTRAINT chk_bill_returns_totals_nonneg
    CHECK (total_items >= 0 AND total_qty >= 0 AND total_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_returns_shop_time ON bill_returns(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_returns_source     ON bill_returns(source_bill_id);


-- ------------------------------------------------------------
-- 2. bill_return_items — returned lines. unit_price is copied from the
--    original bill line (refund at the price actually charged, never
--    current MRP). Same product can't appear twice on one return.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_return_items (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id    uuid          NOT NULL REFERENCES bill_returns(id) ON DELETE CASCADE,
  product_id   uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty          int           NOT NULL,
  unit_price   numeric(10,2) NOT NULL,
  line_total   numeric(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED,
  CONSTRAINT uq_bill_return_items_return_product UNIQUE (return_id, product_id),
  CONSTRAINT chk_bill_return_items_qty_pos      CHECK (qty > 0),
  CONSTRAINT chk_bill_return_items_price_nonneg CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_return_items_return  ON bill_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_bill_return_items_product ON bill_return_items(product_id);


-- updated_at trigger — reuse set_updated_at() from phase 1.
DROP TRIGGER IF EXISTS trg_bill_returns_updated ON bill_returns;
CREATE TRIGGER trg_bill_returns_updated BEFORE UPDATE ON bill_returns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;


-- ============================================================
-- PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- 3. fn_bill_returnable_items — per-line returnable qty for a bill.
--    Powers the Return dialog: billed qty, already-returned qty (sum
--    over prior non-deleted returns), and remaining returnable.
--    Rows with returnable = 0 are still returned so the UI can grey them.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_returnable_items(
  p_bill_id  uuid,
  p_shop_id  uuid
)
RETURNS TABLE (
  product_id       uuid,
  product_code     text,
  product_name     varchar,
  weight_value     numeric,
  weight_unit      varchar,
  unit_price       numeric,
  billed_qty       int,
  returned_qty     int,
  returnable_qty   int
)
LANGUAGE sql STABLE AS $$
  SELECT bi.product_id,
         p.code AS product_code,
         p.name AS product_name,
         p.weight_value,
         p.weight_unit,
         bi.unit_price,
         bi.qty AS billed_qty,
         COALESCE(r.returned_qty, 0)::int AS returned_qty,
         (bi.qty - COALESCE(r.returned_qty, 0))::int AS returnable_qty
  FROM   bills b
  JOIN   bill_items bi ON bi.bill_id = b.id
  JOIN   products p    ON p.id = bi.product_id
  LEFT   JOIN (
           SELECT bri.product_id, SUM(bri.qty) AS returned_qty
           FROM   bill_return_items bri
           JOIN   bill_returns br ON br.id = bri.return_id
           WHERE  br.source_bill_id = p_bill_id
             AND  br.is_deleted = false
           GROUP  BY bri.product_id
         ) r ON r.product_id = bi.product_id
  WHERE  b.id = p_bill_id
    AND  b.shop_id = p_shop_id
    AND  b.is_deleted = false
  ORDER  BY p.name;
$$;


-- ------------------------------------------------------------
-- 4. fn_bill_return_create — atomic: validate against the source bill,
--    insert header + lines, and put each returned qty back on the shelf
--    via fn_shop_inventory_refund.
--
-- p_items: jsonb array of {"productId": uuid, "qty": int}
--
-- Validation (each RAISEs → API surfaces as 400):
--   • source bill exists, same shop, status 'Issued' (a Cancelled bill
--     already reversed its stock — nothing to return)
--   • cart not empty, qty > 0, no duplicate products
--   • each product was on the bill; qty <= billed − already-returned
--   • refund_mode Cash|UPI, reason_type in the allowed set
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_return_create(
  p_bill_id      uuid,
  p_shop_id      uuid,
  p_user_id      uuid,
  p_refund_mode  varchar,
  p_reason_type  varchar,
  p_reason_note  varchar,
  p_items        jsonb
)
RETURNS TABLE (
  id           uuid,
  code         varchar,
  total_items  int,
  total_qty    int,
  total_amount numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_bill         record;
  v_return_id    uuid;
  v_code         varchar(20);
  v_line         record;
  v_billed_qty   int;
  v_returned_qty int;
  v_unit_price   numeric(10,2);
  v_total_items  int := 0;
  v_total_qty    int := 0;
  v_total_amount numeric(12,2) := 0;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A return must contain at least one item.';
  END IF;

  IF p_refund_mode NOT IN ('Cash','UPI') THEN
    RAISE EXCEPTION 'Invalid refund mode "%": must be Cash or UPI.', p_refund_mode;
  END IF;

  IF p_reason_type NOT IN ('Damaged','WrongItem','ChangedMind','Other') THEN
    RAISE EXCEPTION 'Invalid return reason.';
  END IF;

  -- Duplicate-product guard for a friendly error before any insert.
  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice on the return — combine the quantity on one line.';
  END IF;

  -- Lock the source bill so two concurrent returns can't both consume
  -- the same remaining returnable qty.
  SELECT b.id, b.code, b.status
  INTO v_bill
  FROM bills b
  WHERE b.id = p_bill_id AND b.shop_id = p_shop_id AND b.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;

  IF v_bill.status <> 'Issued' THEN
    RAISE EXCEPTION 'Bill % is %, so it cannot be returned.', v_bill.code, lower(v_bill.status);
  END IF;

  INSERT INTO bill_returns (source_bill_id, shop_id, refund_mode, reason_type, reason_note, created_by)
  VALUES (p_bill_id, p_shop_id, p_refund_mode, p_reason_type, NULLIF(btrim(p_reason_note), ''), p_user_id)
  RETURNING bill_returns.id, bill_returns.code INTO v_return_id, v_code;

  FOR v_line IN
    SELECT (x->>'productId')::uuid AS product_id,
           (x->>'qty')::int        AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be a positive whole number.';
    END IF;

    -- The line must exist on the source bill; grab its sold price.
    SELECT bi.qty, bi.unit_price
    INTO v_billed_qty, v_unit_price
    FROM bill_items bi
    WHERE bi.bill_id = p_bill_id AND bi.product_id = v_line.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A product on the return was not on bill %.', v_bill.code;
    END IF;

    -- Already returned on earlier returns for this bill.
    SELECT COALESCE(SUM(bri.qty), 0)
    INTO v_returned_qty
    FROM bill_return_items bri
    JOIN bill_returns br ON br.id = bri.return_id
    WHERE br.source_bill_id = p_bill_id
      AND br.is_deleted = false
      AND bri.product_id = v_line.product_id;

    IF v_line.qty > (v_billed_qty - v_returned_qty) THEN
      RAISE EXCEPTION 'Cannot return % of a product — only % remain returnable on bill %.',
        v_line.qty, (v_billed_qty - v_returned_qty), v_bill.code;
    END IF;

    INSERT INTO bill_return_items (return_id, product_id, qty, unit_price)
    VALUES (v_return_id, v_line.product_id, v_line.qty, v_unit_price);

    -- Put the goods back on the shelf (Refund movement, row-locked).
    PERFORM fn_shop_inventory_refund(
      p_shop_id, v_line.product_id, v_line.qty, p_bill_id,
      'Return ' || v_code || ' (bill ' || v_bill.code || ')', p_user_id
    );

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty + v_line.qty;
    v_total_amount := v_total_amount + (v_line.qty * v_unit_price);
  END LOOP;

  UPDATE bill_returns br
  SET total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount,
      updated_by   = p_user_id
  WHERE br.id = v_return_id;

  RETURN QUERY
  SELECT br.id, br.code, br.total_items, br.total_qty, br.total_amount
  FROM bill_returns br WHERE br.id = v_return_id;
END;
$$;


-- ------------------------------------------------------------
-- 5. fn_bill_return_list — shop-scoped return history, newest first.
--    total_count via window so the API gets rows + count in one call.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_return_list(
  p_shop_id    uuid,
  p_search     varchar DEFAULT NULL,
  p_from       date    DEFAULT NULL,
  p_to         date    DEFAULT NULL,
  p_page       int     DEFAULT 1,
  p_page_size  int     DEFAULT 10
)
RETURNS TABLE (
  id               uuid,
  code             varchar,
  source_bill_id   uuid,
  source_bill_code varchar,
  refund_mode      varchar,
  reason_type      varchar,
  reason_note      varchar,
  total_items      int,
  total_qty        int,
  total_amount     numeric,
  created_at       timestamptz,
  created_by_name  varchar,
  total_count      bigint
)
LANGUAGE sql STABLE AS $$
  SELECT br.id,
         br.code,
         br.source_bill_id,
         b.code AS source_bill_code,
         br.refund_mode,
         br.reason_type,
         br.reason_note,
         br.total_items,
         br.total_qty,
         br.total_amount,
         br.created_at,
         u.full_name AS created_by_name,
         COUNT(*) OVER() AS total_count
  FROM   bill_returns br
  JOIN   bills b   ON b.id = br.source_bill_id
  LEFT   JOIN users u ON u.id = br.created_by
  WHERE  br.shop_id = p_shop_id
    AND  br.is_deleted = false
    AND  (p_search IS NULL OR p_search = ''
          OR br.code ILIKE '%' || p_search || '%'
          OR b.code  ILIKE '%' || p_search || '%')
    -- IST date boundaries — same convention as fn_bill_list / phase 3.
    AND  (p_from IS NULL OR (br.created_at AT TIME ZONE 'Asia/Kolkata')::date >= p_from)
    AND  (p_to   IS NULL OR (br.created_at AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
  ORDER  BY br.created_at DESC
  LIMIT  p_page_size
  OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;


-- ------------------------------------------------------------
-- 6. fn_bill_return_get + fn_bill_return_get_items — return detail.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_return_get(
  p_return_id  uuid,
  p_shop_id    uuid
)
RETURNS TABLE (
  id               uuid,
  code             varchar,
  source_bill_id   uuid,
  source_bill_code varchar,
  refund_mode      varchar,
  reason_type      varchar,
  reason_note      varchar,
  total_items      int,
  total_qty        int,
  total_amount     numeric,
  created_at       timestamptz,
  created_by_name  varchar
)
LANGUAGE sql STABLE AS $$
  SELECT br.id,
         br.code,
         br.source_bill_id,
         b.code AS source_bill_code,
         br.refund_mode,
         br.reason_type,
         br.reason_note,
         br.total_items,
         br.total_qty,
         br.total_amount,
         br.created_at,
         u.full_name AS created_by_name
  FROM   bill_returns br
  JOIN   bills b   ON b.id = br.source_bill_id
  LEFT   JOIN users u ON u.id = br.created_by
  WHERE  br.id = p_return_id
    AND  br.shop_id = p_shop_id
    AND  br.is_deleted = false;
$$;

CREATE OR REPLACE FUNCTION fn_bill_return_get_items(
  p_return_id  uuid
)
RETURNS TABLE (
  id            uuid,
  product_id    uuid,
  product_code  text,
  product_name  varchar,
  weight_value  numeric,
  weight_unit   varchar,
  qty           int,
  unit_price    numeric,
  line_total    numeric
)
LANGUAGE sql STABLE AS $$
  SELECT bri.id,
         bri.product_id,
         p.code AS product_code,
         p.name AS product_name,
         p.weight_value,
         p.weight_unit,
         bri.qty,
         bri.unit_price,
         bri.line_total
  FROM   bill_return_items bri
  JOIN   products p ON p.id = bri.product_id
  WHERE  bri.return_id = p_return_id
  ORDER  BY p.name;
$$;


-- ============================================================
-- VERIFY
--   SELECT tablename FROM pg_tables WHERE tablename IN ('bill_returns','bill_return_items');
--   SELECT proname FROM pg_proc WHERE proname LIKE 'fn_bill_return%'
--                                  OR proname = 'fn_bill_returnable_items';
-- ============================================================


-- ############################################################
-- >>> One shot scripts/phase4_bill_split_payment_migration.sql
-- ############################################################

-- ============================================================
-- Kovilpatti Snacks — Phase 4b · SPLIT PAYMENT · MIGRATION
--
-- Feature #5 from DB/planned/phase4_billing_full_scope.md. A bill can
-- now be settled with multiple tenders (e.g. ₹200 Cash + ₹300 UPI).
--
--   • new table bill_payments (bill_id, mode, amount) — one row per tender
--   • existing bills back-filled with a single payment row from their
--     current payment_mode + total_amount
--   • bills.payment_mode kept as a DENORMALISED summary label: the single
--     tender's mode, or 'Split' when a bill has more than one tender.
--     (Credit is added later by the credit-sales feature.)
--   • fn_bill_create now takes p_payments jsonb instead of a single mode;
--     it validates that the tenders sum to the computed bill total.
--
-- Idempotent one-shot. Baked into DB/phase4/phase4_billing_init.sql +
-- phase4_billing_procedures.sql for fresh deploys.
--
-- Run AFTER phase4_billing_init.sql + phase4_billing_procedures.sql.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. bill_payments — one row per tender on a bill.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_payments (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id     uuid          NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  mode        varchar(10)   NOT NULL,
  amount      numeric(12,2) NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_bill_payments_mode       CHECK (mode IN ('Cash','UPI')),
  CONSTRAINT chk_bill_payments_amount_pos CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);

-- ------------------------------------------------------------
-- 2. Back-fill: every existing bill gets a single tender row equal to
--    its total_amount, in its recorded payment_mode. Skip bills that
--    already have payment rows (re-run safe). total_amount = 0 bills
--    (edge) get no row — nothing was tendered.
-- ------------------------------------------------------------
INSERT INTO bill_payments (bill_id, mode, amount, created_at)
SELECT b.id, b.payment_mode, b.total_amount, b.created_at
FROM   bills b
WHERE  b.total_amount > 0
  AND  b.payment_mode IN ('Cash','UPI')
  AND  NOT EXISTS (SELECT 1 FROM bill_payments bp WHERE bp.bill_id = b.id);

-- ------------------------------------------------------------
-- 3. Widen the header payment_mode CHECK to allow the 'Split' summary.
-- ------------------------------------------------------------
ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bills_payment_mode;
ALTER TABLE bills ADD  CONSTRAINT chk_bills_payment_mode
  CHECK (payment_mode IN ('Cash','UPI','Split'));

COMMIT;


-- ============================================================
-- PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- 4. fn_bill_create — now takes p_payments (jsonb array of
--    {"mode": "Cash"|"UPI", "amount": numeric}). The tenders must sum
--    to the computed bill total. Header payment_mode is the single
--    tender's mode, or 'Split' for more than one.
--
--    Drop the v1 single-mode signature so the old overload can't linger.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_create(uuid, uuid, varchar, jsonb, varchar);

CREATE OR REPLACE FUNCTION fn_bill_create(
  p_shop_id       uuid,
  p_user_id       uuid,
  p_payments      jsonb,
  p_items         jsonb,
  p_notes         varchar DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  code         varchar,
  total_items  int,
  total_qty    int,
  total_amount numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_bill_id       uuid;
  v_code          varchar(20);
  v_line          record;
  v_pay           record;
  v_product       record;
  v_total_items   int := 0;
  v_total_qty     int := 0;
  v_total_amount  numeric(12,2) := 0;
  v_pay_count     int;
  v_pay_sum       numeric(12,2) := 0;
  v_summary_mode  varchar(10);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item.';
  END IF;

  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'Bill must have at least one payment.';
  END IF;

  v_pay_count := jsonb_array_length(p_payments);

  -- Validate each tender up front.
  FOR v_pay IN
    SELECT (x->>'mode')::varchar   AS mode,
           (x->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_payments) x
  LOOP
    IF v_pay.mode NOT IN ('Cash','UPI') THEN
      RAISE EXCEPTION 'Invalid payment mode "%": must be Cash or UPI.', v_pay.mode;
    END IF;
    IF v_pay.amount IS NULL OR v_pay.amount <= 0 THEN
      RAISE EXCEPTION 'Each payment amount must be greater than zero.';
    END IF;
    v_pay_sum := v_pay_sum + v_pay.amount;
  END LOOP;

  -- Duplicate-product guard before any insert.
  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice on the bill — adjust the quantity on one line instead.';
  END IF;

  v_summary_mode := CASE
    WHEN v_pay_count = 1 THEN (p_payments->0->>'mode')
    ELSE 'Split'
  END;

  INSERT INTO bills (shop_id, payment_mode, notes, created_by)
  VALUES (p_shop_id, v_summary_mode, p_notes, p_user_id)
  RETURNING bills.id, bills.code INTO v_bill_id, v_code;

  FOR v_line IN
    SELECT (x->>'productId')::uuid AS product_id,
           (x->>'qty')::int        AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be a positive whole number.';
    END IF;

    SELECT p.id, p.name, p.mrp
    INTO v_product
    FROM products p
    WHERE p.id = v_line.product_id
      AND p.is_deleted = false
      AND p.active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found or inactive.', v_line.product_id;
    END IF;

    INSERT INTO bill_items (bill_id, product_id, qty, unit_price)
    VALUES (v_bill_id, v_product.id, v_line.qty, v_product.mrp);

    PERFORM fn_shop_inventory_sale(
      p_shop_id, v_product.id, v_line.qty, v_bill_id,
      'Bill ' || v_code, p_user_id
    );

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty + v_line.qty;
    v_total_amount := v_total_amount + (v_line.qty * v_product.mrp);
  END LOOP;

  -- Tenders must settle the bill exactly (no over/under-tender stored;
  -- the UI computes cash change for display only).
  IF v_pay_sum <> v_total_amount THEN
    RAISE EXCEPTION 'Payments (%) must equal the bill total (%).', v_pay_sum, v_total_amount;
  END IF;

  FOR v_pay IN
    SELECT (x->>'mode')::varchar   AS mode,
           (x->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_payments) x
  LOOP
    INSERT INTO bill_payments (bill_id, mode, amount)
    VALUES (v_bill_id, v_pay.mode, v_pay.amount);
  END LOOP;

  UPDATE bills b
  SET total_items  = v_total_items,
      total_qty    = v_total_qty,
      total_amount = v_total_amount,
      updated_by   = p_user_id
  WHERE b.id = v_bill_id;

  RETURN QUERY
  SELECT b.id, b.code, b.total_items, b.total_qty, b.total_amount
  FROM bills b WHERE b.id = v_bill_id;
END;
$$;


-- ------------------------------------------------------------
-- 5. fn_bill_get_payments — tender breakdown for a bill (detail view).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_get_payments(
  p_bill_id  uuid
)
RETURNS TABLE (
  id      uuid,
  mode    varchar,
  amount  numeric
)
LANGUAGE sql STABLE AS $$
  SELECT bp.id, bp.mode, bp.amount
  FROM   bill_payments bp
  WHERE  bp.bill_id = p_bill_id
  ORDER  BY bp.created_at;
$$;


-- ============================================================
-- VERIFY
--   SELECT tablename FROM pg_tables WHERE tablename = 'bill_payments';
--   SELECT bill_id, mode, amount FROM bill_payments LIMIT 5;
--   SELECT conname FROM pg_constraint WHERE conname = 'chk_bills_payment_mode';
-- ============================================================


-- ############################################################
-- >>> One shot scripts/phase4_bill_cancel_improvements_migration.sql
-- ############################################################

-- ============================================================
-- Kovilpatti Snacks — Phase 4b · CANCEL IMPROVEMENTS · MIGRATION
--
-- Feature #2 from DB/planned/phase4_billing_full_scope.md.
--   • Structured cancel reason: cancel_reason_type (category) alongside
--     the existing cancel_reason (free-text note).
--   • cancelled_by already captured by fn_bill_cancel.
--   • Manager-PIN gate + cancel slip (thermal): intentionally NOT built.
--
-- Idempotent one-shot. Baked into DB/phase4/phase4_billing_init.sql +
-- phase4_billing_procedures.sql for fresh deploys.
--
-- Run AFTER phase4_billing_init.sql + phase4_billing_procedures.sql.
-- ============================================================

BEGIN;

-- 1. Structured reason category on the header.
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS cancel_reason_type varchar(20);

ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bills_cancel_reason_type;
ALTER TABLE bills ADD  CONSTRAINT chk_bills_cancel_reason_type
  CHECK (cancel_reason_type IS NULL
         OR cancel_reason_type IN ('Mistake','Duplicate','CustomerRefused','Other'));

COMMIT;


-- ============================================================
-- PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- 3. fn_bill_cancel — whole-bill reversal with a reason category + note.
--    Drop the older signatures so no stale overload lingers.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_cancel(uuid, uuid, uuid, varchar);
DROP FUNCTION IF EXISTS fn_bill_cancel(uuid, uuid, uuid, varchar, varchar, varchar);

CREATE OR REPLACE FUNCTION fn_bill_cancel(
  p_bill_id      uuid,
  p_shop_id      uuid,
  p_user_id      uuid,
  p_reason_type  varchar,
  p_reason_note  varchar DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_bill        record;
  v_line        record;
BEGIN
  IF p_reason_type NOT IN ('Mistake','Duplicate','CustomerRefused','Other') THEN
    RAISE EXCEPTION 'Please choose a valid cancellation reason.';
  END IF;

  SELECT b.id, b.code, b.status
  INTO v_bill
  FROM bills b
  WHERE b.id = p_bill_id AND b.shop_id = p_shop_id AND b.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;

  IF v_bill.status = 'Cancelled' THEN
    RAISE EXCEPTION 'Bill % is already cancelled.', v_bill.code;
  END IF;

  FOR v_line IN
    SELECT bi.product_id, bi.qty FROM bill_items bi WHERE bi.bill_id = p_bill_id
  LOOP
    PERFORM fn_shop_inventory_refund(
      p_shop_id, v_line.product_id, v_line.qty, p_bill_id,
      'Cancel ' || v_bill.code || ': ' || p_reason_type, p_user_id
    );
  END LOOP;

  UPDATE bills b
  SET status             = 'Cancelled',
      cancelled_at       = now(),
      cancelled_by       = p_user_id,
      cancel_reason_type = p_reason_type,
      cancel_reason      = NULLIF(btrim(p_reason_note), ''),
      updated_by         = p_user_id
  WHERE b.id = p_bill_id;
END;
$$;


-- ------------------------------------------------------------
-- 4. fn_bill_get + fn_bill_list — expose cancel_reason_type.
--    (Full bodies reproduced so the migration is self-contained.)
--    DROP first: adding columns changes the return type, which
--    CREATE OR REPLACE cannot do.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_get(uuid, uuid);
CREATE OR REPLACE FUNCTION fn_bill_get(
  p_bill_id  uuid,
  p_shop_id  uuid
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  status             varchar,
  payment_mode       varchar,
  total_items        int,
  total_qty          int,
  total_amount       numeric,
  notes              varchar,
  created_at         timestamptz,
  created_by_name    varchar,
  cancelled_at       timestamptz,
  cancelled_by_name  varchar,
  cancel_reason_type varchar,
  cancel_reason      varchar
)
LANGUAGE sql STABLE AS $$
  SELECT b.id,
         b.code,
         b.status,
         b.payment_mode,
         b.total_items,
         b.total_qty,
         b.total_amount,
         b.notes,
         b.created_at,
         cu.full_name AS created_by_name,
         b.cancelled_at,
         xu.full_name AS cancelled_by_name,
         b.cancel_reason_type,
         b.cancel_reason
  FROM   bills b
  LEFT   JOIN users cu ON cu.id = b.created_by
  LEFT   JOIN users xu ON xu.id = b.cancelled_by
  WHERE  b.id = p_bill_id
    AND  b.shop_id = p_shop_id
    AND  b.is_deleted = false;
$$;

DROP FUNCTION IF EXISTS fn_bill_list(uuid, varchar, varchar, date, date, int, int);
CREATE OR REPLACE FUNCTION fn_bill_list(
  p_shop_id    uuid,
  p_search     varchar DEFAULT NULL,
  p_status     varchar DEFAULT NULL,
  p_from       date    DEFAULT NULL,
  p_to         date    DEFAULT NULL,
  p_page       int     DEFAULT 1,
  p_page_size  int     DEFAULT 10
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  status             varchar,
  payment_mode       varchar,
  total_items        int,
  total_qty          int,
  total_amount       numeric,
  created_at         timestamptz,
  created_by_name    varchar,
  cancelled_at       timestamptz,
  cancel_reason_type varchar,
  cancel_reason      varchar,
  total_count        bigint
)
LANGUAGE sql STABLE AS $$
  SELECT b.id,
         b.code,
         b.status,
         b.payment_mode,
         b.total_items,
         b.total_qty,
         b.total_amount,
         b.created_at,
         u.full_name AS created_by_name,
         b.cancelled_at,
         b.cancel_reason_type,
         b.cancel_reason,
         COUNT(*) OVER() AS total_count
  FROM   bills b
  LEFT   JOIN users u ON u.id = b.created_by
  WHERE  b.shop_id = p_shop_id
    AND  b.is_deleted = false
    AND  (p_status IS NULL OR p_status = '' OR b.status = p_status)
    AND  (p_search IS NULL OR p_search = '' OR b.code ILIKE '%' || p_search || '%')
    AND  (p_from IS NULL OR (b.created_at AT TIME ZONE 'Asia/Kolkata')::date >= p_from)
    AND  (p_to   IS NULL OR (b.created_at AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
  ORDER  BY b.created_at DESC
  LIMIT  p_page_size
  OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;


-- ============================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='bills' AND column_name='cancel_reason_type';
-- ============================================================


-- ############################################################
-- >>> One shot scripts/phase4_customers_credit_migration.sql
-- ############################################################

-- ============================================================
-- Kovilpatti Snacks — Phase 4b · CUSTOMERS + CREDIT · MIGRATION
--
-- Features #6 (customer identification) + #4 (credit sales) from
-- DB/planned/phase4_billing_full_scope.md. Client term is "credit"
-- (not "udhaar").
--
--   • customers            — per-shop, phone-identified, cached credit_balance
--   • customer_credit_ledger — one row per credit taken / settlement paid
--   • bills.customer_id    — optional customer on a bill (walk-in = NULL)
--   • 'Credit' becomes a valid tender (bill_payments.mode) and header
--     summary (bills.payment_mode)
--   • fn_bill_create now takes p_customer_id; a Credit tender adds to the
--     customer's balance (capped at credit_limit) and writes a ledger row
--   • fn_customer_credit_settle records a repayment (Cash/UPI)
--
-- Credit limit default is an app_settings value (customer_credit_limit_default)
-- — set to 5000 here; adjust per client.
--
-- Idempotent one-shot. Baked into DB/phase4 canonical files for fresh
-- deploys. Run AFTER phase4_billing_init.sql + phase4_billing_procedures.sql
-- and the split-payment migration.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. customers — per-shop. Phone is unique per shop (partial index so
--    soft-deleted rows free the number).
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS customer_code_seq START 1;

CREATE TABLE IF NOT EXISTS customers (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(20)   NOT NULL DEFAULT 'CUST' || lpad(nextval('customer_code_seq')::text, 4, '0'),
  shop_id        uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  name           varchar(120)  NOT NULL,
  phone          varchar(20)   NOT NULL,
  credit_limit   numeric(12,2) NOT NULL DEFAULT 0,   -- 0 = no limit
  credit_balance numeric(12,2) NOT NULL DEFAULT 0,   -- cached; ledger is source of truth
  is_deleted     boolean       NOT NULL DEFAULT false,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_customers_code UNIQUE (code),
  CONSTRAINT chk_customers_credit_nonneg CHECK (credit_limit >= 0 AND credit_balance >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_shop_phone_active
  ON customers(shop_id, phone) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_customers_shop ON customers(shop_id) WHERE is_deleted = false;

DROP TRIGGER IF EXISTS trg_customers_updated ON customers;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 2. customer_credit_ledger — every credit taken and every settlement.
--    entry_type 'Credit' (balance up) or 'Settlement' (balance down).
--    mode is the repayment tender for settlements; NULL for credit.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_credit_ledger (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid          NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  bill_id       uuid          NULL REFERENCES bills(id) ON DELETE SET NULL,
  entry_type    varchar(12)   NOT NULL,
  amount        numeric(12,2) NOT NULL,
  mode          varchar(10)   NULL,
  note          varchar(500)  NULL,
  balance_after numeric(12,2) NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ccl_entry_type CHECK (entry_type IN ('Credit','Settlement')),
  CONSTRAINT chk_ccl_amount_pos CHECK (amount > 0),
  CONSTRAINT chk_ccl_mode       CHECK (mode IS NULL OR mode IN ('Cash','UPI'))
);

CREATE INDEX IF NOT EXISTS idx_ccl_customer ON customer_credit_ledger(customer_id, created_at DESC);


-- ------------------------------------------------------------
-- 3. bills.customer_id + widen tender/summary CHECKs for 'Credit'.
-- ------------------------------------------------------------
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS customer_id uuid NULL REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bills_customer ON bills(customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bills_payment_mode;
ALTER TABLE bills ADD  CONSTRAINT chk_bills_payment_mode
  CHECK (payment_mode IN ('Cash','UPI','Split','Credit'));

ALTER TABLE bill_payments DROP CONSTRAINT IF EXISTS chk_bill_payments_mode;
ALTER TABLE bill_payments ADD  CONSTRAINT chk_bill_payments_mode
  CHECK (mode IN ('Cash','UPI','Credit'));

-- 4. Default credit limit setting.
INSERT INTO app_settings (key, value, description) VALUES
  ('customer_credit_limit_default', '5000',
   'Default per-customer credit limit (₹) applied to new customers. 0 = no limit.')
ON CONFLICT (key) DO NOTHING;

COMMIT;


-- ============================================================
-- PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- 5. fn_customer_lookup — exact phone match for the POS header.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_lookup(
  p_shop_id  uuid,
  p_phone    varchar
)
RETURNS TABLE (
  id uuid, code varchar, name varchar, phone varchar,
  credit_limit numeric, credit_balance numeric
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.code, c.name, c.phone, c.credit_limit, c.credit_balance
  FROM   customers c
  WHERE  c.shop_id = p_shop_id AND c.is_deleted = false
    AND  c.phone = btrim(p_phone);
$$;

-- ------------------------------------------------------------
-- 6. fn_customer_create — quick-add. credit_limit NULL ⇒ default setting.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_create(
  p_shop_id       uuid,
  p_user_id       uuid,
  p_name          varchar,
  p_phone         varchar,
  p_credit_limit  numeric DEFAULT NULL
)
RETURNS TABLE (
  id uuid, code varchar, name varchar, phone varchar,
  credit_limit numeric, credit_balance numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_id     uuid;
  v_limit  numeric(12,2);
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required.';
  END IF;
  IF p_phone IS NULL OR btrim(p_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required.';
  END IF;

  IF EXISTS (SELECT 1 FROM customers c
             WHERE c.shop_id = p_shop_id AND c.is_deleted = false AND c.phone = btrim(p_phone)) THEN
    RAISE EXCEPTION 'A customer with this phone already exists.';
  END IF;

  v_limit := COALESCE(
    p_credit_limit,
    (SELECT COALESCE(NULLIF(value, '')::numeric, 0) FROM app_settings WHERE key = 'customer_credit_limit_default'),
    0);

  INSERT INTO customers (shop_id, name, phone, credit_limit, created_by)
  VALUES (p_shop_id, btrim(p_name), btrim(p_phone), v_limit, p_user_id)
  RETURNING customers.id INTO v_id;

  RETURN QUERY
  SELECT c.id, c.code, c.name, c.phone, c.credit_limit, c.credit_balance
  FROM customers c WHERE c.id = v_id;
END;
$$;

-- ------------------------------------------------------------
-- 7. fn_customer_list — shop-scoped, newest first, optional search on
--    name/phone/code. Window count for pagination.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_list(
  p_shop_id    uuid,
  p_search     varchar DEFAULT NULL,
  p_page       int     DEFAULT 1,
  p_page_size  int     DEFAULT 20
)
RETURNS TABLE (
  id uuid, code varchar, name varchar, phone varchar,
  credit_limit numeric, credit_balance numeric,
  created_at timestamptz, total_count bigint
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.code, c.name, c.phone, c.credit_limit, c.credit_balance,
         c.created_at, COUNT(*) OVER() AS total_count
  FROM   customers c
  WHERE  c.shop_id = p_shop_id AND c.is_deleted = false
    AND  (p_search IS NULL OR p_search = ''
          OR c.name  ILIKE '%' || p_search || '%'
          OR c.phone ILIKE '%' || p_search || '%'
          OR c.code  ILIKE '%' || p_search || '%')
  ORDER  BY c.created_at DESC
  LIMIT  p_page_size
  OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;

-- ------------------------------------------------------------
-- 8. fn_customer_credit_settle — record a repayment against balance.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_credit_settle(
  p_customer_id  uuid,
  p_shop_id      uuid,
  p_user_id      uuid,
  p_amount       numeric,
  p_mode         varchar,
  p_note         varchar DEFAULT NULL
)
RETURNS numeric      -- new balance
LANGUAGE plpgsql AS $$
DECLARE
  v_balance  numeric(12,2);
  v_new      numeric(12,2);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Settlement amount must be greater than zero.';
  END IF;
  IF p_mode NOT IN ('Cash','UPI') THEN
    RAISE EXCEPTION 'Settlement must be Cash or UPI.';
  END IF;

  SELECT c.credit_balance INTO v_balance
  FROM customers c
  WHERE c.id = p_customer_id AND c.shop_id = p_shop_id AND c.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;

  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Settlement (%) exceeds the outstanding balance (%).', p_amount, v_balance;
  END IF;

  v_new := v_balance - p_amount;

  UPDATE customers SET credit_balance = v_new, updated_by = p_user_id
  WHERE id = p_customer_id;

  INSERT INTO customer_credit_ledger (customer_id, entry_type, amount, mode, note, balance_after, created_by)
  VALUES (p_customer_id, 'Settlement', p_amount, p_mode, NULLIF(btrim(p_note), ''), v_new, p_user_id);

  RETURN v_new;
END;
$$;

-- ------------------------------------------------------------
-- 9. fn_customer_credit_ledger_list — statement for one customer.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_credit_ledger_list(
  p_customer_id  uuid,
  p_shop_id      uuid,
  p_page         int DEFAULT 1,
  p_page_size    int DEFAULT 20
)
RETURNS TABLE (
  id uuid, entry_type varchar, amount numeric, mode varchar,
  note varchar, balance_after numeric, bill_code varchar,
  created_at timestamptz, created_by_name varchar, total_count bigint
)
LANGUAGE sql STABLE AS $$
  SELECT l.id, l.entry_type, l.amount, l.mode, l.note, l.balance_after,
         b.code AS bill_code, l.created_at, u.full_name AS created_by_name,
         COUNT(*) OVER() AS total_count
  FROM   customer_credit_ledger l
  JOIN   customers c ON c.id = l.customer_id AND c.shop_id = p_shop_id
  LEFT   JOIN bills b ON b.id = l.bill_id
  LEFT   JOIN users u ON u.id = l.created_by
  WHERE  l.customer_id = p_customer_id
  ORDER  BY l.created_at DESC
  LIMIT  p_page_size
  OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;

-- ------------------------------------------------------------
-- 10. fn_bill_create — now takes p_customer_id and accepts a 'Credit'
--     tender. A Credit tender adds to the customer's balance (capped at
--     credit_limit) and writes a ledger row.
--
--     Drop the split-payment signature (no customer arg) so only the
--     customer-aware overload remains.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_create(uuid, uuid, jsonb, jsonb, varchar);

CREATE OR REPLACE FUNCTION fn_bill_create(
  p_shop_id       uuid,
  p_user_id       uuid,
  p_customer_id   uuid,
  p_payments      jsonb,
  p_items         jsonb,
  p_notes         varchar DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  code         varchar,
  total_items  int,
  total_qty    int,
  total_amount numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_bill_id       uuid;
  v_code          varchar(20);
  v_line          record;
  v_pay           record;
  v_product       record;
  v_total_items   int := 0;
  v_total_qty     int := 0;
  v_total_amount  numeric(12,2) := 0;
  v_pay_count     int;
  v_pay_sum       numeric(12,2) := 0;
  v_credit_sum    numeric(12,2) := 0;
  v_summary_mode  varchar(10);
  v_cust          record;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item.';
  END IF;
  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'Bill must have at least one payment.';
  END IF;

  v_pay_count := jsonb_array_length(p_payments);

  FOR v_pay IN
    SELECT (x->>'mode')::varchar AS mode, (x->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_payments) x
  LOOP
    IF v_pay.mode NOT IN ('Cash','UPI','Credit') THEN
      RAISE EXCEPTION 'Invalid payment mode "%".', v_pay.mode;
    END IF;
    IF v_pay.amount IS NULL OR v_pay.amount <= 0 THEN
      RAISE EXCEPTION 'Each payment amount must be greater than zero.';
    END IF;
    v_pay_sum := v_pay_sum + v_pay.amount;
    IF v_pay.mode = 'Credit' THEN
      v_credit_sum := v_credit_sum + v_pay.amount;
    END IF;
  END LOOP;

  -- A credit tender needs a customer with enough remaining limit.
  IF v_credit_sum > 0 THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'A customer is required for a credit sale.';
    END IF;
    SELECT c.id, c.credit_limit, c.credit_balance INTO v_cust
    FROM customers c
    WHERE c.id = p_customer_id AND c.shop_id = p_shop_id AND c.is_deleted = false
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer not found.';
    END IF;
    IF v_cust.credit_limit > 0 AND (v_cust.credit_balance + v_credit_sum) > v_cust.credit_limit THEN
      RAISE EXCEPTION 'Credit limit exceeded: balance % + % is over the limit of %.',
        v_cust.credit_balance, v_credit_sum, v_cust.credit_limit;
    END IF;
  END IF;

  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice on the bill — adjust the quantity on one line instead.';
  END IF;

  v_summary_mode := CASE WHEN v_pay_count = 1 THEN (p_payments->0->>'mode') ELSE 'Split' END;

  INSERT INTO bills (shop_id, customer_id, payment_mode, notes, created_by)
  VALUES (p_shop_id, p_customer_id, v_summary_mode, p_notes, p_user_id)
  RETURNING bills.id, bills.code INTO v_bill_id, v_code;

  FOR v_line IN
    SELECT (x->>'productId')::uuid AS product_id, (x->>'qty')::int AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be a positive whole number.';
    END IF;

    SELECT p.id, p.name, p.mrp INTO v_product
    FROM products p
    WHERE p.id = v_line.product_id AND p.is_deleted = false AND p.active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found or inactive.', v_line.product_id;
    END IF;

    INSERT INTO bill_items (bill_id, product_id, qty, unit_price)
    VALUES (v_bill_id, v_product.id, v_line.qty, v_product.mrp);

    PERFORM fn_shop_inventory_sale(
      p_shop_id, v_product.id, v_line.qty, v_bill_id, 'Bill ' || v_code, p_user_id);

    v_total_items  := v_total_items + 1;
    v_total_qty    := v_total_qty + v_line.qty;
    v_total_amount := v_total_amount + (v_line.qty * v_product.mrp);
  END LOOP;

  IF v_pay_sum <> v_total_amount THEN
    RAISE EXCEPTION 'Payments (%) must equal the bill total (%).', v_pay_sum, v_total_amount;
  END IF;

  FOR v_pay IN
    SELECT (x->>'mode')::varchar AS mode, (x->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_payments) x
  LOOP
    INSERT INTO bill_payments (bill_id, mode, amount)
    VALUES (v_bill_id, v_pay.mode, v_pay.amount);
  END LOOP;

  -- Post the credit to the customer's balance + ledger.
  IF v_credit_sum > 0 THEN
    UPDATE customers SET credit_balance = credit_balance + v_credit_sum, updated_by = p_user_id
    WHERE id = p_customer_id;

    INSERT INTO customer_credit_ledger (customer_id, bill_id, entry_type, amount, balance_after, created_by)
    VALUES (p_customer_id, v_bill_id, 'Credit', v_credit_sum,
            (SELECT credit_balance FROM customers WHERE id = p_customer_id), p_user_id);
  END IF;

  UPDATE bills b
  SET total_items = v_total_items, total_qty = v_total_qty,
      total_amount = v_total_amount, updated_by = p_user_id
  WHERE b.id = v_bill_id;

  RETURN QUERY
  SELECT b.id, b.code, b.total_items, b.total_qty, b.total_amount
  FROM bills b WHERE b.id = v_bill_id;
END;
$$;


-- ------------------------------------------------------------
-- 11. fn_bill_get — surface the attached customer on bill detail.
--     DROP first: return type changes (new customer columns).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_get(uuid, uuid);
CREATE OR REPLACE FUNCTION fn_bill_get(
  p_bill_id  uuid,
  p_shop_id  uuid
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  status             varchar,
  payment_mode       varchar,
  total_items        int,
  total_qty          int,
  total_amount       numeric,
  notes              varchar,
  created_at         timestamptz,
  created_by_name    varchar,
  cancelled_at       timestamptz,
  cancelled_by_name  varchar,
  cancel_reason_type varchar,
  cancel_reason      varchar,
  customer_id        uuid,
  customer_name      varchar,
  customer_phone     varchar
)
LANGUAGE sql STABLE AS $$
  SELECT b.id, b.code, b.status, b.payment_mode, b.total_items, b.total_qty,
         b.total_amount, b.notes, b.created_at, cu.full_name AS created_by_name,
         b.cancelled_at, xu.full_name AS cancelled_by_name,
         b.cancel_reason_type, b.cancel_reason,
         b.customer_id, cust.name AS customer_name, cust.phone AS customer_phone
  FROM   bills b
  LEFT   JOIN users cu ON cu.id = b.created_by
  LEFT   JOIN users xu ON xu.id = b.cancelled_by
  LEFT   JOIN customers cust ON cust.id = b.customer_id
  WHERE  b.id = p_bill_id AND b.shop_id = p_shop_id AND b.is_deleted = false;
$$;


-- ============================================================
-- VERIFY
--   SELECT tablename FROM pg_tables WHERE tablename IN ('customers','customer_credit_ledger');
--   SELECT key,value FROM app_settings WHERE key='customer_credit_limit_default';
-- ============================================================


-- ############################################################
-- >>> One shot scripts/phase4_bill_holds_migration.sql
-- ############################################################

-- ============================================================
-- Kovilpatti Snacks — Phase 4c · HELD (DRAFT) BILLS · MIGRATION
--
-- Feature #3 (Suspend/Hold). A cashier parks a bill mid-transaction,
-- serves another customer, and resumes later. A held bill is a
-- lightweight DRAFT — it does NOT consume stock and burns no bill code.
-- On resume the FE rebuilds the cart from CURRENT product data (fresh
-- MRP + on-hand) and the draft is deleted; finalising then goes through
-- the normal fn_bill_create (which is what consumes stock).
--
-- Kept separate from `bills` so the issued-bill table stays clean
-- (bills = real sales only; no half-finished rows, no stock/payment
-- semantics to bend).
--
-- Idempotent one-shot. Baked into DB/phase4 canonical files for fresh
-- deploys. Run AFTER phase4_billing_init.sql + phase4_customers_credit_migration.sql
-- (references customers).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS held_bills (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  customer_id  uuid          NULL REFERENCES customers(id) ON DELETE SET NULL,
  label        varchar(120)  NULL,   -- optional cashier note ("blue shirt uncle")
  note         varchar(500)  NULL,
  total_qty    int           NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  created_by   uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  updated_by   uuid          REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_held_bills_shop ON held_bills(shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS held_bill_items (
  id            uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  held_bill_id  uuid  NOT NULL REFERENCES held_bills(id) ON DELETE CASCADE,
  product_id    uuid  NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty           int   NOT NULL,
  CONSTRAINT uq_held_bill_items_bill_product UNIQUE (held_bill_id, product_id),
  CONSTRAINT chk_held_bill_items_qty_pos CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_held_bill_items_bill ON held_bill_items(held_bill_id);

DROP TRIGGER IF EXISTS trg_held_bills_updated ON held_bills;
CREATE TRIGGER trg_held_bills_updated BEFORE UPDATE ON held_bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;


-- ============================================================
-- PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- fn_bill_hold_create — park a draft. No stock touched. Totals cached
-- from CURRENT MRP for the drawer display. p_items jsonb array of
-- {"productId": uuid, "qty": int}.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_hold_create(
  p_shop_id      uuid,
  p_user_id      uuid,
  p_customer_id  uuid,
  p_label        varchar,
  p_note         varchar,
  p_items        jsonb
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id   uuid;
  v_line record;
  v_qty  int := 0;
  v_amt  numeric(12,2) := 0;
  v_mrp  numeric(10,2);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nothing to hold — the bill is empty.';
  END IF;

  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice — adjust the quantity on one line instead.';
  END IF;

  INSERT INTO held_bills (shop_id, customer_id, label, note, created_by)
  VALUES (p_shop_id, p_customer_id, NULLIF(btrim(p_label), ''), NULLIF(btrim(p_note), ''), p_user_id)
  RETURNING id INTO v_id;

  FOR v_line IN
    SELECT (x->>'productId')::uuid AS product_id, (x->>'qty')::int AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be a positive whole number.';
    END IF;
    SELECT p.mrp INTO v_mrp FROM products p
    WHERE p.id = v_line.product_id AND p.is_deleted = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found.', v_line.product_id;
    END IF;

    INSERT INTO held_bill_items (held_bill_id, product_id, qty)
    VALUES (v_id, v_line.product_id, v_line.qty);

    v_qty := v_qty + v_line.qty;
    v_amt := v_amt + (v_line.qty * COALESCE(v_mrp, 0));
  END LOOP;

  UPDATE held_bills SET total_qty = v_qty, total_amount = v_amt WHERE id = v_id;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- fn_bill_hold_list — drafts for a shop, newest first.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_hold_list(
  p_shop_id  uuid
)
RETURNS TABLE (
  id uuid, label varchar, note varchar, customer_name varchar,
  item_count int, total_qty int, total_amount numeric, created_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT h.id, h.label, h.note, c.name AS customer_name,
         (SELECT COUNT(*)::int FROM held_bill_items hi WHERE hi.held_bill_id = h.id) AS item_count,
         h.total_qty, h.total_amount, h.created_at
  FROM   held_bills h
  LEFT   JOIN customers c ON c.id = h.customer_id
  WHERE  h.shop_id = p_shop_id
  ORDER  BY h.created_at DESC;
$$;

-- ------------------------------------------------------------
-- fn_bill_hold_get — draft header (customer + label to restore).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_hold_get(
  p_held_bill_id  uuid,
  p_shop_id       uuid
)
RETURNS TABLE (
  id uuid, customer_id uuid, label varchar, note varchar
)
LANGUAGE sql STABLE AS $$
  SELECT h.id, h.customer_id, h.label, h.note
  FROM   held_bills h
  WHERE  h.id = p_held_bill_id AND h.shop_id = p_shop_id;
$$;

-- ------------------------------------------------------------
-- fn_bill_hold_get_items — items with CURRENT product data so the FE
-- can rebuild cart lines directly (fresh MRP + this shop's on-hand).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_hold_get_items(
  p_held_bill_id  uuid,
  p_shop_id       uuid
)
RETURNS TABLE (
  id uuid, code text, barcode varchar, name varchar,
  weight_value numeric, weight_unit varchar, mrp numeric, on_hand numeric, qty int
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.barcode, p.name, p.weight_value, p.weight_unit, p.mrp,
         COALESCE(si.on_hand, 0) AS on_hand, hi.qty
  FROM   held_bill_items hi
  JOIN   held_bills h ON h.id = hi.held_bill_id AND h.shop_id = p_shop_id
  JOIN   products p   ON p.id = hi.product_id
  LEFT   JOIN shop_inventory si ON si.product_id = p.id AND si.shop_id = p_shop_id
  WHERE  hi.held_bill_id = p_held_bill_id
  ORDER  BY p.name;
$$;

-- ------------------------------------------------------------
-- fn_bill_hold_delete — discard a draft (also used after resume).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_hold_delete(
  p_held_bill_id  uuid,
  p_shop_id       uuid
)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM held_bills WHERE id = p_held_bill_id AND shop_id = p_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Held bill not found.';
  END IF;
END;
$$;


-- ============================================================
-- VERIFY
--   SELECT tablename FROM pg_tables WHERE tablename IN ('held_bills','held_bill_items');
-- ============================================================


-- ############################################################
-- >>> One shot scripts/phase4_billing_products_category.sql
-- ############################################################

-- ============================================================
-- Kovilpatti Snacks — Phase 4c · fn_billing_products + category_name
--
-- Adds the product's (leaf) category name to the POS product source so
-- the billing "Browse products" overlay can group tiles by category.
-- Return type changes, so DROP first (CREATE OR REPLACE can't do it).
--
-- Idempotent. Baked into DB/phase4/phase4_billing_procedures.sql too.
-- ============================================================

DROP FUNCTION IF EXISTS fn_billing_products(uuid, varchar, int);

CREATE OR REPLACE FUNCTION fn_billing_products(
  p_shop_id  uuid,
  p_search   varchar DEFAULT NULL,
  p_limit    int     DEFAULT 500
)
RETURNS TABLE (
  id            uuid,
  code          text,
  barcode       varchar,
  name          varchar,
  category_name varchar,
  weight_value  numeric,
  weight_unit   varchar,
  mrp           numeric,
  on_hand       numeric
)
LANGUAGE sql STABLE AS $$
  SELECT p.id,
         p.code,
         p.barcode,
         p.name,
         c.name AS category_name,
         p.weight_value,
         p.weight_unit,
         p.mrp,
         COALESCE(si.on_hand, 0) AS on_hand
  FROM   products p
  LEFT   JOIN categories c ON c.id = p.category_id
  LEFT   JOIN shop_inventory si
         ON si.product_id = p.id AND si.shop_id = p_shop_id
  WHERE  p.is_deleted = false
    AND  p.active = true
    AND  (p_search IS NULL OR p_search = ''
          OR p.name    ILIKE '%' || p_search || '%'
          OR p.code    ILIKE '%' || p_search || '%'
          OR p.barcode ILIKE '%' || p_search || '%')
  ORDER  BY (COALESCE(si.on_hand, 0) > 0) DESC, p.name
  LIMIT  p_limit;
$$;

