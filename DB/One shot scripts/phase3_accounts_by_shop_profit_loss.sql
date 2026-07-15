-- =====================================================================
-- phase3_accounts_by_shop_profit_loss.sql
-- =====================================================================
-- Addendum: adds purchase_amount + profit + loss columns to the by-shop
-- accounts SP. Client #12 (17-Jun-2026): the by-shop Excel export needs
-- cost-side metrics next to Net Amount.
--
-- Profit / Loss are mutually exclusive (Indian P&L pair convention):
-- exactly one is non-zero per row, the other is 0.
-- Purchase amount uses current products.purchase_price (no snapshot —
-- editing a product later will shift prior reports retroactively, which
-- is the accepted trade-off per client #12).
--
-- Idempotent: drops the old signature first (return-type change),
-- then CREATE OR REPLACE the new one. Safe to re-run.
--
-- RUN ORDER: after phase3_init.sql + phase3_procedures.sql. Safe on a
-- fresh install since baseline phase3_procedures.sql already has the
-- merged version — this file is purely an upgrade convenience for
-- environments stuck on the prior signature.
-- =====================================================================

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
    HAVING count(*) > 0
  ),
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
  order_sums AS (
    SELECT o.shop_id,
           SUM(it.requested_qty)::bigint                                                      AS requested_qty,
           SUM(COALESCE(it.dispatched_qty, it.requested_qty))::bigint                         AS dispatched_qty,
           SUM(it.requested_qty * it.unit_price)                                              AS requested_amount,
           SUM(COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price)                 AS dispatched_amount,
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
  return_sums AS (
    SELECT rr.shop_id,
           SUM(COALESCE(it.dispatched_qty, it.requested_qty))::bigint                         AS returned_qty,
           SUM(COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price)                 AS returns_amount,
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
    (
      COALESCE((SELECT os.dispatched_cost FROM order_sums  os WHERE os.shop_id = s.id), 0)
    - COALESCE((SELECT rs.returns_cost    FROM return_sums rs WHERE rs.shop_id = s.id), 0)
    )::numeric(14,2) AS purchase_amount,
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
      OR EXISTS (SELECT 1 FROM shop_adjustments sa WHERE sa.shop_id = s.id)
    )
  ORDER BY s.name, s.code;
$$;
