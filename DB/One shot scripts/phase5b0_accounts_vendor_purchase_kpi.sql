-- ============================================================
-- Phase 5b.0 — Accounts: vendor_purchase_amount KPI (upgrade-only)
-- ------------------------------------------------------------
-- Adds two columns (vendor_purchase_amount, vendor_purchase_count) to the
-- RETURNS TABLE of fn_accounts_summary so the Accounts dashboard can show
-- "Vendor Purchases" (= Σ vendor_purchases.invoice_amount over rows marked
-- Received in the range) as an additive KPI alongside the existing
-- "Purchased (at Cost)" (which stays as-is — COGS proxy via stock_request
-- cost snapshots).
--
-- Baseline (rebuild-from-scratch) lives in DB/phase3/phase3_procedures.sql.
-- This one-shot exists purely to bring a live DB up to that baseline
-- without needing to re-run all of phase3.
--
-- Author: Ramji J G   —   2026-07-31
-- ============================================================

BEGIN;

-- Depends on Phase 5a: vendor_purchases must exist. Fail fast if not.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vendor_purchases'
  ) THEN
    RAISE EXCEPTION
      'phase5b0_accounts_vendor_purchase_kpi requires vendor_purchases (Phase 5a). Run phase5/phase5_init.sql first.';
  END IF;
END$$;

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
  purchase_amount          numeric,
  vendor_purchase_amount   numeric,
  vendor_purchase_count    bigint
)
LANGUAGE sql STABLE AS $$
  WITH
  range AS (
    SELECT (p_from::timestamp        AT TIME ZONE 'Asia/Kolkata') AS lo,
           ((p_to + 1)::timestamp    AT TIME ZONE 'Asia/Kolkata') AS hi
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
    HAVING count(*) > 0
  ),
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
  item_sums AS (
    SELECT
      COALESCE(SUM(CASE WHEN f.request_type = 'Order'
                        THEN it.requested_qty * it.unit_price END), 0)                            AS requested_amount,
      COALESCE(SUM(CASE WHEN f.request_type = 'Order'
                        THEN fn_order_effective_qty(it.received_qty, it.received_weight_g, it.dispatched_qty, it.dispatched_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price END), 0) AS dispatched_amount,
      COALESCE(SUM(CASE WHEN f.request_type = 'Return'
                        THEN fn_return_effective_qty(it.dispatched_qty, it.return_weight_g, it.requested_qty, it.weight_value, it.weight_unit) * it.unit_price END), 0) AS returns_amount,
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
    (SELECT s.dispatched_amount - s.returns_amount FROM item_sums s)::numeric(14,2)                          AS net_amount,
    COALESCE(COUNT(DISTINCT f.shop_id), 0)::bigint                                                           AS active_shop_count,
    (SELECT COALESCE(SUM(delta_amount), 0)::numeric(14,2) FROM adjustments)                                  AS adjustments_amount,
    (SELECT COALESCE(COUNT(*), 0)::bigint                FROM adjustments)                                   AS adjustments_count,
    (SELECT s.dispatched_cost - s.returns_cost FROM item_sums s)::numeric(14,2)                              AS purchase_amount,
    (SELECT COALESCE(SUM(vp.invoice_amount), 0)::numeric(14,2)
       FROM vendor_purchases vp, range g
      WHERE vp.is_deleted = false
        AND vp.status     = 'Received'
        AND vp.received_at IS NOT NULL
        AND vp.received_at >= g.lo AND vp.received_at < g.hi
        AND (p_inv_ids IS NULL OR cardinality(p_inv_ids) = 0 OR vp.godown_id = ANY(p_inv_ids)))                AS vendor_purchase_amount,
    (SELECT COALESCE(COUNT(*), 0)::bigint
       FROM vendor_purchases vp, range g
      WHERE vp.is_deleted = false
        AND vp.status     = 'Received'
        AND vp.received_at IS NOT NULL
        AND vp.received_at >= g.lo AND vp.received_at < g.hi
        AND (p_inv_ids IS NULL OR cardinality(p_inv_ids) = 0 OR vp.godown_id = ANY(p_inv_ids)))                AS vendor_purchase_count
  FROM finalised f;
$$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- SELECT * FROM fn_accounts_summary('2026-01-01', '2026-12-31');
-- Should return one row with the two new columns present.
-- ============================================================
