-- =====================================================================
-- phase3_accounts_top_products_per_dim.sql
-- =====================================================================
-- Addendum: adds per-dimension positive aggregates to fn_accounts_top_products
-- so the FE Accounts dashboard's view-mode (Requested / Dispatched / Returns)
-- can re-sort the same data client-side. Client #13 (19-Jun-2026).
--
-- Adds 6 columns:
--   requested_qty, dispatched_qty, returns_qty,
--   requested_amount, dispatched_amount, returns_amount
--
-- Existing fields (quantity / amount) preserved — additive change. The
-- BE ORDER BY stays on the Net amount; FE re-sorts when a non-'All' view
-- is active, saving a roundtrip.
--
-- RUN ORDER: after phase3_init.sql + phase3_procedures.sql.
-- Idempotent: drops the old signature first, then CREATE OR REPLACE.
-- =====================================================================

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
  quantity      bigint,
  amount        numeric,
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
    HAVING count(*) > 0
  ),
  contrib AS (
    SELECT
      p.id            AS product_id,
      p.code          AS product_code,
      p.name          AS product_name,
      p.weight_value,
      p.weight_unit,
      CASE WHEN r.request_type = 'Order'
           THEN COALESCE(it.dispatched_qty, it.requested_qty)
           ELSE -COALESCE(it.dispatched_qty, it.requested_qty)
      END AS signed_qty,
      CASE WHEN r.request_type = 'Order'
           THEN COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price
           ELSE -COALESCE(it.dispatched_qty, it.requested_qty) * it.unit_price
      END AS signed_amount,
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
  ORDER BY amount DESC, product_code
  LIMIT GREATEST(COALESCE(p_limit, 10), 1);
$$;
