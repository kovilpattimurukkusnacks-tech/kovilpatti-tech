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
  adjustments_count        bigint
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
      COALESCE(SUM(CASE WHEN f.request_type = 'Order'
                        THEN COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price END), 0) AS dispatched_amount,
      COALESCE(SUM(CASE WHEN f.request_type = 'Return'
                        THEN COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price END), 0) AS returns_amount
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
    (SELECT COALESCE(COUNT(*), 0)::bigint                FROM adjustments)                                   AS adjustments_count
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
  net_amount         numeric
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
           ))::date AS bucket_start
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
    )::numeric(14,2) AS net_amount
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
           SUM(it.requested_qty)::bigint                                                      AS requested_qty,
           SUM(COALESCE(it.dispatched_qty, it.requested_qty))::bigint                         AS dispatched_qty,
           SUM(it.requested_qty * it.unit_price)                                              AS requested_amount,
           SUM(COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price)                 AS dispatched_amount,
           -- Cost side of dispatched goods at current products.purchase_price.
           -- COALESCE handles products with no purchase_price set yet (treat
           -- as 0 cost so the row still totals). Documented limitation: this
           -- value can shift retroactively if the admin later edits a
           -- product's purchase_price — acceptable for now per client #12.
           SUM(COALESCE(it.dispatched_qty, it.requested_qty) * COALESCE(p.purchase_price, 0)) AS dispatched_cost
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
           SUM(COALESCE(it.dispatched_qty, it.requested_qty))::bigint                         AS returned_qty,
           SUM(COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price)                 AS returns_amount,
           -- Cost recovered when stock comes back via a Return — subtracted
           -- from dispatched_cost in the final SELECT to get net cost.
           SUM(COALESCE(it.dispatched_qty, it.requested_qty) * COALESCE(p.purchase_price, 0)) AS returns_cost
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
      -- Signed aggregates (existing behaviour — kept for the Net columns).
      CASE WHEN r.request_type = 'Order'
           THEN COALESCE(it.dispatched_qty, it.requested_qty)
           ELSE -COALESCE(it.dispatched_qty, it.requested_qty)
      END                                                                                     AS signed_qty,
      CASE WHEN r.request_type = 'Order'
           THEN COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price
           ELSE -COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price
      END                                                                                     AS signed_amount,
      CASE WHEN r.request_type = 'Order'
           THEN COALESCE(it.dispatched_qty, it.requested_qty) * COALESCE(p.purchase_price, 0)
           ELSE -COALESCE(it.dispatched_qty, it.requested_qty) * COALESCE(p.purchase_price, 0)
      END                                                                                     AS signed_cost,
      -- Per-dimension positive aggregates (added 19-Jun-2026, client #13).
      CASE WHEN r.request_type = 'Order'  THEN it.requested_qty ELSE 0 END                    AS req_qty,
      CASE WHEN r.request_type = 'Order'  THEN COALESCE(it.dispatched_qty, it.requested_qty) ELSE 0 END AS disp_qty,
      CASE WHEN r.request_type = 'Return' THEN COALESCE(it.dispatched_qty, it.requested_qty) ELSE 0 END AS ret_qty,
      CASE WHEN r.request_type = 'Order'  THEN it.requested_qty * it.unit_price ELSE 0 END    AS req_amt,
      CASE WHEN r.request_type = 'Order'  THEN COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price ELSE 0 END AS disp_amt,
      CASE WHEN r.request_type = 'Return' THEN COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price ELSE 0 END AS ret_amt
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
      CASE WHEN r.request_type = 'Order'
           THEN COALESCE(it.dispatched_qty, it.requested_qty)
           ELSE -COALESCE(it.dispatched_qty, it.requested_qty)
      END AS signed_qty,
      CASE WHEN r.request_type = 'Order'
           THEN COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price
           ELSE -COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price
      END AS signed_amount,
      -- Per-dimension positive aggregates (added 19-Jun-2026, client #13).
      CASE WHEN r.request_type = 'Order'  THEN it.requested_qty ELSE 0 END                    AS req_qty,
      CASE WHEN r.request_type = 'Order'  THEN COALESCE(it.dispatched_qty, it.requested_qty) ELSE 0 END AS disp_qty,
      CASE WHEN r.request_type = 'Return' THEN COALESCE(it.dispatched_qty, it.requested_qty) ELSE 0 END AS ret_qty,
      CASE WHEN r.request_type = 'Order'  THEN it.requested_qty * it.unit_price ELSE 0 END    AS req_amt,
      CASE WHEN r.request_type = 'Order'  THEN COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price ELSE 0 END AS disp_amt,
      CASE WHEN r.request_type = 'Return' THEN COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price ELSE 0 END AS ret_amt
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
DROP FUNCTION IF EXISTS fn_accounts_in_transit(uuid[], uuid[]);

CREATE OR REPLACE FUNCTION fn_accounts_in_transit(
  p_shop_ids    uuid[]  DEFAULT NULL,
  p_inv_ids     uuid[]  DEFAULT NULL
)
RETURNS TABLE (
  request_count        bigint,
  total_amount         numeric,
  oldest_dispatched_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::bigint                              AS request_count,
    COALESCE(SUM(r.total_amount), 0)::numeric(14,2) AS total_amount,
    MIN(r.dispatched_at)                          AS oldest_dispatched_at
  FROM stock_requests r
  WHERE r.is_deleted   = false
    AND r.request_type = 'Order'
    AND r.status       = 'Dispatched'
    AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
    AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids));
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
-- ============================================================
